/*
 * Mochi — Responsive preview (loaded the first time it's used; Menu → Tools → Preview).
 * Mochi lays the real page out at phone, tablet and desktop widths — the way DevTools' device mode
 * does, by emulating the viewport (Emulation.setDeviceMetricsOverride), so the page's own @media
 * breakpoints really fire — takes a screenshot of each, and flags any width where the content spills
 * past the viewport (a horizontal scrollbar). A light/dark switch re-previews with that colour scheme.
 * The emulation is cleared and the debugger detached as soon as it's done; nothing on the page changes.
 *
 *   Mochi.responsive.capture(scheme) → [{ id, name, w, h, overflow, contentW, shot }]  (needs the debugger)
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const T = (k, v) => Mochi.t(k, v);

  const DEVICES = [
    { id: 'mobile', name: 'Mobile', w: 390, h: 844, mobile: true },
    { id: 'tablet', name: 'Tablet', w: 768, h: 1024, mobile: true },
    { id: 'desktop', name: 'Desktop', w: 1280, h: 800, mobile: false },
  ];
  /** Content wider than the viewport (by more than a rounding pixel) = a horizontal scrollbar. */
  const isOverflow = (contentW, viewW) => contentW > viewW + 1;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function capture(scheme) {
    const out = [];
    for (const d of DEVICES) {
      await Mochi.cdp.send('Emulation.setDeviceMetricsOverride', { width: d.w, height: d.h, deviceScaleFactor: 1, mobile: d.mobile, screenWidth: d.w, screenHeight: d.h });
      await Mochi.cdp.send('Emulation.setEmulatedMedia', scheme ? { features: [{ name: 'prefers-color-scheme', value: scheme }] } : { features: [] }).catch(() => {});
      await sleep(340); // let the page reflow at the new width
      let overflow = false, contentW = d.w;
      try {
        // We set the viewport to d.w, so compare the laid-out content width against that directly
        // (the returned layout-viewport width can lag right after an override).
        const m = await Mochi.cdp.send('Page.getLayoutMetrics');
        contentW = Math.round(m.cssContentSize?.width ?? m.contentSize?.width ?? d.w);
        overflow = isOverflow(contentW, d.w);
      } catch (_) { /* metrics unavailable */ }
      let shot = null;
      try { const s = await Mochi.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: { x: 0, y: 0, width: d.w, height: d.h, scale: 1 } }); shot = `data:image/png;base64,${s.data}`; } catch (_) { /* screenshot blocked */ }
      out.push({ ...d, overflow, contentW, shot });
    }
    return out;
  }

  async function run(scheme) {
    await Mochi.cdp.attach();
    try { return await capture(scheme); }
    finally {
      await Mochi.cdp.send('Emulation.setEmulatedMedia', { features: [] }).catch(() => {});
      await Mochi.cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
      await Mochi.cdp.detach('done').catch(() => {});
    }
  }

  const ERR = { 'no-permission': 'resp.err.permission', 'page-not-allowed': 'resp.err.page', 'restart-needed': 'resp.err.restart', 'already-attached': 'resp.err.attached' };
  function showError(ctx, err) {
    const { h } = Mochi.ui;
    const code = /no-permission|not allowed to attach|debugger/i.test(err?.message || '') ? 'no-permission' : /page-not-allowed|cannot (access|attach)|chrome:/i.test(err?.message || '') ? 'page-not-allowed' : /already-attached|another debugger|devtools/i.test(err?.message || '') ? 'already-attached' : /restart/i.test(err?.message || '') ? 'restart-needed' : null;
    const body = h('div', {}, h('p', { class: 'note', text: T(ERR[code] || 'resp.err.generic') }));
    const footer = h('div', { class: 'row' }, h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'resp-retry', onclick: () => open(ctx) }, T('resp.retry')));
    ctx.panel.open(T('resp.title'), T('resp.errorSub'), body, footer);
    ctx.companion.say(T(ERR[code] || 'resp.err.generic'), 3200);
    return null;
  }

  function render(ctx, devices, scheme) {
    const { companion, panel } = ctx;
    const { h } = Mochi.ui;
    const over = devices.filter(d => d.overflow).length;
    const row = h('div', { class: 'resp-row' });
    for (const d of devices) {
      const fig = h('figure', { class: `resp-dev${d.overflow ? ' over' : ''}` });
      if (d.shot) {
        const a = h('a', { href: d.shot, download: `${d.id}-${d.w}.png`, title: T('resp.save') }, h('img', { class: 'resp-shot', alt: `${d.name} ${d.w}px`, src: d.shot }));
        fig.append(a);
      } else fig.append(h('div', { class: 'resp-shot blocked', text: '—' }));
      fig.append(h('figcaption', { class: 'resp-cap' },
        h('b', { text: `${d.name} · ${d.w}` }),
        d.overflow ? h('span', { class: 'resp-badge', text: T('resp.overflow', { px: d.contentW - d.w }) }) : h('span', { class: 'resp-ok', text: '✓' })));
      row.append(fig);
    }
    const schemeBtn = (val, label) => h('button', { class: `px-btn${(scheme || 'site') === val ? ' primary' : ''}`, type: 'button', 'data-scheme': val, onclick: () => open(ctx, { scheme: val === 'site' ? null : val }) }, label);
    const body = h('div', { class: 'resp' },
      h('p', { class: 'note', text: over ? T('resp.someOverflow', { n: over }) : T('resp.noOverflow') }),
      row,
      h('div', { class: 'row resp-schemes' }, h('span', { class: 'resp-schemes-label', text: T('resp.scheme') }), schemeBtn('site', T('resp.schemeSite')), schemeBtn('light', T('resp.schemeLight')), schemeBtn('dark', T('resp.schemeDark'))));
    const footer = h('div', { class: 'row' },
      h('button', { class: 'px-btn', type: 'button', 'data-act': 'resp-rescan', onclick: () => open(ctx, { scheme }) }, `⟳ ${T('resp.rescan')}`));
    panel.open(T('resp.title'), over ? T('resp.sub', { n: over }) : T('resp.subClean'), body, footer);
    panel.view = 'responsive';
    companion.play(over ? 'wiggle' : 'hop');
    companion.say(over ? T('resp.found', { n: over }) : T('resp.clean'), 2800);
  }

  async function open(ctx, opts = {}) {
    const { companion, panel } = ctx;
    const { h } = Mochi.ui;
    Mochi.menuInstance?.close();
    if (panel.isOpen) panel.close();
    const scheme = opts.scheme || null;
    companion.setMood?.('curious');
    panel.open(T('resp.title'), T('resp.working'), h('p', { class: 'note', text: T('resp.working') }), null);
    companion.say(T('resp.working'), 2200);
    const host = companion.host;
    const prevVis = host?.style.visibility;
    let devices;
    try {
      if (host) host.style.visibility = 'hidden'; // keep Mochi out of the screenshots
      devices = await run(scheme);
    } catch (err) {
      if (host) host.style.visibility = prevVis || '';
      return showError(ctx, err);
    }
    if (host) host.style.visibility = prevVis || '';
    Mochi.responsive.last = devices;
    render(ctx, devices, scheme);
    return devices;
  }

  Mochi.responsive = Object.assign(Mochi.responsive || {}, { DEVICES, isOverflow, capture, run, open });
  (Mochi.toolImpl = Mochi.toolImpl || {}).responsive = { open, close: () => {}, get isOpen() { return false; } };
  if (typeof module !== 'undefined') module.exports = Mochi.responsive;
})();
