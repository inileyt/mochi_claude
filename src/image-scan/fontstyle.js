/*
 * Mochi — Image Scan: the font style of the text in an image (approximate: exact font
 * identification isn't possible offline, and the card says so).
 *
 *   await Mochi.fontStyle.analyze(imageData, ocr) → [{
 *     text, sample, category, weight: { value, label }, width, case, letterSpacing: { em, label },
 *     color: { hex, name }, size: { capPct, px }, matches: [{ family, category, score, weight }] (top 3)
 *   }]  one entry per text block (the 3 biggest)
 *
 * How: for each block, its clearest word is cut out of the image and split into ink and
 * background (2-means in Lab: the background seeds from the box's border). The same word is
 * drawn with each bundled font (src/image-scan/fonts.js) at a few weights, with the letter
 * spacing fitted to the word's width, and the two glyph masks are compared at 32 px high
 * (soft IoU: Σ min / Σ max). The weight comes from the stroke thickness compared with renders
 * of the best font at each weight; width and spacing from the fit.
 * Runs in the offscreen worker page (it needs FontFace and a canvas).
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const C = Mochi.imageColor;
  const H = 32; // compare masks at this height
  const RENDER = 72; // font size of the renders
  const RANGES = {
    latin: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    cyrillic: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116',
  };
  const LABELS = [[150, 'thin'], [250, 'extra-light'], [350, 'light'], [450, 'regular'], [550, 'medium'], [650, 'semibold'], [750, 'bold'], [850, 'extra-bold'], [1000, 'black']];
  const weightLabel = w => LABELS.find(([max]) => w < max)[1];

  // ——— fonts: loaded once, from the extension ———
  let loaded = null;
  function loadFonts() {
    if (loaded) return loaded;
    const { FONTS, files } = Mochi.imageFonts;
    loaded = Promise.all(FONTS.flatMap(font => files(font).map(f => {
      const face = new FontFace(font.family, `url(${chrome.runtime.getURL(f.path)})`, { weight: f.weight, unicodeRange: RANGES[f.subset] });
      document.fonts.add(face);
      return face.load().catch(() => null);
    })));
    return loaded;
  }

  // ——— masks ———
  /** A float mask (0 = background, 1 = ink) of a box of the image, + the ink color. */
  function inkMask(img, box) {
    const pad = 2;
    const x0 = Math.max(0, Math.floor(box.x0) - pad), y0 = Math.max(0, Math.floor(box.y0) - pad);
    const x1 = Math.min(img.width, Math.ceil(box.x1) + pad), y1 = Math.min(img.height, Math.ceil(box.y1) + pad);
    const w = x1 - x0, h = y1 - y0;
    if (w < 4 || h < 4) return null;
    const labs = new Array(w * h), rgbs = new Array(w * h);
    const border = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = ((y0 + y) * img.width + (x0 + x)) * 4;
        const rgb = [img.data[i], img.data[i + 1], img.data[i + 2]];
        const lab = C.rgbToLab(rgb);
        labs[y * w + x] = lab; rgbs[y * w + x] = rgb;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border.push(lab);
      }
    }
    const med = k => border.map(l => l[k]).sort((a, b) => a - b)[Math.floor(border.length / 2)];
    let bg = [med(0), med(1), med(2)];
    const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    let ink = labs.reduce((best, l) => (dist(l, bg) > dist(best, bg) ? l : best), labs[0]);
    if (dist(ink, bg) < 12) return null; // no contrast: no text here
    for (let it = 0; it < 6; it++) {
      const sb = [0, 0, 0, 0], si = [0, 0, 0, 0];
      for (const l of labs) { const s = dist(l, ink) < dist(l, bg) ? si : sb; s[0] += l[0]; s[1] += l[1]; s[2] += l[2]; s[3]++; }
      if (sb[3]) bg = [sb[0] / sb[3], sb[1] / sb[3], sb[2] / sb[3]];
      if (si[3]) ink = [si[0] / si[3], si[1] / si[3], si[2] / si[3]];
    }
    // Soft mask: how far each pixel goes from the background toward the ink.
    const v = [ink[0] - bg[0], ink[1] - bg[1], ink[2] - bg[2]];
    const vv = v[0] ** 2 + v[1] ** 2 + v[2] ** 2;
    const mask = new Float32Array(w * h);
    const core = [];
    labs.forEach((l, i) => {
      const t = Math.max(0, Math.min(1, ((l[0] - bg[0]) * v[0] + (l[1] - bg[1]) * v[1] + (l[2] - bg[2]) * v[2]) / vv));
      mask[i] = t;
      if (t > 0.85) core.push(rgbs[i]);
    });
    const avg = core.length ? [0, 1, 2].map(k => Math.round(core.reduce((s, c) => s + c[k], 0) / core.length)) : C.labToRgb(ink);
    return { mask, w, h, color: avg, bg: C.labToRgb(bg) };
  }

  /** The tight box of the ink (mask > 0.5) → a cropped mask. */
  function tight({ mask, w, h }) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x] > 0.5) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1, out = new Float32Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) out[y * cw + x] = mask[(y0 + y) * w + x0 + x];
    return { mask: out, w: cw, h: ch };
  }

  /** Area-average resample to W × hh. */
  function resample({ mask, w, h }, W, hh = H) {
    const out = new Float32Array(W * hh);
    for (let y = 0; y < hh; y++) {
      const sy0 = (y * h) / hh, sy1 = ((y + 1) * h) / hh;
      for (let x = 0; x < W; x++) {
        const sx0 = (x * w) / W, sx1 = ((x + 1) * w) / W;
        let sum = 0, n = 0;
        for (let sy = Math.floor(sy0); sy < Math.min(h, Math.ceil(sy1)); sy++) {
          for (let sx = Math.floor(sx0); sx < Math.min(w, Math.ceil(sx1)); sx++) {
            const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0), wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
            sum += mask[sy * w + sx] * wx * wy; n += wx * wy;
          }
        }
        out[y * W + x] = n ? sum / n : 0;
      }
    }
    return out;
  }
  const softIoU = (a, b) => { let mn = 0, mx = 0; for (let i = 0; i < a.length; i++) { mn += Math.min(a[i], b[i]); mx += Math.max(a[i], b[i]); } return mx ? mn / mx : 0; };

  /** Stroke thickness relative to the ink height: 2 × area / perimeter, over height. */
  function strokeRatio({ mask, w, h }) {
    let area = 0, perim = 0;
    const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] > 0.5;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue;
      area++;
      if (!on(x - 1, y)) perim++; if (!on(x + 1, y)) perim++; if (!on(x, y - 1)) perim++; if (!on(x, y + 1)) perim++;
    }
    return perim ? (2 * area) / perim / h : 0;
  }

  // ——— renders ———
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  function render(text, family, weight, spacing = 0) {
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const font = `${weight} ${RENDER}px "${family}"`;
    g.font = font;
    g.letterSpacing = `${spacing}px`;
    const wide = Math.ceil(g.measureText(text).width + Math.abs(spacing) * text.length + RENDER);
    canvas.width = Math.min(4000, wide);
    canvas.height = Math.round(RENDER * 1.8);
    g.font = font; // resizing resets the context
    g.letterSpacing = `${spacing}px`;
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#000';
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillText(text, RENDER * 0.4, RENDER * 1.25);
    const { data } = g.getImageData(0, 0, canvas.width, canvas.height);
    const mask = new Float32Array(canvas.width * canvas.height);
    for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] / 255;
    return tight({ mask, w: canvas.width, h: canvas.height });
  }

  /** Render with the letter spacing that gives the target's aspect ratio. */
  function fitted(text, family, weight, aspect) {
    const plain = render(text, family, weight, 0);
    if (!plain) return null;
    const gaps = Math.max(1, [...text].length - 1);
    const want = aspect * plain.h;
    const spacing = Math.max(-0.08 * RENDER, Math.min(0.6 * RENDER, (want - plain.w) / gaps));
    const shape = Math.abs(spacing) < 0.5 ? plain : render(text, family, weight, spacing);
    return shape ? { shape, spacing, plain } : null;
  }

  function caseOf(text) {
    const letters = text.replace(/[^\p{L}]/gu, '');
    if (!letters) return 'mixed';
    if (letters === letters.toUpperCase() && letters !== letters.toLowerCase()) return 'all caps';
    if (letters === letters.toLowerCase()) return 'lowercase';
    const words = text.split(/\s+/).filter(w => /\p{L}/u.test(w));
    return words.length > 1 && words.every(w => /^\P{L}*\p{Lu}/u.test(w)) ? 'title case' : 'mixed';
  }

  /** The clearest word of a block: long, confident, letters. */
  function pickWord(ocr, block) {
    const words = block.lines.flatMap(i => ocr.lines[i].words).filter(w => (w.text.match(/\p{L}/gu) || []).length >= 2);
    words.sort((a, b) => (b.conf >= 75) - (a.conf >= 75) || (b.bbox.y1 - b.bbox.y0) - (a.bbox.y1 - a.bbox.y0) || b.text.length - a.text.length);
    return words[0] || null;
  }

  async function analyzeBlock(img, ocr, block, { scale = 1 } = {}) {
    const word = pickWord(ocr, block);
    if (!word) return null;
    // The word exactly as read: its box holds its punctuation too (a dot, a comma).
    const text = word.text;
    const ink = inkMask(img, word.bbox);
    if (!ink) return null;
    const target = tight(ink);
    if (!target || target.h < 6) return null;
    const aspect = target.w / target.h;
    const W = Math.max(8, Math.min(320, Math.round(aspect * H)));
    const want = resample(target, W);
    const cyr = /\p{Script=Cyrillic}/u.test(text);
    const { FONTS } = Mochi.imageFonts;
    const scores = [];
    for (const font of FONTS) {
      if (cyr && !font.cyr) continue;
      const weights = font.variable ? [...new Set([300, 400, 600, 800].map(w => Math.max(font.wght[0], Math.min(font.wght[1], w))))] : font.wght;
      let best = null;
      for (const weight of weights) {
        const fit = fitted(text, font.family, weight, aspect);
        if (!fit) continue;
        const score = softIoU(want, resample(fit.shape, W));
        if (!best || score > best.score) best = { family: font.family, category: font.category, weight, score, spacing: fit.spacing, plain: fit.plain };
      }
      if (best) scores.push(best);
    }
    scores.sort((a, b) => b.score - a.score);
    const top = scores[0];
    if (!top) return null;
    // Weight: the stroke thickness against renders of the best font (or Inter, for one-weight fonts).
    const ratio = strokeRatio(target);
    const ref = FONTS.find(f => f.family === top.family);
    const refFont = ref && ref.variable && ref.wght[1] - ref.wght[0] >= 300 ? ref : FONTS.find(f => f.family === 'Inter');
    let weight = top.weight, wd = Infinity;
    for (let w = refFont.wght[0]; w <= refFont.wght[1]; w += 100) {
      const r = render(text, refFont.family, w, 0);
      if (!r) continue;
      const d = Math.abs(strokeRatio(r) - ratio);
      if (d < wd) { wd = d; weight = w; }
    }
    if (!refFont.variable || refFont.family !== top.family) weight = Math.round((weight + (ref?.variable ? top.weight : weight)) / 2 / 100) * 100;
    // Width: the word without its letter spacing, against Inter regular.
    const inter = render(text, 'Inter', 400, 0);
    const natural = top.plain.w / top.plain.h; // the matched font's own proportions at this text
    const widthRatio = inter ? natural / (inter.w / inter.h) : 1;
    const em = top.spacing / RENDER;
    const capPx = target.h;
    return {
      text: block.text.split('\n')[0].slice(0, 80),
      sample: text,
      category: top.category,
      weight: { value: weight, label: weightLabel(weight) },
      width: widthRatio < 0.84 ? 'condensed' : widthRatio > 1.2 ? 'wide' : 'normal',
      case: caseOf(block.text),
      letterSpacing: { em: Math.round(em * 1000) / 1000, label: em < -0.015 ? 'tight' : em > 0.07 ? 'wide' : 'normal' },
      color: { hex: C.hex(ink.color), name: C.name(ink.color) },
      size: { capPct: Math.round((capPx / img.height) * 1000) / 10, px: Math.round(capPx / 0.7 / (scale || 1)) },
      matches: scores.slice(0, 3).map(s => ({ family: s.family, category: s.category, score: Math.round(s.score * 100), weight: s.weight })),
    };
  }

  async function analyze(img, ocr, { scale = 1 } = {}) {
    if (!ocr?.blocks?.length) return [];
    await loadFonts();
    const blocks = ocr.blocks.slice().sort((a, b) => (b.bbox.y1 - b.bbox.y0) / b.lines.length - (a.bbox.y1 - a.bbox.y0) / a.lines.length).slice(0, 3);
    const out = [];
    for (const block of blocks) {
      try { const r = await analyzeBlock(img, ocr, block, { scale }); if (r) out.push(r); } catch (_) { /* one block failing never stops the rest */ }
    }
    return out;
  }

  Mochi.fontStyle = { analyze, inkMask, tight, resample, softIoU, strokeRatio, render, caseOf, weightLabel, loadFonts };
})();
