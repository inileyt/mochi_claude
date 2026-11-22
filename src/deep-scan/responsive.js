/*
 * Mochi — Deep Scan, Task 2b: responsive behaviour. The page is laid out at
 * 1440, 1024, 768 and 390 px (Emulation.setDeviceMetricsOverride, restored
 * afterwards) and compared with 1440: columns that collapse, things that hide
 * or appear (a burger instead of the nav), heading sizes, region heights.
 * The real breakpoints come from the page's @media rules (src/deep-scan/sheets.js).
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const D = Mochi.deepScan;
  const WIDTHS = [1440, 1024, 768, 390];
  const sel = n => Mochi.deepStructure.sel(n);

  async function setWidth(scan, width) {
    await scan.cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width <= 768, screenWidth: width, screenHeight: 900 });
    await scan.sleep(350);
    await Mochi.deepShots.frames(2);
  }
  D.setWidth = setWidth;
  D.WIDTHS = WIDTHS;

  /** What a width looks like: visibility of every analysed element, layouts of the layout roots, heading sizes, region heights. */
  async function snapshot(scan) {
    const vis = new Map();
    let k = 0;
    for (const n of scan.nodes) {
      if (!n.el.isConnected) continue;
      const cs = getComputedStyle(n.el);
      const r = n.el.getBoundingClientRect();
      vis.set(n.i, cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0);
      if (++k % 400 === 0) await scan.breathe();
    }
    const layouts = {};
    for (const r of scan.regions) {
      const layoutEl = r.layoutEl || r.el;
      const els = [[r.id, layoutEl], ...(scan.components || []).filter(c => c.items[0]?.el.parentElement && r.el.contains(c.items[0].el) && c.items[0].el.parentElement !== layoutEl).map(c => [c.id, c.items[0].el.parentElement])];
      for (const [id, el] of els) {
        const cs = getComputedStyle(el);
        const cols = cs.display.includes('grid') ? cs.gridTemplateColumns.split(' ').filter(Boolean).length : null;
        layouts[id] = { display: cs.display, cols, template: cols ? Mochi.deepStructure.fitColumns(cs.gridTemplateColumns.split(' ')) || `${cols}` : null, direction: cs.display.includes('flex') ? cs.flexDirection : null, wrap: cs.display.includes('flex') ? cs.flexWrap : null };
      }
      layouts[`${r.id}:h`] = Math.round(r.el.getBoundingClientRect().height);
    }
    const headings = {};
    for (const tag of ['h1', 'h2', 'h3']) { const el = document.querySelector(`main ${tag}, body ${tag}`); if (el && !scan.ignore.contains(el)) { const cs = getComputedStyle(el); headings[tag] = `${cs.fontSize}/${cs.lineHeight}`; } }
    return { vis, layouts, headings, docHeight: document.documentElement.scrollHeight };
  }

  function diff(scan, base, cur) {
    const changes = [];
    const label = id => { const r = scan.regions.find(x => x.id === id); if (r) return r.name; const c = scan.components.find(x => x.id === id); return c ? `${c.name} list` : id; };
    for (const [id, l] of Object.entries(cur.layouts)) {
      const b = base.layouts[id];
      if (id.endsWith(':h') || !b) continue;
      if (b.cols !== l.cols && (b.cols || l.cols)) changes.push({ what: 'columns', target: label(id), from: b.cols || 1, to: l.cols || 1, template: l.template, text: `${label(id)}: ${b.cols || 1} → ${l.cols || 1} column${(l.cols || 1) > 1 ? 's' : ''}${l.template && l.cols > 1 ? ` (${l.template})` : ''}` });
      if (b.direction && l.direction && b.direction !== l.direction) changes.push({ what: 'direction', target: label(id), from: b.direction, to: l.direction, text: `${label(id)}: flex ${b.direction} → ${l.direction}` });
      if (b.wrap && l.wrap && b.wrap !== l.wrap) changes.push({ what: 'wrap', target: label(id), from: b.wrap, to: l.wrap, text: `${label(id)}: ${l.wrap === 'wrap' ? 'wraps onto more lines' : 'no longer wraps'}` });
      if (b.display !== l.display && (b.display === 'none' || l.display === 'none')) changes.push({ what: 'display', target: label(id), from: b.display, to: l.display, text: `${label(id)}: ${l.display === 'none' ? 'hidden' : 'shown'}` });
    }
    // Elements that disappear or appear (topmost only: not every child of a hidden nav).
    const nodes = scan.nodes;
    const changed = i => base.vis.get(i) !== cur.vis.get(i);
    for (const n of nodes) {
      if (!changed(n.i)) continue;
      if (n.parent !== null && changed(n.parent) && cur.vis.get(n.parent) === cur.vis.get(n.i)) continue;
      if (n.rect.w * n.rect.h < 64 && !n.el.matches('button, a, nav, [role="button"]')) continue;
      const shown = cur.vis.get(n.i);
      const role = n.el.matches('nav, [role="navigation"]') ? 'navigation' : n.el.matches('button[aria-controls], button[aria-expanded], .burger, .hamburger, [class*="menu-toggle"], [class*="burger"]') ? (shown ? 'menu button (burger)' : 'menu button') : n.el.matches('a, button') ? 'control' : n.tag;
      changes.push({ what: shown ? 'shown' : 'hidden', target: sel(n), role, text: `${sel(n)}${role !== n.tag ? ` (${role})` : ''} ${shown ? 'appears' : 'is hidden'}` });
      if (changes.length > 80) break;
    }
    for (const [tag, v] of Object.entries(cur.headings)) if (base.headings[tag] && base.headings[tag] !== v) changes.push({ what: 'type', target: tag, from: base.headings[tag], to: v, text: `${tag}: ${base.headings[tag]} → ${v}` });
    // The same change on several look-alike elements: one line with a count.
    const merged = new Map();
    for (const c of changes) { const m = merged.get(c.text); if (m) m.count = (m.count || 1) + 1; else merged.set(c.text, { ...c }); }
    return [...merged.values()].map(c => (c.count > 1 ? { ...c, text: `${c.text} (×${c.count})` } : c));
  }

  async function run(scan) {
    if (!scan.nodes) return;
    const out = [];
    let base = null;
    try {
      for (const [k, width] of WIDTHS.entries()) {
        scan.check();
        await setWidth(scan, width);
        const snap = await snapshot(scan);
        if (!base) base = snap;
        const changes = width === WIDTHS[0] ? [] : diff(scan, base, snap);
        out.push({ width, pageHeight: snap.docHeight, burger: changes.some(c => /burger/.test(c.role || '')), changes });
        scan.progress((k + 1) / WIDTHS.length);
      }
    } finally {
      await scan.cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
      await scan.sleep(250);
    }
    const bp = scan.spec.responsive?.breakpoints || [];
    scan.spec.responsive = {
      ...(scan.spec.responsive || {}),
      capturedAt: innerWidth,
      widths: out,
      summary: out.filter(w => w.changes.length).map(w => `≤${w.width}px: ${w.changes.slice(0, 6).map(c => c.text).join('; ')}`),
      note: bp.length ? `Breakpoints from the page's CSS: ${bp.map(b => `${b.kind}-width ${b.px}px`).join(', ')}.` : 'No width breakpoints found in the stylesheets (the layout may be fluid or set by JavaScript).',
    };
  }

  D.addPhase({ id: 'responsive', order: 30, cdp: true, label: 'deep.step.responsive', budget: 25000, weight: 2, run });
})();
