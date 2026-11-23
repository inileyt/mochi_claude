/*
 * Mochi Guides (loaded the first time they're used). Claude's step-by-step answer becomes a guide
 * on the real website: Mochi shows the step, walks to the button it names and points at it, notices
 * when you've done it and moves on. He never clicks for you.
 *
 *   on claude.ai:  an answer with steps → "Make it a guide?" (or Menu → Tools → Guides)
 *   on the site:   the step card (← ✓ → / can't find it / stop), an outline on the button, Mochi beside it
 *   recording:     Mochi writes down what you click (and which fields you type in, never what) → a guide
 *                  you can play again or share as a .mochi-guide.json file
 *
 * Storage (chrome.storage.local): guides.active (the guide being followed, with its tab),
 * guides.recording, guides.saved (your guides, ≤ 50).
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const G = Mochi.guideParse;
  const T = (k, v) => Mochi.t(k, v);
  const ACTIVE = 'guides.active', REC = 'guides.recording', SAVED = 'guides.saved';
  const CLICKABLE = 'a[href], button, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"], [role="checkbox"], input[type="submit"], input[type="button"], input[type="checkbox"], input[type="radio"], summary, label, select, input, textarea, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
  const send = (op, extra = {}) => (globalThis.chrome?.runtime?.id ? chrome.runtime.sendMessage({ type: 'mochi-tools', op, ...extra }).then(r => (r?.ok ? r.result : null)).catch(() => null) : Promise.resolve(null));

  let play = null; // { ctx, scope, guide, card, box, el, offset }
  let rec = null;  // { ctx, scope, card }

  // ——— names of things on the page ———
  const norm = s => String(s || '').replace(/[\s ]+/g, ' ').replace(/[“”"‘’'«»]/g, '').trim().toLowerCase();
  function nameOf(el) {
    const aria = el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent);
    if (aria) return aria;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
      const label = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label');
      return label?.textContent || el.getAttribute('placeholder') || el.value || el.getAttribute('title') || el.name || '';
    }
    return el.innerText || el.textContent || el.getAttribute('title') || el.getAttribute('alt') || '';
  }
  const visible = el => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05; };
  function candidates(root = document, depth = 0) {
    const out = [...root.querySelectorAll(CLICKABLE)].filter(el => !el.closest('mochi-companion'));
    if (depth < 2) for (const host of root.querySelectorAll('*')) if (host.shadowRoot && !host.matches('mochi-companion')) out.push(...candidates(host.shadowRoot, depth + 1));
    return out;
  }
  /** The best match for a step's targets: exact name, then starts with, then contains; visible first. */
  function find(targets) {
    if (!targets?.length) return null;
    const all = candidates().filter(visible).slice(0, 3000);
    for (const t of targets) {
      const want = norm(t);
      if (!want) continue;
      let best = null, bestScore = 0;
      for (const el of all) {
        const name = norm(nameOf(el)).slice(0, 200);
        if (!name) continue;
        let score = name === want ? 100 : name.startsWith(want) ? 80 - Math.min(20, (name.length - want.length) / 4) : name.includes(want) ? 62 - Math.min(20, (name.length - want.length) / 6) : 0;
        if (!score) continue;
        if (el.matches('button, a[href], [role="button"], [role="tab"], [role="menuitem"]')) score += 5;
        const r = el.getBoundingClientRect();
        if (r.bottom > 0 && r.top < innerHeight) score += 3;
        if (score > bestScore) { bestScore = score; best = el; }
      }
      // A label stands for its field: the field is where you click and type.
      if (best?.tagName === 'LABEL' && best.control && visible(best.control)) best = best.control;
      if (best && bestScore >= 50) return { el: best, target: t, score: Math.round(bestScore) };
    }
    return null;
  }

  // ——— Mochi walks over to the button (the explore mode's offset), and back home ———
  function moveBy(ctx, x, y) { const root = ctx.companion.root; root.style.setProperty('--ex-x', `${Math.round(x)}px`); root.style.setProperty('--ex-y', `${Math.round(y)}px`); }
  async function walkTo(ctx, el) {
    const root = ctx.companion.root;
    const cur = { x: parseFloat(root.style.getPropertyValue('--ex-x')) || 0, y: parseFloat(root.style.getPropertyValue('--ex-y')) || 0 };
    const now = root.getBoundingClientRect(), size = now.width || 120;
    const home = { left: now.left - cur.x, top: now.top - cur.y };
    const r = el.getBoundingClientRect();
    // Beside the button: to its right if there's room, else to its left; feet level with its bottom.
    let left = r.right + 8 + size <= innerWidth - 8 ? r.right + 4 : Math.max(8, r.left - size - 4);
    let top = Math.min(innerHeight - size - 8, Math.max(8, r.top + r.height / 2 - size * 0.6));
    const goal = { x: left - home.left, y: top - home.top };
    ctx.companion.el.classList.add('walking');
    root.classList.add('guiding');
    const steps = Math.max(1, Math.min(14, Math.round(Math.hypot(goal.x - cur.x, goal.y - cur.y) / 40)));
    for (let i = 1; i <= steps && play; i++) { moveBy(ctx, cur.x + ((goal.x - cur.x) * i) / steps, cur.y + ((goal.y - cur.y) * i) / steps); await new Promise(res => setTimeout(res, 45)); }
    ctx.companion.el.classList.remove('walking');
    ctx.companion.lookAtElement(el, 3000);
    ctx.companion.flashFx('exclaim', 1200);
  }
  function walkHome(ctx) { moveBy(ctx, 0, 0); ctx.companion.root.classList.remove('guiding'); ctx.companion.lookDefault?.(); }

  // ——— on claude.ai: "this looks like steps — make it a guide?" ———
  function guideFromAnswer(el, text) {
    let items = null;
    if (el) {
      const ol = [...el.querySelectorAll('ol')].find(o => !o.parentElement?.closest('li') && o.querySelectorAll(':scope > li').length >= G.MIN_STEPS);
      if (ol) items = [...ol.querySelectorAll(':scope > li')].map(li => ({ text: li.innerText || li.textContent, strong: [...li.querySelectorAll('strong, b')].map(b => b.textContent), code: [...li.querySelectorAll('code')].map(c => c.textContent), links: [...li.querySelectorAll('a[href]')].map(a => a.href) }));
    }
    const links = el ? [...el.querySelectorAll('a[href]')].map(a => a.href) : [];
    return G.parse({ text: text || el?.innerText || '', items, links });
  }
  function offer(ctx, el, text) {
    const guide = guideFromAnswer(el, text);
    if (!guide) return null;
    const { h } = Mochi.ui;
    ctx.panel.hideOffer?.();
    ctx.companion.root.querySelector('.gd-offer')?.remove();
    const box = h('div', { class: 'offer gd-offer', role: 'alertdialog', 'aria-label': T('guide.offer', { n: guide.steps.length }) },
      h('p', { text: T('guide.offer', { n: guide.steps.length }) }),
      h('div', { class: 'row' },
        h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'guide-make', onclick: () => { box.remove(); start(ctx, guide); } }, `🧭 ${T('guide.make')}`),
        h('button', { class: 'px-btn', type: 'button', 'data-act': 'guide-later', onclick: () => box.remove() }, T('longChat.notNow'))));
    ctx.companion.root.append(box);
    ctx.companion.play('hop');
    setTimeout(() => box.remove(), 25000);
    return guide;
  }

  /** Start following a guide: on its start page (a new tab), or here. */
  async function start(ctx, guide, { here = false } = {}) {
    const res = await send('guideStart', { guide, here: here || !guide.startUrl });
    if (!globalThis.chrome?.runtime?.id) { await Mochi.store.set(ACTIVE, { ...guide, current: 0, tabId: 0, at: Date.now() }); return resume(ctx); }
    if (here || !guide.startUrl) return resume(ctx);
    ctx.companion.say(res?.permission ? T('guide.opening', { host: guide.host }) : T('guide.openingClick', { host: guide.host }), 5000);
    ctx.engine.react({ mood: 'excited', action: 'wave', hold: 2500 });
    return true;
  }

  // ——— playing ———
  async function resume(ctx) {
    const guide = await Mochi.store.get(ACTIVE, null);
    if (!guide) return false;
    stopPlaying(ctx, { keep: true });
    const { h } = Mochi.ui;
    const scope = Mochi.tools.scope('guides');
    const card = h('section', { class: 'gd-card', role: 'region', 'aria-label': T('guide.title'), 'aria-live': 'polite' });
    const box = h('div', { class: 'gd-box', hidden: true });
    ctx.companion.shadow.append(box, card);
    play = { ctx, scope, guide, card, box, el: null, url: location.href };
    ctx.companion.hold(null);
    // A click on the button of this step (or anything inside it) = done; typing in its field = done when it changes.
    scope.on(document, 'click', ev => { if (play?.el && ev.composedPath().includes(play.el)) setTimeout(() => advance(+1, { auto: true }), 250); }, { capture: true, passive: true });
    scope.on(document, 'change', ev => { if (play?.el && ev.composedPath().includes(play.el)) advance(+1, { auto: true }); }, { capture: true, passive: true });
    scope.on(document, 'keydown', ev => { if (ev.key === 'Escape' && play && ev.composedPath().includes(ctx.companion.host)) stopPlaying(ctx); }, true);
    // The page changes under us (single-page sites): look again now and then.
    scope.interval(() => { if (!play) return; if (location.href !== play.url) { play.url = location.href; show(); } else if (!play.el || !play.el.isConnected || !visible(play.el)) show({ quiet: true }); else outline(); }, 900);
    scope.on(window, 'scroll', () => outline(), { passive: true, capture: true });
    show();
    return true;
  }

  function outline() {
    if (!play?.el) { if (play) play.box.hidden = true; return; }
    const r = play.el.getBoundingClientRect();
    Object.assign(play.box.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
    play.box.hidden = false;
  }

  async function show({ quiet = false } = {}) {
    if (!play) return;
    const { ctx, guide } = play;
    const { h } = Mochi.ui;
    const i = guide.current || 0;
    const step = guide.steps[i];
    if (!step) return finish();
    const found = find(step.targets);
    const prevEl = play.el;
    play.el = found?.el || null;
    const status = !step.targets.length ? T('guide.noTarget') : found ? T('guide.here', { what: found.target }) : T('guide.notFound', { what: step.targets[0] });
    play.card.replaceChildren(
      h('header', { class: 'gd-head' }, h('b', { text: `🧭 ${T('guide.step', { i: i + 1, n: guide.steps.length })}` }), h('span', { class: 'gd-title', text: guide.title }),
        h('button', { class: 'px-btn icon', type: 'button', 'data-act': 'guide-stop', 'aria-label': T('guide.stop'), title: T('guide.stop'), onclick: () => stopPlaying(ctx) }, '×')),
      h('p', { class: 'gd-text', text: step.text }),
      step.targets.length ? h('div', { class: 'vibes' }, ...step.targets.map(t => h('span', { class: `chip ${found?.target === t ? 'main' : 'ghost'}`, text: t }))) : null,
      h('p', { class: `note gd-status${found || !step.targets.length ? '' : ' warn'}`, 'data-found': String(!!found), text: status }),
      h('div', { class: 'row' },
        h('button', { class: 'px-btn', type: 'button', 'data-act': 'guide-back', disabled: i === 0 || null, onclick: () => advance(-1) }, '←'),
        h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'guide-done', onclick: () => advance(+1) }, `✓ ${T('guide.done')}`),
        h('button', { class: 'px-btn', type: 'button', 'data-act': 'guide-skip', onclick: () => advance(+1, { skip: true }) }, `${T('guide.skip')} →`),
        found || !step.targets.length ? null : h('button', { class: 'px-btn', type: 'button', 'data-act': 'guide-help', onclick: () => help(step) }, `? ${T('guide.cantFind')}`)));
    if (found) {
      if (found.el !== prevEl) {
        const r = found.el.getBoundingClientRect();
        if (r.top < 60 || r.bottom > innerHeight - 60) { found.el.scrollIntoView({ block: 'center' }); await new Promise(res => setTimeout(res, 120)); }
        outline();
        await walkTo(ctx, found.el);
        // (Right after a page load Mochi says hello first: point after it.)
        if (!quiet) setTimeout(() => { if (play?.el === found.el) ctx.companion.say(T('guide.point', { what: found.target }), 2400); }, performance.now() < 4000 ? 1300 : 0);
      } else outline();
    } else {
      play.box.hidden = true;
      if (prevEl) walkHome(ctx);
      if (!quiet && step.targets.length) { ctx.companion.setMood('curious'); ctx.companion.say(T('guide.looking'), 2000); }
    }
  }

  async function advance(d, { auto = false, skip = false } = {}) {
    if (!play) return;
    const g = play.guide;
    g.current = Math.max(0, Math.min(g.steps.length, (g.current || 0) + d));
    await Mochi.store.set(ACTIVE, g);
    if (d > 0 && !skip) { play.ctx.companion.play('hop'); play.ctx.companion.flashFace({ eyes: 'happy', mouth: 'smile' }, 700); if (auto) play.ctx.companion.say(T('guide.nice'), 1400); }
    play.el = null;
    if (g.current >= g.steps.length) return finish();
    show();
  }

  async function finish() {
    const ctx = play?.ctx;
    stopPlaying(ctx);
    if (!ctx) return;
    ctx.companion.play('celebrate');
    ctx.companion.flashFx('sparkles', 2500);
    ctx.companion.setMood('happy');
    ctx.companion.say(T('guide.finished'), 3600);
    ctx.emit('guideDone');
  }

  function stopPlaying(ctx, { keep = false } = {}) {
    if (!play) { if (!keep && ctx) Mochi.store.set(ACTIVE, null); return; }
    play.scope.dispose();
    play.card.remove(); play.box.remove();
    walkHome(play.ctx);
    play = null;
    if (!keep) Mochi.store.set(ACTIVE, null);
  }

  /** Can't find it: what Mochi sees here, for Claude. */
  async function help(step) {
    const { ctx } = play;
    const names = [...new Set(candidates().filter(visible).map(el => norm(nameOf(el)).slice(0, 50)).filter(n => n && n.length > 1))].slice(0, 60);
    const question = [
      `I'm following these steps on ${location.hostname} and I'm stuck at: "${step.text}"`,
      `I can't find "${step.targets.join('" / "')}" on this page (${document.title}, ${location.href.split('#')[0]}).`,
      `These buttons and links are visible right now: ${names.map(n => `"${n}"`).join(', ')}.`,
      'Which one should I use instead, or where is it hidden (a menu, a tab, another page)? Answer briefly, with the exact button text in "double quotes".',
    ].join('\n');
    await Mochi.ui.copyText(question, ctx.companion.shadow);
    await Mochi.pocket?.add({ v: 1, id: `gh_${Date.now().toString(36)}`, kind: 'note', url: location.href, host: location.hostname, title: T('guide.helpTitle'), at: new Date().toISOString(), colors: [], vibe: [{ id: 'guide', label: T('guide.title') }], paste: question }, { offered: false });
    ctx.companion.say(T('guide.helpCopied'), 4200);
  }

  // ——— recording ———
  async function startRecording(ctx) {
    await Mochi.store.set(REC, { title: document.title.slice(0, 90) || location.hostname, startUrl: location.href.split('#')[0], host: location.hostname.replace(/^www\./, ''), steps: [], at: Date.now() });
    await send('guideRecordHere');
    return resumeRecording(ctx);
  }
  async function resumeRecording(ctx) {
    const r = await Mochi.store.get(REC, null);
    if (!r) return false;
    if (rec) { rec.scope.dispose(); rec.card.remove(); }
    const { h } = Mochi.ui;
    const scope = Mochi.tools.scope('guides-rec');
    const count = h('b', { text: '' });
    const card = h('section', { class: 'gd-card rec', role: 'region', 'aria-label': T('guide.recording') },
      h('header', { class: 'gd-head' }, h('span', { class: 'gd-dot', 'aria-hidden': 'true' }), count),
      h('p', { class: 'note', text: T('guide.recHint') }),
      h('div', { class: 'row' },
        h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'rec-stop', onclick: () => stopRecording(ctx, true) }, `■ ${T('guide.recStop')}`),
        h('button', { class: 'px-btn', type: 'button', 'data-act': 'rec-cancel', onclick: () => stopRecording(ctx, false) }, T('deep.cancel'))));
    ctx.companion.shadow.append(card);
    rec = { ctx, scope, card };
    const label = n => { count.textContent = T('guide.recCount', { n }); };
    label(r.steps.length);
    const addStep = async step => {
      const cur = await Mochi.store.get(REC, null);
      if (!cur) return;
      const last = cur.steps.at(-1);
      if (last && last.text === step.text) return; // a double click
      cur.steps.push(step);
      await Mochi.store.set(REC, cur);
      label(cur.steps.length);
      ctx.companion.flashFace({ eyes: 'happy', mouth: 'smile' }, 500);
    };
    scope.on(document, 'click', ev => {
      if (ev.composedPath().includes(ctx.companion.host)) return;
      const el = ev.target instanceof Element ? ev.target.closest(CLICKABLE) : null;
      if (!el || /^(INPUT|TEXTAREA)$/.test(el.tagName) && !/^(submit|button|checkbox|radio)$/.test(el.type)) return;
      const name = norm(nameOf(el)) && String(nameOf(el)).replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!name) return;
      addStep({ text: `Click “${name}”`, targets: [name], action: 'click', url: location.href.split('#')[0], recorded: true });
    }, { capture: true, passive: true });
    // Typing: only which field, never what you typed.
    scope.on(document, 'change', ev => {
      const el = ev.target;
      if (!(el instanceof Element) || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || /^(submit|button|checkbox|radio|hidden)$/.test(el.type)) return;
      const name = String(nameOf(el)).replace(/\s+/g, ' ').trim().slice(0, 60) || el.name || el.type;
      addStep({ text: el.tagName === 'SELECT' ? `Choose an option in “${name}”` : el.type === 'password' ? `Type your password into “${name}”` : `Fill in “${name}”`, targets: [name], action: 'type', url: location.href.split('#')[0], recorded: true });
    }, { capture: true, passive: true });
    ctx.companion.say(T('guide.recOn'), 2400);
    return true;
  }
  async function stopRecording(ctx, save) {
    const r = await Mochi.store.get(REC, null);
    if (rec) { rec.scope.dispose(); rec.card.remove(); rec = null; }
    await Mochi.store.set(REC, null);
    await send('guideRecordStop');
    if (!save || !r?.steps?.length) { ctx.companion.say(T('say.okay'), 1200); return null; }
    const guide = { id: `g_${Date.now().toString(36)}`, title: r.title, startUrl: r.startUrl, host: r.host, steps: r.steps, recorded: true, at: new Date().toISOString() };
    await Mochi.store.update(SAVED, (list = []) => [guide, ...list].slice(0, 50), []);
    ctx.companion.play('hop');
    ctx.companion.say(T('guide.saved', { n: guide.steps.length }), 2600);
    return openList(ctx);
  }

  // ——— your guides: play, share, import, ask Claude for one ———
  async function openList(ctx) {
    const { h, downloadText, shortDate } = Mochi.ui;
    const { panel, companion } = ctx;
    Mochi.menuInstance?.close();
    const saved = await Mochi.store.get(SAVED, []);
    const task = h('input', { class: 'lib-input', type: 'text', placeholder: T('guide.askPlaceholder'), 'aria-label': T('guide.ask') });
    const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async () => {
      try {
        const g = G.fromFile(await file.files[0].text());
        await Mochi.store.update(SAVED, (list = []) => [{ ...g, id: `g_${Date.now().toString(36)}`, at: new Date().toISOString() }, ...list].slice(0, 50), []);
        companion.say(T('guide.imported'), 2000);
        openList(ctx);
      } catch (_) { companion.setMood('sad'); companion.say(T('guide.badFile'), 2600); }
    } });
    const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'guide';
    panel.open(T('guide.title'), T('guide.count', { n: saved.length }), h('div', { class: 'gd-list' },
      h('section', { class: 'blk' }, h('h4', { text: T('guide.ask') }), task,
        h('div', { class: 'row' }, h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'guide-ask', onclick: async () => {
          if (!task.value.trim()) { task.focus(); return; }
          const q = G.prompt(task.value, Mochi.lang?.() || 'en');
          if (ctx.isClaude) { panel.close(); engine(ctx).pasted(await Mochi.insertIntoComposer(q)); return; }
          await Mochi.ui.copyText(q, companion.shadow);
          ctx.actions.copied(T('guide.question'));
        } }, `✎ ${T('guide.askBtn')}`))),
      h('section', { class: 'blk' }, h('h4', { text: T('guide.yours') }),
        saved.length ? h('ul', { class: 'pocket' }, ...saved.map(g => h('li', { class: 'pk', 'data-id': g.id },
          h('div', { class: 'pk-title' }, h('b', { text: g.title }), h('span', { text: `${g.host || '—'} · ${T('guide.steps', { n: g.steps.length })} · ${shortDate(g.at)}${g.recorded ? ' · ●' : ''}` })),
          h('div', { class: 'row' },
            h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'guide-play', onclick: () => { panel.close(); start(ctx, g, { here: !g.startUrl || Mochi.noteUrl.normalize(location.href)?.site === Mochi.noteUrl.normalize(g.startUrl)?.site }); } }, `▶ ${T('guide.play')}`),
            h('button', { class: 'px-btn', type: 'button', 'data-act': 'guide-export', onclick: () => { downloadText(`${slug(g.title)}.mochi-guide.json`, G.toFile(g), companion.shadow, 'application/json'); ctx.actions.downloaded('.mochi-guide.json'); } }, '⤓'),
            h('button', { class: 'px-btn danger', type: 'button', 'data-act': 'guide-delete', onclick: async ev => { const row = ev.currentTarget.closest('li'); row?.remove(); await Mochi.store.update(SAVED, (list = []) => list.filter(x => x.id !== g.id), []); } }, '✕'))))) : h('p', { class: 'note', text: T('guide.none') })),
    ), h('div', { class: 'row' },
      h('button', { class: 'px-btn', type: 'button', 'data-act': 'guide-record', onclick: () => { panel.close(); startRecording(ctx); } }, `● ${T('guide.record')}`),
      h('button', { class: 'px-btn', type: 'button', 'data-act': 'guide-import', onclick: () => file.click() }, `⤒ ${T('notes.import')}`), file));
    panel.view = 'guides';
    return true;
  }
  const engine = ctx => ctx.engine;

  async function open(ctx, opts = {}) {
    if (opts.resume) { if (await Mochi.store.get(REC, null)) await resumeRecording(ctx); return resume(ctx); }
    if (opts.answer) return offer(ctx, opts.answer.el, opts.answer.text);
    if (opts.last && ctx.isClaude) {
      const all = Mochi.site?.assistantMessages() || [];
      const el = all.at(-1);
      const g = el && guideFromAnswer(el, el.innerText);
      if (!g) { ctx.companion.say(T('guide.noSteps'), 2600); return false; }
      return start(ctx, g);
    }
    return openList(ctx);
  }

  Mochi.toolImpl.guides = {
    open, offer, start, resume, find, nameOf, guideFromAnswer, startRecording, stopRecording,
    close: () => stopPlaying(play?.ctx),
    get isOpen() { return !!play || !!rec; },
    get state() { return play ? { current: play.guide.current, steps: play.guide.steps.length, target: play.el ? norm(nameOf(play.el)).slice(0, 60) : null } : { current: null, recording: !!rec }; },
  };
})();
