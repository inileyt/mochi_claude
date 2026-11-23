/*
 * Mochi — Live Edit (loaded the first time you use it). Ask Claude to change any page, and see
 * it change in front of you:
 *   1. pick a part of the page (or the whole page) and say what should change;
 *   2. Mochi takes the question to claude.ai (you press Enter there yourself);
 *   3. when Claude answers, Mochi takes the CSS from the answer back to your page and applies it:
 *      before / after, edit it, ask for a tweak, undo, copy — or keep it for this site.
 * Only CSS, checked first (src/tools/live-css.js): nothing that runs code or loads from the web.
 *
 * Storage (chrome.storage.local): liveEdit.pending (the question on its way, with its tab),
 * liveEdit.result (Claude's CSS for it), liveEdit.kept (edits kept per site or page).
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const L = Mochi.liveCss;
  const T = (k, v) => Mochi.t(k, v);
  const PENDING = 'liveEdit.pending', RESULT = 'liveEdit.result', KEPT = 'liveEdit.kept';
  const CHIPS = ['live.chip.bigger', 'live.chip.dark', 'live.chip.hide', 'live.chip.readable', 'live.chip.calm', 'live.chip.round'];

  // The pocket's "prompt" for a Live Edit question is the question itself.
  const prevPrompt = Mochi.promptFor;
  Mochi.promptFor = entry => (entry?.kind === 'edit' ? entry.paste : prevPrompt(entry));

  let state = { ctx: null, session: null, style: null, css: '', removed: [], unwatch: null, on: true };
  const send = (op, extra = {}) => chrome.runtime.sendMessage({ type: 'mochi-tools', op, ...extra }).then(r => (r?.ok ? r.result : null)).catch(() => null);
  const hasExt = () => !!globalThis.chrome?.runtime?.id;

  // ——— which element, in words Claude can use ———
  const stableClass = c => /^[a-z][a-z0-9_-]{1,30}$/i.test(c) && !/\d{3,}|^(css|sc|jsx|svelte|emotion)-|__[a-z0-9]{5,}$/i.test(c);
  function selectorFor(el) {
    if (!el || el === document.body || el === document.documentElement) return 'body';
    const unique = sel => { try { return document.querySelectorAll(sel).length === 1; } catch (_) { return false; } };
    if (el.id && /^[a-z][\w-]{0,40}$/i.test(el.id) && unique(`#${CSS.escape(el.id)}`)) return `#${CSS.escape(el.id)}`;
    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && node !== document.body && depth < 6; depth++, node = node.parentElement) {
      if (node.id && /^[a-z][\w-]{0,40}$/i.test(node.id) && unique(`#${CSS.escape(node.id)}`)) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
      let part = node.tagName.toLowerCase();
      const cls = [...node.classList].filter(stableClass).slice(0, 2);
      if (cls.length) part += cls.map(c => `.${CSS.escape(c)}`).join('');
      const sibs = node.parentElement ? [...node.parentElement.children].filter(s => s.tagName === node.tagName) : [];
      if (sibs.length > 1 && !cls.length) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      parts.unshift(part);
      if (unique(parts.join(' > '))) return parts.join(' > ');
    }
    return parts.join(' > ') || el.tagName.toLowerCase();
  }
  function describe(el, whole) {
    const target = whole ? document.body : el;
    const cs = getComputedStyle(target);
    const r = target.getBoundingClientRect();
    const styles = [
      `font ${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily.split(',')[0].replace(/"/g, '')} ${cs.fontWeight}`,
      `color ${cs.color}`, `background ${cs.backgroundColor}${cs.backgroundImage !== 'none' ? ' + image/gradient' : ''}`,
      `padding ${cs.padding}`, `radius ${cs.borderRadius}`, cs.display !== 'block' ? `display ${cs.display}` : null,
    ].filter(Boolean).join('; ');
    let html = '';
    if (!whole) {
      const copy = el.cloneNode(true);
      copy.querySelectorAll('script, style, svg path, noscript').forEach(n => n.remove());
      copy.querySelectorAll('*').forEach(n => { for (const a of [...n.attributes]) if (/^on|^data-(?!testid)/i.test(a.name) || a.value.length > 120) n.removeAttribute(a.name); });
      html = copy.outerHTML.replace(/\s{2,}/g, ' ').slice(0, 6000);
    } else {
      // The whole page: its outline (landmarks and headings), not its HTML.
      html = [...document.querySelectorAll('header, nav, main, aside, footer, h1, h2, h3')].slice(0, 40)
        .map(n => `<${n.tagName.toLowerCase()}${n.id ? ` id="${n.id}"` : ''}${n.className && typeof n.className === 'string' ? ` class="${n.className.slice(0, 60)}"` : ''}>${/^H\d$/.test(n.tagName) ? n.textContent.trim().slice(0, 60) : '…'}`).join('\n');
    }
    return { selector: whole ? 'body' : selectorFor(el), tag: target.tagName.toLowerCase(), size: `${Math.round(r.width)}×${Math.round(r.height)}px`, styles, html };
  }

  // ——— the CSS on the page (one <style> per edit, owned by Mochi) ———
  function styleEl(id) {
    let s = document.querySelector(`style[data-mochi-live="${id}"]`);
    if (!s) { s = document.createElement('style'); s.setAttribute('data-mochi-live', id); (document.head || document.documentElement).append(s); }
    return s;
  }
  function apply(id, css) { const s = styleEl(id); s.textContent = css; return s; }
  function remove(id) { document.querySelectorAll(`style[data-mochi-live="${id}"]`).forEach(s => s.remove()); }

  // ——— 1. start: pick something (or the whole page); edits kept for this site ———
  async function open(ctx, opts = {}) {
    state.ctx = ctx;
    if (opts.result) return applyResult(ctx, opts.result);
    const { panel, companion } = ctx;
    const { h } = Mochi.ui;
    Mochi.menuInstance?.close();
    companion.hold('brush');
    const loc = Mochi.noteUrl.normalize(location.href);
    const kept = loc ? (await Mochi.store.get(KEPT, [])).filter(k => k.site === loc.site) : [];
    panel.open(T('live.title'), location.hostname || T('deep.thisPage'), h('div', { class: 'live' },
      h('p', { text: T('live.what') }),
      h('div', { class: 'row' },
        h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'live-pick', onclick: () => pick(ctx) }, `⌖ ${T('live.pick')}`),
        h('button', { class: 'px-btn', type: 'button', 'data-act': 'live-page', onclick: () => wish(ctx, { whole: true }) }, `▭ ${T('live.whole')}`)),
      kept.length ? h('section', { class: 'blk' }, h('h4', { text: T('live.keptHere', { n: kept.length }) }), keptList(ctx, kept)) : null,
      h('p', { class: 'note', text: T('live.safe') })), null);
    panel.view = 'live';
    return true;
  }

  function keptList(ctx, kept) {
    const { h } = Mochi.ui;
    return h('ul', { class: 'pocket live-kept' }, ...kept.map(k => h('li', { class: 'pk', 'data-id': k.id },
      h('div', { class: 'pk-title' }, h('b', { text: k.wish || k.selector }), h('span', { text: `${k.scope === 'page' ? T('notes.page') : T('notes.wholeSite')} · ${Mochi.ui.shortDate(k.created)}` })),
      h('div', { class: 'row' },
        h('button', { class: 'px-btn', type: 'button', 'data-act': 'live-toggle', 'aria-pressed': String(k.on !== false), onclick: async ev => {
          const btn = ev.currentTarget; // (gone from the event after an await)
          k.on = k.on === false;
          if (k.on) apply(k.id, k.css); else remove(k.id);
          btn.setAttribute('aria-pressed', String(k.on));
          btn.textContent = k.on ? `● ${T('live.on')}` : `○ ${T('live.off')}`;
          await saveKept(k);
        } }, k.on !== false ? `● ${T('live.on')}` : `○ ${T('live.off')}`),
        h('button', { class: 'px-btn danger', type: 'button', 'data-act': 'live-delete', onclick: async ev => { const row = ev.currentTarget.closest('li'); remove(k.id); row?.remove(); await Mochi.store.update(KEPT, (list = []) => list.filter(x => x.id !== k.id), []); send('liveEditSync'); } }, `✕ ${T('panel.delete')}`)))));
  }

  async function pick(ctx) {
    const { companion } = ctx;
    ctx.panel.close();
    const picker = state.picker || (state.picker = new Mochi.Picker(companion));
    if (picker.hint?.firstChild) picker.hint.firstChild.textContent = T('live.title');
    companion.say(T('live.pickHint'), 2400);
    const el = await picker.pick();
    if (!el) { companion.hold(null); ctx.engine.pickCancel?.(); return null; }
    return wish(ctx, { el });
  }

  // ——— 2. what should change? ———
  function wish(ctx, target, { current = '', session = null } = {}) {
    const { panel } = ctx;
    const { h } = Mochi.ui;
    const info = describe(target.el, target.whole);
    const text = h('textarea', { class: 'lib-text live-wish', rows: '3', 'data-field': 'wish', placeholder: T('live.placeholder'), 'aria-label': T('live.what') });
    const chips = h('div', { class: 'vibes' }, ...CHIPS.map(k => h('button', { class: 'chip ghost', type: 'button', onclick: () => { text.value = `${text.value ? `${text.value.trim()}, ` : ''}${T(k)}`; text.focus(); } }, T(k))));
    panel.open(T('live.title'), info.selector, h('div', { class: 'live' },
      h('p', { class: 'note', text: target.whole ? T('live.wholeNote') : `<${info.tag}> · ${info.size}` }),
      text, chips,
      h('div', { class: 'row' },
        h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'live-ask', onclick: () => { if (!text.value.trim()) { text.focus(); return; } ask(ctx, target, info, text.value, current, session); } }, `✨ ${T('live.ask')}`),
        h('button', { class: 'px-btn', type: 'button', 'data-act': 'live-self', onclick: () => editCard(ctx, { id: session?.id || newId(), wish: text.value || T('live.byHand'), selector: info.selector, url: location.href, whole: !!target.whole }, current || `${info.selector} {\n  \n}`, []) }, `✎ ${T('live.byHand')}`))), null);
    panel.view = 'live-wish';
    requestAnimationFrame(() => text.focus());
  }
  const newId = () => `le_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

  /** The question goes to claude.ai through the pocket; the answer comes back to this tab. */
  async function ask(ctx, target, info, wishText, current = '', prev = null) {
    const { companion, engine, panel } = ctx;
    const id = newId();
    const loc = Mochi.noteUrl.normalize(location.href);
    const session = { id, wish: wishText.trim(), selector: info.selector, whole: !!target.whole, url: location.href.split('#')[0], page: loc?.page || '', site: loc?.site || '', host: location.hostname || 'local', title: document.title.slice(0, 120), at: Date.now(), prev: prev?.id || null };
    const question = L.question({ ...info, id, wish: session.wish, url: session.url, title: session.title, whole: session.whole, current, lang: Mochi.lang?.() || 'en' });
    if (hasExt()) await send('liveEditAsk', { session }); // the background notes which tab this is
    else await Mochi.store.set(PENDING, session);
    watchResult(ctx, session);
    panel.close();
    if (ctx.isClaude) {
      // Editing claude.ai itself: the question goes straight into the box.
      const ok = await Mochi.insertIntoComposer(question);
      engine.pasted(ok);
      return session;
    }
    await Mochi.pocket.add({ v: 1, id, kind: 'edit', ask: true, url: session.url, host: session.host, title: session.wish.slice(0, 80), at: new Date().toISOString(), colors: [], vibe: [{ id: 'edit', label: T('live.chipLabel') }], paste: question }, { offered: false });
    companion.say(T('live.toClaude'), 2600);
    engine.react({ mood: 'excited', action: 'wave', hold: 2500 });
    if (hasExt()) send('openClaudeTab');
    return session;
  }

  function watchResult(ctx, session) {
    state.session = session;
    if (state.unwatch) return;
    state.unwatch = true;
    Mochi.store.watch(RESULT, r => { if (r && state.session && r.id === state.session.id && !r.applied) applyResult(ctx, r); });
  }

  // ——— 3. the answer is here: apply it, show the card ———
  async function applyResult(ctx, r) {
    state.ctx = ctx;
    const s = L.sanitize(r.css);
    await Mochi.store.set(RESULT, { ...r, applied: true });
    const session = r.session || state.session || { id: r.id, wish: '', selector: 'body' };
    if (session.prev) remove(session.prev); // a tweak replaces the edit it came from
    ctx.companion.hold('brush');
    ctx.companion.play('spin');
    ctx.companion.flashFx('sparkles', 2000);
    ctx.companion.say(s.css ? T('live.applied') : T('live.noCss'), 2600);
    return editCard(ctx, session, s.css, s.removed);
  }

  function editCard(ctx, session, css, removed) {
    const { panel, companion } = ctx;
    const { h, copyText } = Mochi.ui;
    state.session = session;
    state.css = css;
    state.on = true;
    apply(session.id, css);
    const box = h('textarea', { class: 'export live-css', spellcheck: 'false', 'aria-label': 'CSS', 'data-field': 'css' });
    box.value = css;
    let t = null;
    box.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { const s = L.sanitize(box.value); state.css = s.css; if (state.on) apply(session.id, s.css); }, 250); });
    const toggle = h('button', { class: 'px-btn', type: 'button', 'data-act': 'live-before', 'aria-pressed': 'false', onclick: () => {
      state.on = !state.on;
      if (state.on) apply(session.id, state.css); else remove(session.id);
      toggle.setAttribute('aria-pressed', String(!state.on));
      toggle.textContent = state.on ? `◐ ${T('live.before')}` : `◑ ${T('live.after')}`;
    } }, `◐ ${T('live.before')}`);
    const tweak = h('textarea', { class: 'lib-text', rows: '2', placeholder: T('live.tweakHint'), 'aria-label': T('live.tweak') });
    panel.open(T('live.title'), session.wish || session.selector, h('div', { class: 'live' },
      removed.length ? h('p', { class: 'deep-warn', text: T('live.removed', { n: removed.length, what: removed.slice(0, 3).join(', ') }) }) : null,
      h('div', { class: 'row' }, toggle,
        h('button', { class: 'px-btn', type: 'button', 'data-act': 'live-copy', onclick: async () => { await copyText(state.css, companion.shadow); ctx.actions.copied('CSS'); } }, `⧉ ${T('panel.copy')}`),
        h('button', { class: 'px-btn danger', type: 'button', 'data-act': 'live-undo', onclick: () => { remove(session.id); state.on = false; panel.close(); companion.hold(null); companion.say(T('live.undone'), 1800); } }, `↶ ${T('live.undo')}`)),
      h('section', { class: 'blk' }, h('h4', { text: 'CSS' }), box),
      h('section', { class: 'blk' }, h('h4', { text: T('live.tweak') }), tweak,
        h('div', { class: 'row' }, h('button', { class: 'px-btn', type: 'button', 'data-act': 'live-tweak', onclick: () => {
          if (!tweak.value.trim()) { tweak.focus(); return; }
          const el = session.whole ? null : document.querySelector(session.selector);
          ask(ctx, { el: el || document.body, whole: session.whole || !el }, describe(el || document.body, session.whole || !el), `${session.wish}. ${T('live.andThen')} ${tweak.value.trim()}`, state.css, session);
        } }, `✨ ${T('live.tweakAsk')}`))),
    ), h('div', { class: 'row' },
      h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'live-keep-site', onclick: () => keep(ctx, 'site') }, `▣ ${T('live.keepSite')}`),
      h('button', { class: 'px-btn', type: 'button', 'data-act': 'live-keep-page', onclick: () => keep(ctx, 'page') }, T('live.keepPage'))));
    panel.view = 'live-card';
    return true;
  }

  // ——— keep it ———
  async function saveKept(k) { await Mochi.store.update(KEPT, (list = []) => [k, ...list.filter(x => x.id !== k.id)].slice(0, 200), []); }
  async function keep(ctx, scope) {
    const s = state.session;
    const loc = Mochi.noteUrl.normalize(location.href);
    if (!s || !loc || !state.css) return;
    await saveKept({ id: s.id, site: loc.site, page: loc.page, scope, css: state.css, wish: s.wish, selector: s.selector, created: new Date().toISOString(), on: true });
    ctx.emit?.('liveKept', state.css);
    const status = hasExt() ? await send('liveEditSync') : null;
    ctx.companion.hold(null);
    ctx.companion.play('hop');
    ctx.engine.saved?.();
    if (status && !status.permission) {
      // Applied whenever Mochi is here; to apply it on every visit, Mochi may ask for "every site".
      ctx.companion.say(T('live.keptHere2'), 4000);
      const { h } = Mochi.ui;
      ctx.panel.open(T('live.title'), T('live.kept'), h('div', { class: 'live' }, h('p', { text: T('live.keptExplain') }),
        h('div', { class: 'row' }, h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'live-always', onclick: () => send('openEverywhere', { why: 'edits' }) }, T('live.always')))), null);
    } else {
      ctx.panel.close();
      ctx.companion.say(T('live.kept'), 2600);
    }
  }

  // ——— on claude.ai: the answer to a Live Edit question ———
  async function onAnswer(ctx, el, text) {
    const pending = await Mochi.store.get(PENDING, null);
    if (!pending || pending.done) return false;
    const blocks = el ? [...el.querySelectorAll('pre')].map(pre => {
      const code = pre.querySelector('code') || pre;
      const lang = (/language-([\w-]+)/.exec(code.className || '') || /language-([\w-]+)/.exec(pre.className || '') || [])[1] || '';
      return { lang: lang.toLowerCase(), text: code.textContent };
    }) : [];
    const css = L.fromBlocks(blocks) || L.fromText(text);
    if (!css) { ctx.companion.say(T('live.noCssClaude'), 3600); return false; }
    await Mochi.store.set(PENDING, { ...pending, done: true });
    await Mochi.store.set(RESULT, { id: pending.id, css, session: pending, at: Date.now(), applied: false });
    ctx.companion.play('hop');
    ctx.companion.say(T('live.carrying', { host: pending.host }), 3000);
    if (hasExt()) setTimeout(() => send('liveEditReturn', { id: pending.id }), 1200);
    return true;
  }

  Mochi.toolImpl.liveEdit = {
    open, onAnswer, applyResult, selectorFor, describe, apply, remove,
    close: () => { if (state.ctx?.panel.view?.startsWith('live')) state.ctx.panel.close(); state.ctx?.companion.hold(null); },
    get isOpen() { return !!state.ctx?.panel.view?.startsWith('live') && state.ctx.panel.isOpen; },
    get state() { return { session: state.session, css: state.css, on: state.on }; },
  };
})();
