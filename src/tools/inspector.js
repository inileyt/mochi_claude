/*
 * Mochi — hover font inspector (loaded the first time you use it; Alt+F or Menu → Tools).
 * Mochi puts on his reading glasses and the pointer becomes a little magnifier. Point at any
 * text: a small tooltip shows the font really used (and the stack), size, weight, line height,
 * letter spacing, color and its contrast with the background, with an "Aa" preview. Click to
 * pin it, then Copy CSS or Copy for AI. Esc (or Alt+F again) puts the glasses away.
 *
 * A clear glass covers the page while inspecting, so no click ever reaches the page and its
 * :hover styles don't switch on; the hovered element is outlined on Mochi's own layer (the page's
 * CSS is never touched). Work happens at most once per animation frame. Open shadow roots and
 * same-origin frames are looked into. Everything stops when it's off (no listeners, no timers).
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const D = Mochi.fontDetect;
  const T = (k, v) => Mochi.t(k, v);
  // Reading glasses (the focus mode's round frames), worn while inspecting.
  const GLASSES = { id: 'inspector-glasses', name: 'outfit.focusGlasses', author: 'Mochi', slot: 'face', at: [13, 21], pixels: ['.OOOO....OOOO.', 'OO..OOOOOO..OO', '.O..O....O..O.', '.O..O....O..O.', '.OOOO....OOOO.'], palette: { O: '#2b1d3a' } };
  // A pixel magnifier for the pointer (its hot spot is the lens centre).
  const CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" shape-rendering="crispEdges"><path d="M5 1h6v1h2v2h1v6h-1v2h-2v1H5v-1H3v-2H2V4h1V2h2z" fill="#2b1208"/><path d="M5 3h6v1h1v6h-1v1H5v-1H4V4h1z" fill="#bfe6ff"/><path d="M5 4h2v1H5z" fill="#fff"/><path d="M12 12h2v2h2v2h2v2h2v2h-2v-2h-2v-2h-2v-2h-2z" fill="#f28c38"/></svg>')}") 8 8, zoom-in`;

  let st = null; // while on: { ctx, scope, catcher, box, tip, x, y, queued, target, info, pinned }
  let frames = 0; // updates done (a test checks nothing happens while off)

  /** The deepest element at a point: through open shadow roots and same-origin frames; Mochi skipped. */
  function elementAt(x, y) {
    const host = st.ctx.companion.host;
    let doc = document, ox = 0, oy = 0, el = null;
    for (let depth = 0; depth < 6; depth++) {
      el = doc.elementsFromPoint(x - ox, y - oy).find(e => e !== host && !host.contains(e)) || null;
      if (!el) return null;
      // Into open shadow roots: the topmost element that belongs to that root (Mochi's glass is on top of everything).
      while (el.shadowRoot) {
        const sr = el.shadowRoot;
        const inner = sr.elementsFromPoint(x - ox, y - oy).find(e => e !== el && sr.contains(e));
        if (!inner) break;
        el = inner;
      }
      if (el.tagName === 'IFRAME') {
        let inner = null;
        try { inner = el.contentDocument; } catch (_) { inner = null; }
        if (!inner?.documentElement) return { el, ox, oy };
        const r = el.getBoundingClientRect();
        ox += r.left + el.clientLeft; oy += r.top + el.clientTop;
        doc = inner;
        continue;
      }
      return { el, ox, oy };
    }
    return el ? { el, ox, oy } : null;
  }
  /** The element that holds the text under the pointer (itself or a close parent). */
  function textElement(el) {
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 4; n = n.parentElement, i++) if (D.hasOwnText(n)) return n;
    return null;
  }

  function schedule() {
    if (st.queued || st.pinned) return;
    st.queued = st.scope.raf(() => { st.queued = null; update(); });
  }
  function update() {
    frames++;
    const hit = elementAt(st.x, st.y);
    const el = hit && textElement(hit.el);
    if (!el) { st.box.hidden = true; st.tip.hidden = true; st.target = null; return; }
    if (el !== st.target) { st.target = el; st.info = D.inspect(el); st.offset = { x: hit.ox, y: hit.oy }; renderTip(); }
    outline();
    placeTip();
  }
  function outline() {
    const r = st.target.getBoundingClientRect();
    Object.assign(st.box.style, { left: `${r.left + st.offset.x - 2}px`, top: `${r.top + st.offset.y - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px` });
    st.box.hidden = false;
  }
  function placeTip() {
    const tip = st.tip;
    tip.hidden = false;
    const w = tip.offsetWidth, hgt = tip.offsetHeight, pad = 8;
    let x = st.x + 16, y = st.y + 18;
    if (x + w > innerWidth - pad) x = st.x - w - 12;
    if (y + hgt > innerHeight - pad) y = st.y - hgt - 12;
    tip.style.left = `${Math.round(Math.max(pad, Math.min(innerWidth - w - pad, x)))}px`;
    tip.style.top = `${Math.round(Math.max(pad, Math.min(innerHeight - hgt - pad, y)))}px`;
  }

  function renderTip() {
    const { h } = Mochi.ui;
    const i = st.info;
    const stack = h('p', { class: 'ins-stack' }, ...i.stack.flatMap((f, k) => [k ? ', ' : '', k === i.usedIndex ? h('b', { text: f }) : f]));
    const chip = (ok, label) => h('span', { class: `chip ${ok ? 'main' : 'ghost'}`, text: `${ok ? '✓' : '✗'} ${label}` });
    st.tip.replaceChildren(
      h('div', { class: 'ins-top' },
        h('span', { class: 'ins-aa', style: { 'font-family': i.cssStack, 'font-weight': String(i.weight), 'font-style': i.style, color: i.color, background: i.background }, text: 'Aa' }),
        h('div', {},
          h('b', { class: 'ins-font', text: i.used }),
          i.sure ? null : h('span', { class: 'ins-prob', text: ` ${T('fonts.probably')}` }),
          stack)),
      h('dl', { class: 'ins-kv' },
        h('dt', { text: T('fonts.size') }), h('dd', { 'data-k': 'size', text: `${i.size.px}px · ${i.size.rem}rem` }),
        h('dt', { text: T('fonts.weight') }), h('dd', { 'data-k': 'weight', text: `${i.weight}${i.style !== 'normal' ? ` ${i.style}` : ''}` }),
        h('dt', { text: T('fonts.lineHeight') }), h('dd', { 'data-k': 'lh', text: i.lineHeight.px ? `${i.lineHeight.px}px (${i.lineHeight.ratio})` : 'normal' }),
        h('dt', { text: T('fonts.spacing') }), h('dd', { 'data-k': 'ls', text: i.letterSpacing.em ? `${i.letterSpacing.css} (${i.letterSpacing.em}em)` : 'normal' }),
        h('dt', { text: T('fonts.color') }), h('dd', { 'data-k': 'color' }, h('i', { class: 'dot', style: { background: i.color } }), ` ${i.color}`),
        h('dt', { text: T('fonts.contrast') }), h('dd', { 'data-k': 'contrast' }, `${i.contrast.ratio}:1${i.bgImage ? ` (${T('fonts.probably')})` : ''} `, chip(i.contrast.aa, 'AA'), ' ', chip(i.contrast.aaa, 'AAA'))),
      st.pinned ? h('div', { class: 'row' },
        h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'ins-css', onclick: () => copy(i.css, 'CSS') }, `⧉ ${T('fonts.copyCss')}`),
        h('button', { class: 'px-btn', type: 'button', 'data-act': 'ins-ai', onclick: () => copy(i.ai, T('fonts.forAi')) }, `⧉ ${T('fonts.copyAi')}`),
        h('button', { class: 'px-btn icon', type: 'button', 'data-act': 'ins-unpin', 'aria-label': T('fonts.unpin'), title: T('fonts.unpin'), onclick: () => unpin() }, '×')) : h('p', { class: 'note', text: T('fonts.clickToPin') }));
  }
  async function copy(text, label) { await Mochi.ui.copyText(text, st.ctx.companion.shadow); st.ctx.actions.copied(label); }
  function unpin() { st.pinned = false; st.tip.classList.remove('pinned'); renderTip(); schedule(); }

  function open(ctx) {
    if (st) return true;
    const { companion } = ctx;
    const { h } = Mochi.ui;
    Mochi.menuInstance?.close();
    if (companion.isTucked) companion.setTucked(false);
    const scope = Mochi.tools.scope('fonts');
    const catcher = h('div', { class: 'ins-catcher', style: { cursor: CURSOR } });
    const box = h('div', { class: 'ins-box', hidden: true });
    const tip = h('div', { class: 'ins-tip', role: 'status', 'aria-live': 'polite', hidden: true });
    const hint = h('div', { class: 'pick-hint ins-hint' }, h('b', { text: T('menu.fonts') }), ` · ${T('fonts.hint')}`);
    companion.shadow.append(catcher, box, tip, hint);
    st = { ctx, scope, catcher, box, tip, hint, x: -1, y: -1, queued: null, target: null, info: null, pinned: false };

    scope.on(catcher, 'pointermove', ev => { st.x = ev.clientX; st.y = ev.clientY; schedule(); }, { passive: true });
    // The glass takes every click: the page never gets one. A click pins (or re-pins) the tooltip.
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'auxclick', 'dblclick', 'contextmenu']) scope.on(catcher, type, ev => { ev.preventDefault(); ev.stopPropagation(); });
    scope.on(catcher, 'click', ev => {
      ev.preventDefault(); ev.stopPropagation();
      st.x = ev.clientX; st.y = ev.clientY;
      st.pinned = false;
      update();
      if (!st.target) return;
      st.pinned = true;
      st.tip.classList.add('pinned');
      renderTip();
      placeTip();
    });
    // Scrolling still works under the glass.
    scope.on(catcher, 'wheel', ev => { scrollBy(ev.deltaX, ev.deltaY); if (!st.pinned) schedule(); else outline(); }, { passive: true });
    scope.on(window, 'scroll', () => { if (st.target) outline(); }, { passive: true, capture: true });
    scope.on(document, 'keydown', ev => {
      if (ev.key === 'Escape' || (ev.altKey && (ev.key === 'f' || ev.key === 'F' || ev.code === 'KeyF'))) { ev.preventDefault(); ev.stopPropagation(); close(); }
    }, true);

    Mochi.outfits.overrides.face = GLASSES;
    Mochi.outfits.apply(companion);
    companion.setMood('curious');
    companion.play('look');
    companion.say(T('fonts.hello'), 2200);
    return true;
  }

  function close() {
    if (!st) return;
    const { companion } = st.ctx;
    st.scope.dispose();
    for (const el of [st.catcher, st.box, st.tip, st.hint]) el.remove();
    st = null;
    if (Mochi.outfits.overrides.face === GLASSES) delete Mochi.outfits.overrides.face;
    Mochi.outfits.apply(companion);
    companion.say(T('fonts.bye'), 1400);
  }

  Mochi.toolImpl.fonts = {
    open, close, elementAt,
    get isOpen() { return !!st; },
    get frames() { return frames; },
  };
  Mochi.toolImpl.fonts.state = () => ({ open: !!st, pinned: !!st?.pinned, frames, info: st?.info ? { ...st.info } : null, tip: st && !st.tip.hidden ? st.tip.textContent : null });
})();
