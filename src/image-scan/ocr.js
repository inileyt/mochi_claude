/*
 * Mochi — Image Scan: the text in the image (OCR), with Tesseract (bundled in
 * src/vendor/tesseract/: English + Russian "fast" models). Runs in the offscreen worker
 * page; Tesseract itself runs in its own Web Worker. Nothing is downloaded.
 *
 *   await Mochi.imageOcr.read(canvas, { onProgress, isCancelled }) → {
 *     found, text, confidence, language: 'en'|'ru'|'hy'|'en+ru'|'en+hy'|…|null,
 *     lines: [{ text, conf, bbox: { x0, y0, x1, y1 }, words: [{ text, conf, bbox }] }],
 *     blocks: [{ text, conf, bbox, lines: [index…] }],          (bbox: pixels of the analysed image)
 *   }
 *   await Mochi.imageOcr.cancel()   stops the worker (a new one starts next time)
 *
 * Only reliable words are kept (confidence ≥ 55, letters or digits in them); when nothing
 * reliable is left, found is false and the card says "No text found".
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const url = p => chrome.runtime.getURL(p);
  const WORD_CONF = 55;
  const LINE_CONF = 60;
  const TIMEOUT_MS = 40000;
  let worker = null;
  let starting = null;
  let onProgress = null;

  async function getWorker() {
    if (worker) return worker;
    if (!starting) {
      const boot = Tesseract.createWorker(['eng', 'rus', 'hye'], 1 /* LSTM only */, {
        workerPath: url('src/vendor/tesseract/worker.min.js'),
        corePath: url('src/vendor/tesseract/tesseract-core-simd-lstm.js'),
        langPath: url('src/vendor/tesseract/lang'),
        workerBlobURL: false,
        cacheMethod: 'none', // the models are part of the extension: nothing to cache
        logger: m => { if (m.status === 'recognizing text' && onProgress) onProgress(m.progress || 0); },
        errorHandler: () => {},
      });
      starting = Promise.race([boot, new Promise((_, no) => setTimeout(() => no(new Error('ocr-start-timeout')), 20000))])
        .then(w => { worker = w; return w; }).finally(() => { starting = null; });
    }
    return starting;
  }

  async function cancel() {
    const w = worker;
    worker = null;
    if (w) await w.terminate().catch(() => {});
  }

  const alnum = s => (s.match(/[\p{L}\p{N}]/gu) || []).length;
  const box = b => ({ x0: Math.round(b.x0), y0: Math.round(b.y0), x1: Math.round(b.x1), y1: Math.round(b.y1) });
  const scaleBox = (b, f) => ({ x0: Math.round(b.x0 / f), y0: Math.round(b.y0 / f), x1: Math.round(b.x1 / f), y1: Math.round(b.y1 / f) });

  /** Small images read better bigger: Tesseract likes letters 20 px or more. */
  function prepare(canvas) {
    const f = Math.max(1, Math.min(3, 900 / Math.max(canvas.width, canvas.height)), canvas.height < 220 ? 2 : 1);
    if (f === 1) return { image: canvas, f: 1 };
    const c = new OffscreenCanvas(Math.round(canvas.width * f), Math.round(canvas.height * f));
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(canvas, 0, 0, c.width, c.height);
    return { image: c, f };
  }

  /** Tesseract's blocks → the lines and blocks Mochi keeps (reliable words only). */
  function collect(data, f) {
    const lines = [], blocks = [];
    for (const block of data.blocks || []) {
      const mine = [];
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          const words = (line.words || [])
            .filter(w => w.confidence >= WORD_CONF && alnum(w.text) >= 1 && alnum(w.text) / w.text.length >= 0.5)
            .map(w => ({ text: w.text, conf: Math.round(w.confidence), bbox: scaleBox(box(w.bbox), f) }));
          if (!words.length) continue;
          const conf = words.reduce((t, w) => t + w.conf, 0) / words.length;
          const chars = words.reduce((t, w) => t + alnum(w.text), 0);
          if (conf < LINE_CONF || chars < 2) continue;
          const b = words.reduce((u, w) => ({ x0: Math.min(u.x0, w.bbox.x0), y0: Math.min(u.y0, w.bbox.y0), x1: Math.max(u.x1, w.bbox.x1), y1: Math.max(u.y1, w.bbox.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
          mine.push(lines.length);
          lines.push({ text: words.map(w => w.text).join(' '), conf: Math.round(conf), bbox: b, words });
        }
      }
      if (mine.length) {
        const ls = mine.map(i => lines[i]);
        blocks.push({
          text: ls.map(l => l.text).join('\n'),
          conf: Math.round(ls.reduce((t, l) => t + l.conf, 0) / ls.length),
          bbox: ls.reduce((u, l) => ({ x0: Math.min(u.x0, l.bbox.x0), y0: Math.min(u.y0, l.bbox.y0), x1: Math.max(u.x1, l.bbox.x1), y1: Math.max(u.y1, l.bbox.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }),
          lines: mine,
        });
      }
    }
    return { lines, blocks };
  }

  function language(text) {
    // The scripts Mochi can read, biggest first; a clear runner-up (≥ 1/4 of the top) is named too.
    const counts = [
      ['en', (text.match(/\p{Script=Latin}/gu) || []).length],
      ['ru', (text.match(/\p{Script=Cyrillic}/gu) || []).length],
      ['hy', (text.match(/\p{Script=Armenian}/gu) || []).length],
    ].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    if (!counts.length) return null;
    if (counts.length === 1 || counts[1][1] < counts[0][1] / 4) return counts[0][0];
    return `${counts[0][0]}+${counts[1][0]}`;
  }

  async function read(canvas, { onProgress: progress = null, isCancelled = () => false } = {}) {
    const w = await getWorker();
    if (isCancelled()) throw Object.assign(new Error('cancelled'), { cancelled: true });
    const { image, f } = prepare(canvas);
    onProgress = progress;
    let out;
    try {
      const run = async psm => {
        await w.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1' });
        // Never wait forever (a broken worker would): 40 s, then the card goes on without text.
        const r = await Promise.race([w.recognize(image, {}, { text: true, blocks: true }), new Promise((_, no) => setTimeout(() => no(new Error('ocr-timeout')), TIMEOUT_MS))]);
        return collect(r.data, f);
      };
      out = await run('3'); // automatic layout
      // Posters and graphics: words scattered around. Try "sparse text" once when the layout pass found nothing.
      if (!out.lines.length && !isCancelled()) out = await run('11');
    } finally { onProgress = null; }
    const text = out.lines.map(l => l.text).join('\n');
    const confidence = out.lines.length ? Math.round(out.lines.reduce((t, l) => t + l.conf * l.words.length, 0) / out.lines.reduce((t, l) => t + l.words.length, 0)) : 0;
    return { found: out.lines.length > 0, text, confidence, language: language(text), lines: out.lines, blocks: out.blocks };
  }

  Mochi.imageOcr = { read, cancel, language };
})();
