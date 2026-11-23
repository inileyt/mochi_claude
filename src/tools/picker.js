/*
 * Mochi — color picker (loaded the first time you use it). Mochi takes out a tiny pipette and
 * leans in; Chrome's EyeDropper lets you pick any pixel on the screen (Esc cancels). The card
 * shows the color in HEX / RGB / HSL / OKLCH with a name (HEX is copied right away), the last
 * 24 colors (click to copy, drag or Alt+←/→ to reorder, Clear), a WCAG contrast check (two
 * picked colors, or one and the page background) and the palette as CSS / Tailwind / JSON.
 * The history stays in this browser (and follows you with Chrome sync).
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const M = Mochi.colorMath;
  const T = (k, v) => Mochi.t(k, v);
  const KEY = 'colors.history';
  const MAX = 24;

  let state = { current: null, second: null, exportKind: 'css', ctx: null };

  const history = async () => (await Mochi.store.get(KEY, [])) || [];
  async function remember(hex) {
    await Mochi.store.update(KEY, list => [hex, ...(Array.isArray(list) ? list : []).filter(x => x !== hex)].slice(0, MAX), []);
  }

  /** The page's own background (body, else html; transparent counts as white). */
  function pageBackground() {
    for (const el of [document.body, document.documentElement]) {
      if (!el) continue;
      const c = getComputedStyle(el).backgroundColor;
      const m = /rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?/.exec(c);
      if (m && (m[4] === undefined || Number(m[4]) > 0.5)) return Mochi.imageColor.hex([+m[1], +m[2], +m[3]]);
    }
    return '#ffffff';
  }

  /** Chrome's EyeDropper (needs the click that opened the tool). → '#rrggbb' or null (Esc). */
  async function eyedrop(ctx) {
    const { companion } = ctx;
    companion.hold('pipette');
    companion.el.classList.add('lean');
    companion.setMood('curious');
    try {
      const res = await new globalThis.EyeDropper().open();
      return String(res?.sRGBHex || '').toLowerCase() || null;
    } catch (_) {
      return null; // Esc, or the page lost focus
    } finally {
      companion.hold(null);
      companion.el.classList.remove('lean');
    }
  }

  async function open(ctx, opts = {}) {
    state.ctx = ctx;
    const { companion, engine } = ctx;
    if (typeof globalThis.EyeDropper !== 'function') { companion.say(T('picker.unsupported'), 2600); return false; }
    Mochi.menuInstance?.close();
    if (ctx.panel.isOpen && ctx.panel.view !== 'picker') ctx.panel.close();
    const hex = opts.hex || (await eyedrop(ctx));
    if (!hex) { engine.pickCancel?.(); return false; }
    if (opts.second) state.second = hex; else { state.current = hex; state.second = null; ctx.emit?.('colorPicked', hex); }
    await remember(hex);
    render();
    if (!opts.second) {
      const f = M.formats(hex);
      await Mochi.ui.copyText(f.hex, companion.shadow);
      companion.setMood('happy');
      companion.play('hop');
      companion.say(T('picker.copied', { hex: f.hex }), 2400);
    } else reactToContrast();
    return hex;
  }

  function reactToContrast() {
    const { companion } = state.ctx;
    if (!state.current || !state.second) return;
    const w = M.wcag(state.current, state.second);
    if (w.aa) { companion.setMood('happy'); companion.flashFx('thumb', 2400); companion.play('hop'); companion.say(T('picker.goodContrast', { ratio: w.ratio }), 2600); }
    else { companion.setMood('sad'); companion.flashFace({ brows: 'sad', mouth: 'small-o' }, 2400); companion.say(T(w.aaLarge ? 'picker.largeOnly' : 'picker.badContrast', { ratio: w.ratio }), 3000); }
  }

  async function render() {
    const ctx = state.ctx;
    const { companion, panel } = ctx;
    const { h, copyText } = Mochi.ui;
    const copy = async (text, label) => { await copyText(text, companion.shadow); ctx.actions.copied(label); };
    const f = M.formats(state.current);
    const list = await history();

    const rows = [['HEX', f.hex], ['RGB', f.rgb], ['HSL', f.hsl], ['OKLCH', f.oklch]].map(([k, v]) => h('div', { class: 'pc-row' },
      h('span', { class: 'k', text: k }), h('code', { class: 'v', text: v }),
      h('button', { class: 'px-btn', type: 'button', 'data-act': `pc-copy-${k.toLowerCase()}`, 'aria-label': T('panel.copyThis', { what: v }), onclick: () => copy(v, v) }, '⧉')));

    // ——— the history strip: click to copy, drag (or Alt+←/→) to reorder ———
    let dragFrom = null;
    const strip = h('div', { class: 'pc-strip', role: 'list', 'aria-label': T('picker.history') }, ...list.map((hex, i) => h('button', {
      class: 'pc-cell', type: 'button', role: 'listitem', draggable: 'true', 'data-hex': hex, title: `${hex} · ${T('picker.dragHint')}`, 'aria-label': hex,
      'aria-current': hex === state.current ? 'true' : null, style: { background: hex },
      onclick: async () => { state.current = hex; state.second = null; await copy(hex.toUpperCase(), hex.toUpperCase()); await render(); panel.sheet.querySelector(`.pc-cell[data-hex="${hex}"]`)?.focus(); },
      ondragstart: ev => { dragFrom = i; ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', hex); },
      ondragover: ev => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; },
      ondrop: ev => { ev.preventDefault(); if (dragFrom !== null) move(dragFrom, i); },
      onkeydown: ev => { if (ev.altKey && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) { ev.preventDefault(); move(i, i + (ev.key === 'ArrowLeft' ? -1 : 1), true); } },
    })));
    async function move(from, to, keepFocus = false) {
      const cur = await history();
      if (to < 0 || to >= cur.length || from === to) return;
      const [x] = cur.splice(from, 1);
      cur.splice(to, 0, x);
      await Mochi.store.set(KEY, cur);
      await render();
      if (keepFocus) panel.sheet.querySelector(`.pc-cell[data-hex="${x}"]`)?.focus();
    }

    // ——— contrast ———
    const second = state.second;
    const w = second ? M.wcag(state.current, second) : null;
    const pass = ok => h('span', { class: `chip ${ok ? 'main' : 'ghost'} pc-pass`, 'data-ok': String(ok), text: ok ? '✓' : '✗' });
    const contrast = h('section', { class: 'blk', 'data-sec': 'contrast' }, h('h4', { text: T('picker.contrast') }),
      w ? h('div', { class: 'pc-contrast' },
        h('div', { class: 'pc-sample', style: { background: second, color: state.current } }, 'Aa', h('small', { text: T('picker.sample') })),
        h('div', {},
          h('p', { class: 'pc-ratio', 'data-ratio': String(w.ratio), text: `${w.ratio} : 1` }),
          h('table', { class: 'pc-table' },
            h('tr', {}, h('th', {}), h('th', { text: 'AA' }), h('th', { text: 'AAA' })),
            h('tr', {}, h('th', { text: T('picker.normal') }), h('td', {}, pass(w.aa)), h('td', {}, pass(w.aaa))),
            h('tr', {}, h('th', { text: T('picker.large') }), h('td', {}, pass(w.aaLarge)), h('td', {}, pass(w.aaaLarge)))))) : null,
      h('div', { class: 'row' },
        h('button', { class: 'px-btn', type: 'button', 'data-act': 'pc-second', onclick: () => open(ctx, { second: true }) }, `◉ ${T('picker.pickSecond')}`),
        h('button', { class: 'px-btn', type: 'button', 'data-act': 'pc-bg', onclick: () => { state.second = pageBackground(); render(); reactToContrast(); } }, `▭ ${T('picker.vsBackground')}`)));

    // ——— export ———
    const box = h('textarea', { class: 'export', readonly: true, spellcheck: 'false', 'aria-label': T('picker.export') });
    const tabs = h('div', { class: 'tabs', role: 'tablist' }, ...[['css', 'CSS'], ['tailwind', 'Tailwind'], ['json', 'JSON']].map(([id, label]) => h('button', {
      class: 'px-btn tab', type: 'button', role: 'tab', 'data-format': id, 'aria-selected': String(id === state.exportKind), onclick: () => { state.exportKind = id; render(); },
    }, label)));
    box.value = list.length ? M.exportAs(list, state.exportKind) : '';

    panel.open(T('picker.title'), `${f.hex} · ${f.name}`, h('div', { class: 'pc' },
      h('div', { class: 'pc-big', style: { background: f.hex }, 'data-hex': f.hex }, h('span', { text: f.name })),
      h('section', { class: 'blk' }, ...rows),
      h('section', { class: 'blk', 'data-sec': 'history' }, h('h4', { text: `${T('picker.history')} · ${list.length}/${MAX}` }), strip,
        h('div', { class: 'row' }, h('button', { class: 'px-btn danger', type: 'button', 'data-act': 'pc-clear', onclick: async () => { await Mochi.store.set(KEY, []); render(); } }, `✕ ${T('picker.clear')}`))),
      contrast,
      h('section', { class: 'blk', 'data-sec': 'export' }, h('h4', { text: T('picker.export') }), tabs, box,
        h('div', { class: 'row' },
          h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'pc-copy-export', onclick: () => copy(box.value, T('picker.palette')) }, `⧉ ${T('panel.copy')}`),
          Mochi.pocket ? h('button', { class: 'px-btn', type: 'button', 'data-act': 'pc-pocket', onclick: () => savePalette(list) }, `▣ ${T('img.save')}`) : null)),
    ), h('div', { class: 'row' }, h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'pc-again', onclick: () => open(ctx) }, `◉ ${T('picker.again')}`)));
    panel.view = 'picker';
  }

  // The pocket: the palette as CSS variables, ready to paste on claude.ai.
  const prev = Mochi.promptFor;
  Mochi.promptFor = entry => (entry?.kind === 'palette' ? entry.paste : prev(entry));
  async function savePalette(list) {
    if (!list.length) return;
    const ctx = state.ctx;
    await Mochi.pocket.add({
      v: 1, id: `pal_${Date.now().toString(36)}`, kind: 'palette', url: location.href.split('#')[0], host: location.hostname || 'local',
      title: T('picker.palette'), at: new Date().toISOString(), colors: list.map(hex => ({ hex, role: '' })),
      vibe: [{ id: 'palette', label: T('picker.palette') }], paste: `${T('picker.pasteIntro')}\n\n${M.exportAs(list, 'css')}`,
    }, { offered: ctx.isClaude });
    ctx.engine.saved();
  }

  Mochi.toolImpl.picker = {
    open, pageBackground, history,
    close: () => { if (state.ctx?.panel.view === 'picker') state.ctx.panel.close(); },
    get isOpen() { return state.ctx?.panel.view === 'picker' && state.ctx.panel.isOpen; },
  };
  Mochi.debugHooks.pickerState = async () => ({ current: state.current, second: state.second, history: await history(), formats: state.current ? M.formats(state.current) : null, wcag: state.current && state.second ? M.wcag(state.current, state.second) : null });
})();
