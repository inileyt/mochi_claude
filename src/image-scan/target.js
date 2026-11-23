/*
 * Mochi — Image Scan, the page side: which element is "the image", and getting its
 * pixels without touching the page's own canvas rules.
 *
 * Cross-origin images taint a canvas, so Mochi doesn't draw <img> into a canvas. It
 * scrolls the image into view, hides itself, and asks the background for a screenshot
 * of the tab (chrome.tabs.captureVisibleTab); the offscreen worker page crops it.
 * Images taller than the window are captured in tiles (up to 6) and stitched; bigger
 * ones are scanned as the visible part, and the card says so.
 *
 *   Mochi.imageTarget.resolve(el)          → { el, kind, rect } | null   (img · picture · svg · canvas · background)
 *   Mochi.imageTarget.fromSrc(url, hint?)  → the same, for the image the right-click menu named
 *   await Mochi.imageTarget.capture(target, { job, hide, onTile }) → { size, partial, tiles }
 *   await Mochi.imageTarget.direct(target) → a PNG data URL read in the page (same-origin pixels only) | null
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const MIN = 24; // smaller than this is an icon, not an image
  const MAX_TILES = 6;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const frames = n => new Promise(r => { const step = () => (n-- <= 0 ? r() : requestAnimationFrame(step)); step(); });

  const bgUrl = el => {
    const bg = getComputedStyle(el).backgroundImage;
    return bg && bg !== 'none' && /url\(|gradient\(/.test(bg) ? bg : null;
  };
  const kindOf = el => {
    if (!(el instanceof Element)) return null;
    const tag = el.tagName;
    if (tag === 'IMG') return 'img';
    if (tag === 'CANVAS') return 'canvas';
    if (tag === 'VIDEO' && el.poster) return 'img';
    if (tag === 'svg' || tag === 'SVG' || el instanceof SVGSVGElement) return 'svg';
    if (tag === 'PICTURE') return el.querySelector('img') ? 'picture' : null;
    if (bgUrl(el)) return 'background';
    return null;
  };
  const big = r => r.width >= MIN && r.height >= MIN;

  /** The scannable element at or around el: itself, an image inside it at that spot, or a parent with a background. */
  function resolve(el, point = null) {
    if (!el || el.nodeType !== 1) return null;
    if (el.closest?.('mochi-companion')) return null;
    let node = el;
    for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
      let kind = kindOf(node);
      if (kind === 'picture') { node = node.querySelector('img'); kind = 'img'; }
      if (node instanceof SVGElement && !(node instanceof SVGSVGElement)) { node = node.ownerSVGElement || node; kind = 'svg'; }
      if (kind && big(node.getBoundingClientRect())) return { el: node, kind, rect: node.getBoundingClientRect() };
      // A wrapper (a card, a link) around one image: take the biggest image inside it under the pointer.
      if (depth === 0 && node.querySelectorAll) {
        const inner = [...node.querySelectorAll('img, canvas, svg, picture img')].filter(x => {
          const r = x.getBoundingClientRect();
          return big(r) && (!point || (point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom));
        }).sort((a, b) => area(b) - area(a))[0];
        if (inner) return { el: inner, kind: kindOf(inner) === 'picture' ? 'img' : kindOf(inner), rect: inner.getBoundingClientRect() };
      }
    }
    return null;
  }
  const area = el => { const r = el.getBoundingClientRect(); return r.width * r.height; };

  /** The image the right-click menu named (its src), preferring the one just right-clicked. */
  function fromSrc(src, hint = null) {
    if (hint) {
      const t = resolve(hint.el, hint);
      if (t && (!src || t.kind !== 'img' || t.el.currentSrc === src || t.el.src === src)) return t;
    }
    if (!src) return null;
    const same = [...document.images].filter(i => i.currentSrc === src || i.src === src || i.srcset?.includes(src));
    const shown = same.filter(i => big(i.getBoundingClientRect())).sort((a, b) => area(b) - area(a));
    const img = shown[0] || same[0];
    if (img) return { el: img, kind: 'img', rect: img.getBoundingClientRect() };
    // A video poster, or an <image> inside an SVG.
    const other = [...document.querySelectorAll('video[poster], svg image')].find(v => v.poster === src || v.href?.baseVal === src);
    return other ? resolve(other) : null;
  }

  const send = msg => chrome.runtime.sendMessage({ type: 'mochi-image', ...msg }).then(res => {
    if (!res?.ok) throw new Error(res?.error || 'failed');
    return res.result;
  });

  /**
   * Screenshots of the element, tile by tile. hide(on) hides Mochi (and its UI) so it isn't in the picture.
   * Returns { size: { w, h } (CSS px), partial, tiles }.
   */
  async function capture(target, { job, hide = () => {}, onTile = () => {}, isCancelled = () => false }) {
    const el = target.el;
    const startX = scrollX, startY = scrollY;
    // Bring it into view (nested scroll boxes too), then measure.
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    await frames(2);
    let r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight) { el.scrollIntoView({ block: r.height > innerHeight ? 'start' : 'center', inline: 'nearest' }); await frames(2); r = el.getBoundingClientRect(); }
    const size = { w: Math.round(r.width), h: Math.round(r.height) };
    const vw = document.documentElement.clientWidth || innerWidth, vh = innerHeight;
    const rows = Math.ceil(r.height / vh), cols = Math.ceil(r.width / vw);
    // Taller than the window: tiles, by scrolling the window (only when the page itself scrolls it).
    const winScrolls = document.scrollingElement && document.scrollingElement.scrollHeight > vh + 1;
    const tiled = (rows > 1 || cols > 1) && rows * cols <= MAX_TILES && winScrolls;
    const partial = (rows > 1 || cols > 1) && !tiled;
    const plan = [];
    if (tiled) {
      const docTop = r.top + scrollY, docLeft = r.left + scrollX;
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) plan.push({ y: docTop + i * vh, x: docLeft + j * vw });
    } else plan.push(null);
    let tiles = 0;
    try {
      for (const spot of plan) {
        if (isCancelled()) throw Object.assign(new Error('cancelled'), { cancelled: true });
        if (spot) { scrollTo({ left: spot.x, top: spot.y, behavior: 'instant' }); await frames(2); await sleep(80); }
        hide(true);
        await frames(2);
        await sleep(40);
        const now = el.getBoundingClientRect();
        const left = Math.max(0, now.left), top = Math.max(0, now.top);
        const right = Math.min(vw, now.right), bottom = Math.min(vh, now.bottom);
        if (right - left >= 1 && bottom - top >= 1) {
          await send({ op: 'shot', job, crop: { x: left, y: top, w: right - left, h: bottom - top }, dest: { x: left - now.left, y: top - now.top }, viewport: { w: innerWidth, h: innerHeight } }); // the screenshot covers the whole window (scrollbar too)
          tiles++;
          onTile(tiles, plan.length);
        }
        hide(false);
      }
    } finally {
      hide(false);
      if (tiled) scrollTo({ left: startX, top: startY, behavior: 'instant' });
    }
    if (!tiles) throw new Error('not-visible');
    // Partial: only the visible part was captured: the size is that part's.
    if (partial) {
      const now = el.getBoundingClientRect();
      return { size: { w: Math.round(Math.min(vw, now.right) - Math.max(0, now.left)), h: Math.round(Math.min(vh, now.bottom) - Math.max(0, now.top)) }, full: size, partial, tiles };
    }
    return { size, full: size, partial, tiles };
  }

  /**
   * The pixels read in the page itself, when the screenshot isn't allowed (no activeTab: Mochi
   * came on claude.ai by itself). Works for same-origin / blob: images and clean canvases;
   * a cross-origin image taints the canvas and gives null.
   */
  async function direct(target) {
    const el = target.el;
    try {
      let src = null, w = 0, h = 0;
      if (target.kind === 'canvas') return el.toDataURL('image/png');
      if (target.kind === 'img') { if (!el.complete) await el.decode().catch(() => {}); src = el; w = el.naturalWidth; h = el.naturalHeight; }
      else if (target.kind === 'svg') {
        const xml = new XMLSerializer().serializeToString(el);
        const img = new Image();
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
        await img.decode();
        const r = el.getBoundingClientRect();
        src = img; w = Math.round(r.width * devicePixelRatio); h = Math.round(r.height * devicePixelRatio);
      }
      if (!src || !w || !h) return null;
      const f = Math.min(1, 2400 / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.round(w * f); c.height = Math.round(h * f);
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      return c.toDataURL('image/png'); // throws on a tainted canvas
    } catch (_) { return null; }
  }

  Mochi.imageTarget = { resolve, fromSrc, capture, direct, send, MAX_TILES };
})();
