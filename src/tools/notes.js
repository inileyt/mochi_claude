/*
 * Mochi — site notes (loaded the first time you open them). A little pixel notepad
 * Mochi holds: notes for this page or for the whole site, plain text with [ ] / [x]
 * checkboxes (click a box to tick it, Ctrl+Enter on a line too), saved by itself a
 * moment after you stop typing, in a few pastel paper colors. Drag it by its top;
 * Esc or × closes it. Everything stays in this browser (src/tools/notes-store.js).
 * "All notes" (every site, search, open, delete, export / import, send to Claude)
 * is the second half of this file.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const N = Mochi.notesStore;
  const T = (k, v) => Mochi.t(k, v);
  const PAPERS = { butter: '#fff3b0', mint: '#d8f3dc', pink: '#ffd6e0', sky: '#d6ecff', lilac: '#e9dcff' };
  const SAVE_MS = 600;
  const BOX = /^(\s*(?:[-*]\s+)?)\[( |x|X)\]/;

  let ui = null; // the open notepad: { el, scope, … }

  /** Ticks the [ ] / [x] box on the line at pos (if pos is on the box). → the new text or null. */
  function toggleAt(text, pos, { anywhereOnLine = false } = {}) {
    const start = text.lastIndexOf('\n', pos - 1) + 1;
    const end = text.indexOf('\n', pos) === -1 ? text.length : text.indexOf('\n', pos);
    const line = text.slice(start, end);
    const m = BOX.exec(line);
    if (!m) return null;
    const boxAt = start + m[1].length;
    if (!anywhereOnLine && (pos < boxAt || pos > boxAt + 3)) return null;
    const ticked = m[2] !== ' ';
    return { text: `${text.slice(0, boxAt)}[${ticked ? ' ' : 'x'}]${text.slice(boxAt + 3)}`, ticked: !ticked };
  }

  const fmtTime = ms => { try { return new Date(ms).toLocaleString(Mochi.lang?.() || undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (_) { return new Date(ms).toISOString().slice(0, 16); } };

  async function open(ctx, opts = {}) {
    if (opts.view === 'all') return Mochi.toolImpl.notes.showAll?.(ctx);
    if (ui) { ui.text.focus(); return true; }
    const { companion, engine } = ctx;
    const { h } = Mochi.ui;
    const loc = Mochi.noteUrl.normalize(location.href);
    if (!loc) { companion.say(T('notes.noPage'), 2400); return false; }
    Mochi.menuInstance?.close();
    if (companion.isTucked) companion.setTucked(false);
    const scope = Mochi.tools.scope('notes');
    const keys = { page: `page:${loc.page}`, site: `site:${loc.site}` };
    const [pageNote, siteNote] = await Promise.all([N.get(keys.page), N.get(keys.site)]);
    const state = { scope: opts.scope || (siteNote && !pageNote ? 'site' : 'page'), notes: { page: pageNote, site: siteNote }, dirty: false, color: (pageNote || siteNote)?.color || 'butter' };

    const status = h('span', { class: 'np-status', 'aria-live': 'polite' });
    const text = h('textarea', { class: 'np-text', spellcheck: 'true', 'aria-label': T('notes.title'), placeholder: T('notes.placeholder') });
    const tabs = ['page', 'site'].map(s => h('button', { class: 'np-tab', type: 'button', 'data-scope': s, onclick: () => switchTo(s) }, T(`notes.${s}`)));
    const dots = Object.entries(PAPERS).map(([name, hex]) => h('button', { class: 'np-dot', type: 'button', 'data-color': name, style: { background: hex }, 'aria-label': T('notes.paper', { color: T(`notes.color.${name}`) }), title: T(`notes.color.${name}`), onclick: () => { state.color = name; paint(); state.dirty = true; queueSave(); } }));
    const head = h('header', { class: 'np-head' },
      h('b', { class: 'np-title', text: T('notes.title') }),
      h('div', { class: 'np-tabs', role: 'group', 'aria-label': T('notes.scope') }, ...tabs),
      h('button', { class: 'px-btn icon np-close', type: 'button', 'aria-label': T('settings.close'), title: T('settings.close'), onclick: () => close() }, '×'));
    const el = h('section', { class: 'notes-pad', role: 'dialog', 'aria-label': T('notes.title') },
      head,
      h('div', { class: 'np-paper' }, text),
      h('footer', { class: 'np-foot' },
        h('div', { class: 'np-dots' }, ...dots),
        h('button', { class: 'px-btn', type: 'button', 'data-act': 'np-box', title: T('notes.addBox'), 'aria-label': T('notes.addBox'), onclick: () => addBox() }, '☐+'),
        h('button', { class: 'px-btn', type: 'button', 'data-act': 'np-all', title: T('menu.allNotes'), 'aria-label': T('menu.allNotes'), onclick: () => { close(); Mochi.tools.open('allNotes'); } }, '▤'),
        h('button', { class: 'px-btn', type: 'button', 'data-act': 'np-claude', title: T('notes.toClaude'), 'aria-label': T('notes.toClaude'), onclick: () => { flush(); Mochi.toolImpl.notes.sendToClaude?.(ctx, current()); } }, '✎→'),
        status));
    companion.shadow.append(el);
    ui = { el, text, status, state, keys, close };

    function current() { return { key: keys[state.scope], scope: state.scope, url: state.scope === 'page' ? loc.page : '', host: loc.site, title: state.scope === 'page' ? (document.title || loc.page).slice(0, 160) : loc.site, text: text.value, color: state.color }; }
    function paint() {
      el.style.setProperty('--paper', PAPERS[state.color] || PAPERS.butter);
      for (const d of dots) d.setAttribute('aria-pressed', String(d.dataset.color === state.color));
      for (const t of tabs) t.setAttribute('aria-pressed', String(t.dataset.scope === state.scope));
    }
    function show() {
      const n = state.notes[state.scope];
      text.value = n?.text || '';
      if (n?.color) state.color = n.color;
      status.textContent = n ? T('notes.savedAt', { time: fmtTime(n.updated) }) : T('notes.empty');
      paint();
    }
    async function switchTo(s) { if (s === state.scope) return; await flush(); state.scope = s; show(); text.focus(); }

    let saveOff = null;
    function queueSave() { saveOff?.(); saveOff = scope.timeout(() => flush(), SAVE_MS); status.textContent = T('notes.saving'); }
    async function flush() {
      saveOff?.(); saveOff = null;
      if (!state.dirty) return;
      state.dirty = false;
      const note = current();
      try {
        const saved = await N.save(note);
        state.notes[state.scope] = saved;
        status.textContent = saved ? T('notes.savedAt', { time: fmtTime(saved.updated) }) : T('notes.empty');
        Mochi.tools.refreshBadge?.();
      } catch (err) {
        state.dirty = true;
        status.textContent = err.code === 'quota' ? T('notes.full') : T('notes.saveFailed');
        companion.setMood('sad');
        companion.say(err.code === 'quota' ? T('notes.full') : T('notes.saveFailed'), 3600);
      }
    }

    function setText(value, caret) { text.value = value; text.setSelectionRange(caret, caret); state.dirty = true; queueSave(); }
    function addBox() {
      const v = text.value, pos = text.selectionStart ?? v.length;
      const lineStart = v.lastIndexOf('\n', pos - 1) + 1;
      const atEmptyLine = v.slice(lineStart, pos).trim() === '' && (v[pos] === '\n' || pos === v.length);
      const insert = atEmptyLine ? '[ ] ' : `${pos === lineStart ? '' : '\n'}[ ] `;
      setText(v.slice(0, pos) + insert + v.slice(pos), pos + insert.length);
      text.focus();
    }
    function ticked(on) { if (on) { companion.play('squish'); companion.flashFace({ eyes: 'happy', mouth: 'smile' }, 700); } }

    scope.on(text, 'input', () => { state.dirty = true; queueSave(); });
    scope.on(text, 'click', () => {
      const r = toggleAt(text.value, text.selectionStart);
      if (r) { const c = text.selectionStart; setText(r.text, c); ticked(r.ticked); }
    });
    scope.on(text, 'keydown', ev => {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        const r = toggleAt(text.value, text.selectionStart, { anywhereOnLine: true });
        if (r) { const c = text.selectionStart; setText(r.text, c); ticked(r.ticked); } else addBox();
      }
    });
    // Esc closes (from anywhere while the notepad is open).
    scope.on(document, 'keydown', ev => { if (ev.key === 'Escape' && ui) { ev.stopPropagation(); close(); } }, true);
    // Leaving the page: save now.
    scope.on(window, 'pagehide', () => flush());

    // Movable by its top.
    scope.on(head, 'pointerdown', ev => {
      if (ev.target.closest('button')) return;
      const r = el.getBoundingClientRect(), dx = ev.clientX - r.left, dy = ev.clientY - r.top;
      head.setPointerCapture(ev.pointerId);
      const move = e => place(e.clientX - dx, e.clientY - dy);
      const offMove = scope.on(head, 'pointermove', move);
      const offUp = scope.on(head, 'pointerup', () => { offMove(); offUp(); Mochi.store.set('notes.pos', { x: Math.round(el.getBoundingClientRect().left), y: Math.round(el.getBoundingClientRect().top) }); });
    });
    function place(x, y) {
      const w = el.offsetWidth || 280, hgt = el.offsetHeight || 260;
      el.style.left = `${Math.round(Math.max(4, Math.min(innerWidth - w - 4, x)))}px`;
      el.style.top = `${Math.round(Math.max(4, Math.min(innerHeight - hgt - 4, y)))}px`;
    }
    const saved = await Mochi.store.get('notes.pos', null);
    if (saved) place(saved.x, saved.y);
    else { const r = companion.root.getBoundingClientRect(); place(r.left - 300, r.top - 200); }

    show();
    // Mochi holds the notepad.
    companion.hold('notepad');
    companion.play('hop');
    engine.react?.({ mood: 'happy', hold: 1500 });
    companion.say(T('notes.hello'), 1800);
    requestAnimationFrame(() => text.focus({ preventScroll: true }));

    async function close() {
      if (!ui) return;
      await flush();
      scope.dispose();
      el.remove();
      ui = null;
      companion.hold(null);
      companion.el.focus({ preventScroll: true });
    }
    return true;
  }

  // ——— All notes: every site, search, open, delete, export / import ———
  async function showAll(ctx) {
    const { panel, companion, engine } = ctx;
    const { h, downloadText, shortDate } = Mochi.ui;
    Mochi.menuInstance?.close();
    const notes = await N.all();
    const others = await N.elsewhere().catch(() => []);
    const search = h('input', { class: 'lib-input notes-search', type: 'search', placeholder: T('notes.search'), 'aria-label': T('notes.search') });
    const list = h('div', { class: 'notes-list', 'aria-live': 'polite' });
    const here = Mochi.noteUrl.normalize(location.href);
    const openUrl = n => (n.scope === 'site' ? `${/^127\.|^localhost/.test(n.host) ? 'http' : 'https'}://${n.host}/` : n.url);
    function render() {
      const q = search.value.trim().toLowerCase();
      const shown = notes.filter(n => !q || `${n.title} ${n.url} ${n.host} ${n.text}`.toLowerCase().includes(q));
      const bySite = {};
      for (const n of shown) (bySite[n.host || '—'] = bySite[n.host || '—'] || []).push(n);
      const groups = Object.entries(bySite).sort(([a], [b]) => a.localeCompare(b)).map(([host, ns]) => h('section', { class: 'blk notes-site' },
        h('h4', { text: `${host} · ${ns.length}` }),
        h('ul', { class: 'pocket' }, ...ns.map(n => {
          let sure = false;
          const del = h('button', { class: 'px-btn danger', type: 'button', 'data-act': 'note-delete', onclick: async () => {
            if (!sure) { sure = true; del.textContent = `✕ ${T('notes.sure')}`; return; }
            await N.remove(n.key);
            notes.splice(notes.indexOf(n), 1);
            Mochi.tools.refreshBadge?.();
            engine.removed?.();
            render();
          } }, `✕ ${T('panel.delete')}`);
          const isHere = here && (n.key === `page:${here.page}` || n.key === `site:${here.site}`);
          return h('li', { class: 'pk note-row', 'data-key': n.key },
            h('div', { class: 'pk-head' },
              h('i', { class: 'note-chip', style: { background: PAPERS[n.color] || PAPERS.butter } }),
              h('div', { class: 'pk-title' }, h('b', { text: n.scope === 'site' ? T('notes.wholeSite') : (n.title || n.url) }), h('span', { text: `${shortDate(new Date(n.updated).toISOString())} · ${n.text.split('\n')[0].slice(0, 60)}` }))),
            h('div', { class: 'row' },
              isHere
                ? h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'note-edit', onclick: () => { panel.close(); open(ctx, { scope: n.scope }); } }, `✎ ${T('notes.edit')}`)
                : h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'note-open', onclick: () => window.open(openUrl(n), '_blank', 'noopener') }, `↗ ${T('notes.open')}`),
              h('button', { class: 'px-btn', type: 'button', 'data-act': 'note-claude', onclick: () => sendToClaude(ctx, n) }, `✎→ ${T('notes.toClaudeShort')}`),
              del));
        }))));
      list.replaceChildren(...(groups.length ? groups : [h('div', { class: 'empty' }, h('p', { text: notes.length ? T('notes.noMatch') : T('notes.none') }))]));
    }
    search.addEventListener('input', render);
    const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      try {
        const r = await N.importJson(await f.text());
        companion.say(T('notes.imported', { n: r.added + r.updated }), 2600);
        Mochi.tools.refreshBadge?.();
        showAll(ctx);
      } catch (err) { companion.setMood('sad'); companion.say(err.code === 'quota' ? T('notes.full') : T('notes.badFile'), 3000); }
    } });
    const footer = h('div', { class: 'row' },
      h('button', { class: 'px-btn', type: 'button', 'data-act': 'notes-export-json', onclick: async () => { downloadText('mochi-notes.json', N.toJson(await N.all()), companion.shadow, 'application/json'); ctx.actions.downloaded('mochi-notes.json'); } }, '⤓ JSON'),
      h('button', { class: 'px-btn', type: 'button', 'data-act': 'notes-export-md', onclick: async () => { downloadText('mochi-notes.md', N.toMarkdown(await N.all()), companion.shadow); ctx.actions.downloaded('mochi-notes.md'); } }, '⤓ Markdown'),
      h('button', { class: 'px-btn', type: 'button', 'data-act': 'notes-import', onclick: () => fileInput.click() }, `⤒ ${T('notes.import')}`),
      fileInput);
    render();
    panel.open(T('menu.allNotes'), T('notes.count', { n: notes.length }), [
      h('div', { class: 'blk' }, search),
      list,
      others.length ? h('section', { class: 'blk' }, h('h4', { text: T('notes.elsewhere') }), h('p', { class: 'note', text: others.map(o => `${o.host}: ${o.title || '…'}`).join(' · ') })) : null,
      h('p', { class: 'note', text: T('notes.private') }),
    ], footer);
    panel.view = 'notes';
    requestAnimationFrame(() => search.focus({ preventScroll: true }));
    return true;
  }

  // ——— Send to Claude: into the pocket (on claude.ai: straight into the message box; never sent) ———
  const pasteText = n => `${T('notes.claudeIntro', { where: n.scope === 'site' ? n.host : (n.title || n.url) })}\n\n${n.text.trim()}`;
  const prev = Mochi.promptFor;
  Mochi.promptFor = entry => (entry?.kind === 'note' ? entry.paste : prev(entry));
  async function sendToClaude(ctx, n) {
    if (!n?.text?.trim()) { ctx.companion.say(T('notes.empty'), 1800); return false; }
    if (ctx.isClaude) {
      if (ctx.panel.isOpen) ctx.panel.close();
      const ok = await Mochi.insertIntoComposer(pasteText(n));
      ctx.engine.pasted(ok);
      return ok;
    }
    await Mochi.pocket.add({
      v: 1, id: `note_${Date.now().toString(36)}`, kind: 'note', url: n.url || location.href.split('#')[0], host: n.host, title: n.scope === 'site' ? n.host : (n.title || n.url),
      at: new Date().toISOString(), colors: [], vibe: [{ id: 'note', label: T('notes.pocketChip') }], paste: pasteText(n),
    }, { offered: false });
    ctx.engine.saved();
    ctx.companion.say(T('notes.inPocket'), 3000);
    return true;
  }

  Mochi.toolImpl.notes = {
    open, toggleAt, PAPERS, showAll, sendToClaude,
    close: () => ui?.close(),
    get isOpen() { return !!ui; },
  };

  // Test hooks (local pages only): type into the open notepad, read it.
  Mochi.debugHooks.notesType = async ({ text, scope, color } = {}) => {
    if (!ui) return null;
    if (scope && scope !== ui.state.scope) ui.el.querySelector(`[data-scope="${scope}"]`).click();
    await new Promise(r => setTimeout(r, 30));
    if (color) ui.el.querySelector(`[data-color="${color}"]`).click();
    if (text !== undefined) { ui.text.value = text; ui.text.dispatchEvent(new Event('input')); }
    return { scope: ui.state.scope, color: ui.state.color };
  };
  Mochi.debugHooks.notesRead = () => (ui ? { open: true, scope: ui.state.scope, text: ui.text.value, color: ui.state.color, status: ui.status.textContent } : { open: false });
  Mochi.debugHooks.notesAll = async () => ({ list: await N.list(), notes: await N.all() });
})();
