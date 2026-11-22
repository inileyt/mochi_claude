/*
 * Mochi — Deep Scan screenshots (Page.captureScreenshot), with Mochi hidden.
 *
 * Unless "this is my own site" is ticked, each screenshot also remembers where
 * the texts and pictures were (in its own coordinates); the output step paints
 * them over with neutral blocks (src/deep-scan/output-files.js), so the pictures
 * in the zip show the layout, not the brand, the photos or the copy.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const frames = (n = 2) => new Promise(r => { const step = k => (k ? requestAnimationFrame(() => step(k - 1)) : r()); step(n); });
  const MAX_H = 12000;

  function b64(data) {
    const bin = atob(data);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** Where texts and pictures are inside an area (document coordinates → relative to the area). */
  function redactionBoxes(area, ignore) {
    const texts = [], images = [];
    const sx = scrollX, sy = scrollY;
    const inArea = r => r.width > 1 && r.height > 1 && r.right + sx > area.x && r.left + sx < area.x + area.width && r.bottom + sy > area.y && r.top + sy < area.y + area.height;
    const rel = r => ({ x: Math.round(r.left + sx - area.x), y: Math.round(r.top + sy - area.y), w: Math.round(r.width), h: Math.round(r.height) });
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let n = 0;
    while (walker.nextNode() && n < 4000) {
      const t = walker.currentNode;
      if (!t.nodeValue.trim() || ignore?.contains(t.parentElement)) continue;
      const parent = t.parentElement;
      const cs = parent && getComputedStyle(parent);
      if (!cs || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      range.selectNodeContents(t);
      for (const r of range.getClientRects()) if (inArea(r)) { texts.push({ ...rel(r), color: cs.color }); n++; }
    }
    for (const el of document.querySelectorAll('img, picture, video, canvas, iframe, svg, object, embed, [style*="background-image"]')) {
      if (ignore?.contains(el) || el.closest('svg') !== el && el.tagName.toLowerCase() === 'svg' && el.parentElement.closest('svg')) continue;
      const r = el.getBoundingClientRect();
      if (!inArea(r)) continue;
      const small = r.width <= 32 && r.height <= 32;
      images.push({ ...rel(r), kind: small ? 'icon' : el.tagName.toLowerCase(), radius: getComputedStyle(el).borderTopLeftRadius });
    }
    for (const el of document.querySelectorAll('*')) { // CSS background images (photos, illustrations)
      if (images.length > 600) break;
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg.includes('url(') || ignore?.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (inArea(r)) images.push({ ...rel(r), kind: 'background', radius: getComputedStyle(el).borderTopLeftRadius });
    }
    return { texts, images };
  }

  /**
   * capture(scan, { name, full, clip: {x,y,width,height} in document px, meta })
   * → pushes { name, data, clip, redact, meta } into scan.shots.
   */
  async function capture(scan, { name, full = false, clip = null, meta = {} }) {
    scan.hideMochi(true);
    await frames(2);
    try {
      let area = clip;
      if (full) {
        const m = await scan.cdp.send('Page.getLayoutMetrics');
        const size = m.cssContentSize || m.contentSize;
        area = { x: 0, y: 0, width: Math.ceil(size.width), height: Math.min(Math.ceil(size.height), MAX_H) };
      }
      if (!area) area = { x: scrollX, y: scrollY, width: innerWidth, height: innerHeight };
      area = { x: Math.max(0, Math.round(area.x)), y: Math.max(0, Math.round(area.y)), width: Math.max(1, Math.round(area.width)), height: Math.max(1, Math.round(area.height)) };
      const redact = scan.opts.ownSite ? null : redactionBoxes(area, scan.ignore);
      const { data } = await scan.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true, clip: { ...area, scale: 1 } });
      const shot = { name, data: b64(data), clip: area, redact, meta: { width: innerWidth, ...meta } };
      scan.shots = scan.shots.filter(s => s.name !== name);
      scan.shots.push(shot);
      return shot;
    } finally { scan.hideMochi(false); }
  }

  Mochi.deepShots = { capture, redactionBoxes, frames };
})();
