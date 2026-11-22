/*
 * Mochi — Deep Scan, Task 2a: geometry. The box model of every region and
 * component: sizes in px and relative to the parent and the viewport, padding,
 * margin, gap, max-width, aspect ratio, radius, border; and the page's main
 * content column (width, centring, side padding).
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const D = Mochi.deepScan;
  const r1 = n => Math.round(n * 10) / 10;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);

  /** 560×420 → "4:3"; 1920×1080 → "16:9"; odd ones → "1.43:1". */
  function ratio(w, h) {
    if (!w || !h) return null;
    for (const [a, b] of [[1, 1], [4, 3], [3, 2], [16, 9], [16, 10], [21, 9], [2, 1], [3, 4], [2, 3], [9, 16], [5, 4], [4, 5]]) if (Math.abs(w / h - a / b) < 0.015) return `${a}:${b}`;
    const g = gcd(Math.round(w), Math.round(h));
    return Math.round(w) / g <= 32 ? `${Math.round(w) / g}:${Math.round(h) / g}` : `${r1(w / h)}:1`;
  }
  const four = (cs, prop) => {
    const v = ['Top', 'Right', 'Bottom', 'Left'].map(s => cs[`${prop}${s}${prop === 'border' ? 'Width' : ''}`]);
    return v.every(x => x === v[0]) ? v[0] : v[0] === v[2] && v[1] === v[3] ? `${v[0]} ${v[1]}` : v.join(' ');
  };

  function boxOf(el, parent = el.parentElement) {
    if (!el?.isConnected) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const p = parent?.getBoundingClientRect?.();
    const out = {
      w: Math.round(r.width), h: Math.round(r.height),
      wOfParent: p?.width ? `${r1((r.width / p.width) * 100)}%` : null,
      wOfViewport: `${r1((r.width / innerWidth) * 100)}vw`,
      hOfViewport: `${r1((r.height / innerHeight) * 100)}vh`,
      padding: four(cs, 'padding'), margin: four(cs, 'margin'),
      boxSizing: cs.boxSizing,
    };
    if (cs.rowGap !== 'normal' || cs.columnGap !== 'normal') out.gap = cs.rowGap === cs.columnGap ? cs.rowGap : `${cs.rowGap} ${cs.columnGap}`;
    if (cs.maxWidth !== 'none') out.maxWidth = cs.maxWidth;
    if (cs.minHeight !== '0px' && cs.minHeight !== 'auto') out.minHeight = cs.minHeight;
    if (cs.aspectRatio && cs.aspectRatio !== 'auto') out.aspectRatio = cs.aspectRatio.replace(/\s*\/\s*/, ':').replace(/^auto\s+/, '');
    else if (/^(IMG|VIDEO|CANVAS|IFRAME|PICTURE|SVG)$/i.test(el.tagName)) out.aspectRatio = ratio(r.width, r.height);
    const radius = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius];
    if (radius.some(x => x !== '0px')) out.radius = radius.every(x => x === radius[0]) ? radius[0] : radius.join(' ');
    const bw = four(cs, 'border');
    if (bw !== '0px') out.border = `${bw} ${cs.borderTopStyle} ${cs.borderTopColor}`;
    if (cs.objectFit && /^(IMG|VIDEO)$/.test(el.tagName)) { out.objectFit = cs.objectFit; out.objectPosition = cs.objectPosition; }
    return out;
  }

  /** The page's main content column: the most common centred max-width container. */
  function contentColumn(scan) {
    const counts = new Map();
    for (const r of scan.regions || []) if (r.container) { const k = r.container.maxWidth; counts.set(k, (counts.get(k) || 0) + 1); }
    const [maxWidth, uses] = [...counts].sort((a, b) => b[1] - a[1])[0] || [];
    if (!maxWidth) return null;
    const sample = (scan.regions || []).find(r => r.container?.maxWidth === maxWidth);
    const el = sample && document.querySelector(sample.container.selector);
    const box = el?.getBoundingClientRect();
    const cs = el && getComputedStyle(el);
    return {
      maxWidth, usedBy: uses,
      widthNow: box ? Math.round(box.width) : null,
      leftNow: box ? Math.round(box.left) : null,
      centred: true,
      sidePadding: cs ? cs.paddingLeft : null,
      contentWidth: box && cs ? Math.round(box.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) : null,
      at: innerWidth,
    };
  }

  async function run(scan) {
    if (!scan.regions) return;
    let i = 0;
    for (const r of scan.regions) {
      const spec = scan.spec.structure.regions.find(x => x.id === r.id);
      spec.geometry = boxOf(r.el, document.body);
      if (r.layoutSelector) {
        const lr = r.el.querySelector(r.layoutSelector.replace(/^(\w+)/, '$1')) || null;
        if (lr) spec.layoutGeometry = boxOf(lr, r.el);
      }
      if (++i % 5 === 0) await scan.breathe();
    }
    for (const c of scan.components || []) {
      const spec = scan.spec.structure.components.find(x => x.id === c.id);
      const first = c.items[0]?.el;
      spec.geometry = boxOf(first);
      // The gap between instances, measured (handy when the parent uses margins instead of gap).
      const a = c.items[0]?.el.getBoundingClientRect(), b = c.items[1]?.el.getBoundingClientRect();
      if (a && b) spec.geometry.spacingBetween = Math.round(Math.abs(b.top - a.top) > 2 ? b.top - a.bottom : b.left - a.right);
      // Images inside the component (their box is part of the design, the picture isn't).
      const img = first?.querySelector('img, picture, video, svg');
      if (img) spec.media = { tag: img.tagName.toLowerCase(), ...boxOf(img, first) };
    }
    scan.spec.geometry = { viewport: { width: innerWidth, height: innerHeight }, contentColumn: contentColumn(scan) };
  }

  Mochi.deepGeometry = { boxOf, ratio };
  D.addPhase({ id: 'geometry', order: 20, cdp: false, label: 'deep.step.geometry', budget: 10000, weight: 1, run });
})();
