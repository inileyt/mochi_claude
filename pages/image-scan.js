/*
 * Mochi — Image Scan worker page (offscreen document). Receives the screenshot tiles from the
 * background, crops + stitches them into the image, then runs the analysis steps:
 *   palette (src/image-scan/palette.js) · text (Tesseract, in its own Web Worker) ·
 *   font style (src/image-scan/fontstyle.js) · and, on request, the on-device description.
 * Nothing here talks to the network: every file is part of the extension.
 *
 * Messages: { target: 'mochi-offscreen', op: 'analyze' | 'describe' | 'aiStatus' | 'cancel', … }
 * Progress: chrome.runtime.sendMessage({ type: 'mochi-image-progress', job, step, fraction })
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const IDLE_MS = 3 * 60 * 1000; // close (and free Tesseract's memory) after 3 quiet minutes
  const MAX_SIDE = 2400; // the analysed image, device pixels
  const CLIP_SIDE = 1600; // the copy for the clipboard / claude.ai
  const THUMB_SIDE = 240;
  const images = new Map(); // job → { canvas } (the last few, for "describe")
  const cancelled = new Set();
  let idleTimer = null;

  class Cancelled extends Error { constructor() { super('cancelled'); this.cancelled = true; } }
  const progress = (job, step, fraction = 0) => chrome.runtime.sendMessage({ type: 'mochi-image-progress', job, step, fraction }).catch(() => {});
  const check = job => { if (cancelled.has(job)) throw new Cancelled(); };
  const idle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => chrome.runtime.sendMessage({ type: 'mochi-image-idle' }).catch(() => {}), IDLE_MS); };

  async function bitmap(dataUrl) {
    const blob = await (await fetch(dataUrl)).blob();
    return createImageBitmap(blob);
  }

  /**
   * Tiles → one canvas. Each tile: { dataUrl, crop: { x, y, w, h } (CSS px in the viewport) | null,
   * dest: { x, y } (CSS px in the image), viewport: { w, h } }. size: { w, h } of the image in CSS px.
   */
  async function stitch(tiles, size) {
    const bitmaps = [];
    for (const t of tiles) bitmaps.push(await bitmap(t.dataUrl));
    // Screenshot pixels per CSS pixel (devicePixelRatio × zoom), from the first tile.
    const first = tiles[0];
    const scale = first.crop && first.viewport?.w ? bitmaps[0].width / first.viewport.w : 1;
    let w = first.crop ? Math.round(size.w * scale) : bitmaps[0].width;
    let h = first.crop ? Math.round(size.h * scale) : bitmaps[0].height;
    const fit = Math.min(1, MAX_SIDE / Math.max(w, h));
    w = Math.max(1, Math.round(w * fit));
    h = Math.max(1, Math.round(h * fit));
    const canvas = new OffscreenCanvas(w, h);
    const g = canvas.getContext('2d', { willReadFrequently: true });
    tiles.forEach((t, i) => {
      const b = bitmaps[i];
      if (!t.crop) { g.drawImage(b, 0, 0, w, h); return; }
      const s = scale;
      g.drawImage(b, t.crop.x * s, t.crop.y * s, t.crop.w * s, t.crop.h * s, t.dest.x * s * fit, t.dest.y * s * fit, t.crop.w * s * fit, t.crop.h * s * fit);
    });
    bitmaps.forEach(b => b.close());
    return { canvas, scale: scale * fit };
  }

  /**
   * A resized copy as a data URL. A real <canvas> and the synchronous toDataURL: in this hidden
   * page, convertToBlob + FileReader callbacks are throttled to about a second each.
   */
  function scaled(canvas, side, type = 'image/png', quality) {
    const f = Math.min(1, side / Math.max(canvas.width, canvas.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(canvas.width * f));
    c.height = Math.max(1, Math.round(canvas.height * f));
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(canvas, 0, 0, c.width, c.height);
    return c.toDataURL(type, quality);
  }

  async function analyze({ job, tiles, size, options = {} }) {
    cancelled.delete(job);
    const started = performance.now();
    progress(job, 'crop', 0);
    if (!tiles?.length) throw new Error('no-pixels');
    const t0 = performance.now();
    const { canvas, scale } = await stitch(tiles, size);
    const tStitch = performance.now() - t0;
    check(job);
    images.set(job, { canvas });
    while (images.size > 4) images.delete(images.keys().next().value);
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const pixels = g.getImageData(0, 0, canvas.width, canvas.height);
    const result = {
      width: canvas.width, height: canvas.height, scale,
      css: size, // the image's size on the page (CSS px)
      partial: !!options.partial,
      image: scaled(canvas, CLIP_SIDE),
      thumb: scaled(canvas, THUMB_SIDE, 'image/jpeg', 0.82),
      ms: { stitch: Math.round(tStitch) },
    };
    result.ms.crop = Math.round(performance.now() - t0);
    const step = async (id, fn) => {
      const t0 = performance.now();
      progress(job, id, 0);
      try { await fn(); } catch (err) { if (err?.cancelled) throw err; result.errors = { ...(result.errors || {}), [id]: String(err?.message || err).slice(0, 200) }; }
      result.ms[id] = Math.round(performance.now() - t0);
      check(job);
    };
    if (Mochi.palette) await step('palette', async () => { result.palette = Mochi.palette.extract(pixels); });
    if (Mochi.imageOcr) await step('text', async () => { result.ocr = await Mochi.imageOcr.read(canvas, { job, onProgress: f => progress(job, 'text', f), isCancelled: () => cancelled.has(job) }); });
    if (Mochi.fontStyle && result.ocr?.blocks?.length) await step('font', async () => { result.fonts = await Mochi.fontStyle.analyze(pixels, result.ocr, { palette: result.palette }); });
    result.ms.total = Math.round(performance.now() - started);
    progress(job, 'done', 1);
    return result;
  }

  const ops = {
    analyze,
    describe: async ({ job, options }) => {
      const img = images.get(job);
      if (!img) throw new Error('no-image');
      if (!Mochi.imageAi) return { available: 'unavailable' };
      return Mochi.imageAi.describe(img.canvas, { ...options, job, onProgress: f => progress(job, 'describe', f) });
    },
    aiStatus: async () => (Mochi.imageAi ? Mochi.imageAi.status() : { available: 'unavailable' }),
    cancel: async ({ job }) => { cancelled.add(job); await Mochi.imageOcr?.cancel?.(); return true; },
  };

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg?.target !== 'mochi-offscreen' || sender.id !== chrome.runtime.id) return false;
    const run = ops[msg.op];
    if (!run) { reply({ ok: false, error: 'unknown-op' }); return false; }
    idle();
    Promise.resolve(run(msg)).then(result => reply({ ok: true, result }), err => reply({ ok: false, error: err?.cancelled ? 'cancelled' : String(err?.message || err) }));
    return true;
  });
  idle();
  Mochi.imageWorker = { stitch, analyze, images };
})();
