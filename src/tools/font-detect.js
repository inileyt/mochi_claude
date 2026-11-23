/*
 * Mochi — font inspector: which font of the stack a piece of text really uses, and its look.
 *
 *   Mochi.fontDetect.inspect(el) → {
 *     used, sure, how ('webfont' | 'local' | 'generic' | 'fallback'), stack: [names], usedIndex,
 *     size: { px, rem }, weight, style, lineHeight: { css, px, ratio }, letterSpacing: { css, em },
 *     color, background, bgImage, contrast: { ratio, aa, aaLarge, aaa }, cssStack, css, ai
 *   }
 * How: getComputedStyle gives the whole stack. Going down it, a family with @font-face rules is
 * used if one of its faces is loaded for this weight and style (document.fonts); a family without
 * any is a local font if a canvas measures text differently with it than with the generic
 * fallbacks; a generic family (serif, system-ui…) is whatever the system maps it to. Anything not
 * proven by a loaded web font is reported as "probably".
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', '-apple-system', 'blinkmacsystemfont']);
  const SAMPLE = 'mmmmmmmmmmlli1WQ@#Аж中';
  const installed = new Map();
  const norm = s => String(s).trim().replace(/^['"]|['"]$/g, '').toLowerCase();

  function parseStack(fontFamily) {
    const out = [];
    let cur = '', q = null;
    for (const ch of String(fontFamily)) {
      if (q) { if (ch === q) q = null; else cur += ch; continue; }
      if (ch === '"' || ch === "'") { q = ch; continue; }
      if (ch === ',') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  /** A local (installed) font: text measures differently with it than with each generic fallback. */
  function isInstalled(family, doc = document) {
    const key = norm(family);
    if (installed.has(key)) return installed.get(key);
    const canvas = doc.createElement('canvas');
    const g = canvas.getContext('2d');
    let yes = false;
    for (const base of ['monospace', 'serif', 'sans-serif']) {
      g.font = `72px ${base}`;
      const w0 = g.measureText(SAMPLE).width;
      g.font = `72px "${family.replace(/"/g, '')}", ${base}`;
      if (Math.abs(g.measureText(SAMPLE).width - w0) > 0.5) { yes = true; break; }
    }
    installed.set(key, yes);
    return yes;
  }

  const weightNum = w => (w === 'normal' ? 400 : w === 'bold' ? 700 : Number(w) || 400);
  function covers(faceWeight, weight) {
    const [lo, hi = lo] = String(faceWeight).split(/\s+/).map(weightNum);
    return weight >= lo && weight <= hi;
  }
  const styleOk = (faceStyle, style) => (style === 'normal' ? faceStyle === 'normal' : faceStyle !== 'normal');

  function usedFont(el) {
    const doc = el.ownerDocument || document;
    const cs = doc.defaultView.getComputedStyle(el);
    const stack = parseStack(cs.fontFamily);
    const weight = weightNum(cs.fontWeight), style = cs.fontStyle;
    const faces = doc.fonts ? [...doc.fonts] : [];
    for (let i = 0; i < stack.length; i++) {
      const fam = stack[i], key = norm(fam);
      if (GENERIC.has(key)) return { used: fam, usedIndex: i, sure: false, how: 'generic', stack };
      const mine = faces.filter(f => norm(f.family) === key);
      if (mine.length) {
        const loaded = mine.filter(f => f.status === 'loaded');
        const exact = loaded.filter(f => covers(f.weight, weight) && styleOk(f.style, style));
        if (exact.length) return { used: fam, usedIndex: i, sure: true, how: 'webfont', stack };
        if (loaded.length) return { used: fam, usedIndex: i, sure: false, how: 'webfont', stack }; // the browser fakes the weight/style
        continue; // declared but not loaded (yet, or failed): the next one draws the text
      }
      if (isInstalled(fam, doc)) return { used: fam, usedIndex: i, sure: false, how: 'local', stack };
    }
    return { used: 'serif', usedIndex: -1, sure: false, how: 'fallback', stack };
  }

  /** The color behind an element: the first non-transparent background up the tree (layers composited over white). */
  function background(el) {
    const layers = [];
    let bgImage = false;
    let node = el;
    while (node && node.nodeType === 1) {
      const cs = node.ownerDocument.defaultView.getComputedStyle(node);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') bgImage = true;
      const c = parseColor(cs.backgroundColor);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
      const parent = node.parentElement || node.getRootNode?.().host || node.ownerDocument.defaultView.frameElement || null;
      node = parent;
    }
    let rgb = [255, 255, 255];
    for (const [r, g, b, a] of layers.reverse()) rgb = [r * a + rgb[0] * (1 - a), g * a + rgb[1] * (1 - a), b * a + rgb[2] * (1 - a)].map(Math.round);
    return { rgb, bgImage };
  }
  function parseColor(s) {
    const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)/.exec(String(s));
    if (!m) return null;
    let a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : Number(m[4]);
    if (Number.isNaN(a)) a = 1;
    return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3]), a];
  }

  const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
  function inspect(el) {
    const doc = el.ownerDocument || document;
    const cs = doc.defaultView.getComputedStyle(el);
    const f = usedFont(el);
    const px = parseFloat(cs.fontSize);
    const rootPx = parseFloat(doc.defaultView.getComputedStyle(doc.documentElement).fontSize) || 16;
    const lhPx = cs.lineHeight === 'normal' ? null : parseFloat(cs.lineHeight);
    const lsPx = cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing) || 0;
    const fg = parseColor(cs.color) || [0, 0, 0, 1];
    const bg = background(el);
    // A see-through text color sits on its background.
    const fgRgb = fg[3] < 1 ? fg.slice(0, 3).map((v, i) => Math.round(v * fg[3] + bg.rgb[i] * (1 - fg[3]))) : fg.slice(0, 3);
    const C = Mochi.imageColor;
    const ratio = round(C.contrast(fgRgb, bg.rgb));
    const weight = weightNum(cs.fontWeight);
    const color = C.hex(fgRgb), bgHex = C.hex(bg.rgb);
    const lh = { css: cs.lineHeight, px: lhPx, ratio: lhPx ? round(lhPx / px) : null };
    const ls = { css: cs.letterSpacing, em: lsPx ? round(lsPx / px, 3) : 0 };
    const css = [`font-family: ${cs.fontFamily};`, `font-size: ${round(px)}px;`, `font-weight: ${weight};`, `line-height: ${lh.ratio ?? 'normal'};`, `letter-spacing: ${ls.em ? `${ls.em}em` : 'normal'};`, `color: ${color};`].join('\n');
    const ai = `Use font ${f.used}${f.sure ? '' : ' (or similar)'} at ${round(px)}px/${lh.ratio ?? 'normal'}, weight ${weight}${cs.fontStyle !== 'normal' ? `, ${cs.fontStyle}` : ''}${ls.em ? `, letter-spacing ${ls.em}em` : ''}, color ${color.toUpperCase()}`;
    return {
      ...f, size: { px: round(px), rem: round(px / rootPx, 3) }, weight, style: cs.fontStyle, lineHeight: lh, letterSpacing: ls,
      color, background: bgHex, bgImage: bg.bgImage, contrast: { ratio, aa: ratio >= 4.5, aaLarge: ratio >= 3, aaa: ratio >= 7 },
      cssStack: cs.fontFamily, css, ai,
    };
  }

  /** Does this element hold text of its own (not only in its children)? */
  const hasOwnText = el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());

  Mochi.fontDetect = { inspect, usedFont, parseStack, isInstalled, background, parseColor, hasOwnText, GENERIC };
})();
