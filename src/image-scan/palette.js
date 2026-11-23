/*
 * Mochi — Image Scan: the color palette of an image.
 *
 *   Mochi.palette.extract(imageData) → {
 *     colors: [{ hex, rgb, hsl, lab, share (%), name, role }],   up to 8 (fewer when the image has fewer)
 *     overall: { tone: 'light'|'dark', temperature: 'warm'|'cool'|'neutral', saturation: 'low'|'medium'|'high', lightness, chroma },
 *     gradient: null | { direction: 'to right'…, angle (deg, CSS), from, to, css },
 *   }
 * k-means in Lab (k-means++ start, a fixed seed: the same image always gives the same palette),
 * on a downscaled copy (≤ ~16 000 pixels). Near-identical clusters merge (ΔE < 7). A cluster made
 * mostly of one exact color (flat art, posters) reports that exact color, not the average.
 * Roles: background (owns the border), dominant, accent (the most colorful of the rest), text
 * (high contrast with the background, small); the font step may confirm the text color later.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const C = Mochi.imageColor || (typeof require === 'function' ? require('./colors.js') : null);
  const MAX_SAMPLES = 16000;
  const K = 8;
  const MERGE_DE = 7;
  const MIN_SHARE = 0.008;

  // A tiny deterministic random generator (mulberry32).
  const rng = seed => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;

  /** Every step-th pixel (opaque ones), with whether it lies on the image's border. */
  function sample(img) {
    const { width: w, height: h, data } = img;
    const step = Math.max(1, Math.round(Math.sqrt((w * h) / MAX_SAMPLES)));
    const edge = Math.max(1, Math.round(Math.min(w, h) * 0.04));
    const out = [];
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        if (data[i + 3] < 128) continue;
        const rgb = [data[i], data[i + 1], data[i + 2]];
        out.push({ rgb, key: (rgb[0] << 16) | (rgb[1] << 8) | rgb[2], lab: C.rgbToLab(rgb), border: x < edge || y < edge || x >= w - edge || y >= h - edge });
      }
    }
    return out;
  }

  function kmeans(points, k, rand) {
    // Distinct colors first: a flat image may have fewer colors than k.
    const distinct = new Map();
    for (const p of points) if (!distinct.has(p.key)) distinct.set(p.key, p.lab);
    k = Math.min(k, distinct.size);
    // k-means++ start.
    const centers = [points[Math.floor(rand() * points.length)].lab.slice()];
    const dist = new Float64Array(points.length).fill(Infinity);
    while (centers.length < k) {
      let sum = 0;
      const last = centers[centers.length - 1];
      for (let i = 0; i < points.length; i++) { dist[i] = Math.min(dist[i], d2(points[i].lab, last)); sum += dist[i]; }
      if (!sum) break;
      let r = rand() * sum, i = 0;
      for (; i < points.length - 1 && r > dist[i]; i++) r -= dist[i];
      centers.push(points[i].lab.slice());
    }
    const assign = new Int32Array(points.length);
    for (let iter = 0; iter < 24; iter++) {
      let moved = 0;
      for (let i = 0; i < points.length; i++) {
        let best = 0, bd = Infinity;
        for (let c = 0; c < centers.length; c++) { const d = d2(points[i].lab, centers[c]); if (d < bd) { bd = d; best = c; } }
        if (assign[i] !== best) { assign[i] = best; moved++; }
      }
      const sums = centers.map(() => [0, 0, 0, 0]);
      for (let i = 0; i < points.length; i++) { const s = sums[assign[i]], l = points[i].lab; s[0] += l[0]; s[1] += l[1]; s[2] += l[2]; s[3]++; }
      sums.forEach((s, c) => { if (s[3]) centers[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
      if (!moved && iter) break;
    }
    return centers.map((center, c) => ({ center, members: points.filter((_, i) => assign[i] === c) })).filter(g => g.members.length);
  }

  /** One cluster → its color: the exact color when one dominates it (flat art), else the Lab average. */
  function represent(members) {
    const counts = new Map();
    for (const m of members) counts.set(m.key, (counts.get(m.key) || 0) + 1);
    let topKey = 0, top = 0;
    for (const [key, n] of counts) if (n > top) { top = n; topKey = key; }
    if (top / members.length >= 0.3) {
      const rgb = [(topKey >> 16) & 255, (topKey >> 8) & 255, topKey & 255];
      return { rgb, lab: C.rgbToLab(rgb), exact: true };
    }
    const s = [0, 0, 0];
    for (const m of members) { s[0] += m.lab[0]; s[1] += m.lab[1]; s[2] += m.lab[2]; }
    const lab = s.map(v => v / members.length);
    return { rgb: C.labToRgb(lab), lab, exact: false };
  }

  function merge(groups) {
    const out = groups.slice().sort((a, b) => b.members.length - a.members.length);
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        if (C.deltaE(out[i].center, out[j].center) < MERGE_DE) {
          out[i] = { center: out[i].center, members: out[i].members.concat(out[j].members) };
          out.splice(j, 1);
          j--;
        }
      }
    }
    return out;
  }

  function roles(colors, total, borderTotal) {
    const byShare = colors.slice().sort((a, b) => b.share - a.share);
    // Background: the color that owns most of the border, if it owns a good part of it.
    const bg = colors.slice().sort((a, b) => b.borderShare - a.borderShare)[0];
    if (bg && borderTotal && bg.borderShare >= 0.45 && bg.share >= 0.15) bg.role = 'background';
    const rest = byShare.filter(c => !c.role);
    if (rest[0] && rest[0].share >= 0.08) rest[0].role = 'dominant';
    else if (!colors.some(c => c.role === 'background') && byShare[0]) byShare[0].role = 'dominant';
    const bgColor = colors.find(c => c.role === 'background') || byShare[0];
    // Text: small, and the strongest contrast with the background.
    const textish = colors.filter(c => !c.role && c.share <= 0.25 && bgColor && C.contrast(c.rgb, bgColor.rgb) >= 3)
      .sort((a, b) => C.contrast(b.rgb, bgColor.rgb) - C.contrast(a.rgb, bgColor.rgb))[0];
    // Accent: the most colorful of what's left (and colorful enough to stand out).
    const accent = colors.filter(c => !c.role && c !== textish && c.share >= 0.01 && C.lch(c.lab)[1] >= 25).sort((a, b) => C.lch(b.lab)[1] - C.lch(a.lab)[1])[0];
    if (accent) accent.role = 'accent';
    if (textish && !textish.role) textish.role = 'text';
    for (const c of colors) if (!c.role) c.role = 'secondary';
  }

  function overall(colors) {
    let L = 0, chroma = 0, warm = 0, cool = 0;
    for (const c of colors) {
      const [l, ch, hue] = C.lch(c.lab);
      L += l * c.share; chroma += ch * c.share;
      // Warm: reds, oranges, yellows (and magenta-reds); cool: greens, cyans, blues, violets.
      const w = ch * c.share;
      if (hue < 100 || hue >= 330) warm += w; else cool += w;
    }
    const temp = warm + cool < 6 ? 'neutral' : warm > cool * 1.25 ? 'warm' : cool > warm * 1.25 ? 'cool' : 'neutral';
    return {
      tone: L >= 55 ? 'light' : 'dark',
      temperature: temp,
      saturation: chroma < 15 ? 'low' : chroma < 40 ? 'medium' : 'high',
      lightness: Math.round(L), chroma: Math.round(chroma),
    };
  }

  /**
   * Mostly a gradient? A 16×16 grid of average colors; a smooth linear ramp (each channel fits
   * a plane in x/y well) with a clear change between its ends. → direction + CSS.
   */
  function gradient(img) {
    const N = 16, { width: w, height: h, data } = img;
    if (w < 8 || h < 8) return null;
    const cells = [];
    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        const x0 = Math.floor((gx * w) / N), x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * w) / N));
        const y0 = Math.floor((gy * h) / N), y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * h) / N));
        const sx = Math.max(1, Math.floor((x1 - x0) / 6)), sy = Math.max(1, Math.floor((y1 - y0) / 6));
        const s = [0, 0, 0]; let n = 0;
        for (let y = y0; y < y1; y += sy) for (let x = x0; x < x1; x += sx) { const i = (y * w + x) * 4; const lab = C.rgbToLab([data[i], data[i + 1], data[i + 2]]); s[0] += lab[0]; s[1] += lab[1]; s[2] += lab[2]; n++; }
        cells.push({ x: (gx + 0.5) / N - 0.5, y: (gy + 0.5) / N - 0.5, lab: s.map(v => v / n) });
      }
    }
    // Least squares per channel: v = c + bx·x + by·y (x, y centered: the fit separates).
    const sxx = cells.reduce((t, p) => t + p.x * p.x, 0), syy = cells.reduce((t, p) => t + p.y * p.y, 0);
    let ssRes = 0, ssTot = 0;
    const fit = [0, 1, 2].map(ch => {
      const mean = cells.reduce((t, p) => t + p.lab[ch], 0) / cells.length;
      const bx = cells.reduce((t, p) => t + p.x * p.lab[ch], 0) / sxx, by = cells.reduce((t, p) => t + p.y * p.lab[ch], 0) / syy;
      for (const p of cells) { ssRes += (p.lab[ch] - (mean + bx * p.x + by * p.y)) ** 2; ssTot += (p.lab[ch] - mean) ** 2; }
      return { mean, bx, by };
    });
    if (!ssTot) return null;
    const r2 = 1 - ssRes / ssTot;
    // The direction of the strongest change: the dominant eigenvector of Σ (bx, by)ᵀ(bx, by).
    let xx = 0, xy = 0, yy = 0;
    for (const f of fit) { xx += f.bx * f.bx; xy += f.bx * f.by; yy += f.by * f.by; }
    const theta = 0.5 * Math.atan2(2 * xy, xx - yy);
    let dx = Math.cos(theta), dy = Math.sin(theta);
    // Natural reading order: along its main axis, a gradient goes left → right or top → bottom.
    if (Math.abs(dx) >= Math.abs(dy) ? dx < 0 : dy < 0) { dx = -dx; dy = -dy; }
    const at = t => fit.map(f => f.mean + (f.bx * dx + f.by * dy) * t);
    const from = at(-0.5), to = at(0.5);
    const span = C.deltaE(from, to);
    if (r2 < 0.9 || span < 15) return null;
    // CSS angle: 0deg points up, 90deg right, 180deg down.
    let angle = Math.round((Math.atan2(dx, -dy) * 180) / Math.PI);
    if (angle < 0) angle += 360;
    const snap = [[0, 'to top'], [45, 'to top right'], [90, 'to right'], [135, 'to bottom right'], [180, 'to bottom'], [225, 'to bottom left'], [270, 'to left'], [315, 'to top left'], [360, 'to top']];
    const near = snap.reduce((b, s) => (Math.abs(s[0] - angle) < Math.abs(b[0] - angle) ? s : b));
    const fromHex = C.hex(C.labToRgb(from)), toHex = C.hex(C.labToRgb(to));
    return { direction: near[1], angle, from: fromHex, to: toHex, fit: Math.round(r2 * 100) / 100, css: `linear-gradient(${angle}deg, ${fromHex}, ${toHex})` };
  }

  function extract(img) {
    const points = sample(img);
    if (!points.length) return { colors: [], overall: null, gradient: null };
    const groups = merge(kmeans(points, K, rng(0x6d0c41)));
    const total = points.length;
    const borderTotal = points.filter(p => p.border).length;
    let colors = groups.map(g => {
      const rep = represent(g.members);
      return {
        rgb: rep.rgb, lab: rep.lab.map(v => Math.round(v * 10) / 10), exact: rep.exact,
        share: g.members.length / total,
        borderShare: borderTotal ? g.members.filter(m => m.border).length / borderTotal : 0,
      };
    }).filter(c => c.share >= MIN_SHARE).sort((a, b) => b.share - a.share).slice(0, K);
    // Shares of what's kept add up to 100.
    const kept = colors.reduce((t, c) => t + c.share, 0) || 1;
    for (const c of colors) c.share /= kept;
    roles(colors, total, borderTotal);
    colors = colors.map(c => ({
      hex: C.hex(c.rgb), rgb: c.rgb, hsl: C.hsl(c.rgb), lab: c.lab,
      share: Math.round(c.share * 1000) / 10, name: C.name(c.rgb), role: c.role, exact: c.exact,
    }));
    return { colors, overall: overall(colors.map(c => ({ ...c, share: c.share / 100 }))), gradient: gradient(img) };
  }

  /** The palette as CSS custom properties / a Tailwind colors object (for the copy buttons). */
  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  function names(colors) {
    const seen = {};
    return colors.map(c => { const base = slug(c.role === 'secondary' ? c.name : `${c.role}`); seen[base] = (seen[base] || 0) + 1; return seen[base] > 1 ? `${base}-${seen[base]}` : base; });
  }
  const asCss = colors => `:root {\n${names(colors).map((n, i) => `  --color-${n}: ${colors[i].hex}; /* ${colors[i].name}, ${colors[i].share}% */`).join('\n')}\n}`;
  const asTailwind = colors => `// tailwind.config.js → theme.extend.colors\ncolors: {\n${names(colors).map((n, i) => `  '${n}': '${colors[i].hex}', // ${colors[i].name}`).join('\n')}\n},`;

  Mochi.palette = { extract, gradient, asCss, asTailwind };
  if (typeof module !== 'undefined') module.exports = Mochi.palette;
})();
