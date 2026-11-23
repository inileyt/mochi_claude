/*
 * Mochi — Image Scan: color math (sRGB ↔ Lab, ΔE 2000, HSL) and a small table of
 * color names ("dusty rose", "deep navy"…). Plain functions, used by the offscreen
 * worker page, the result card and the Node unit tests.
 *
 *   C.rgbToLab([r, g, b]) → [L, a, b]      C.labToRgb([L, a, b]) → [r, g, b]
 *   C.deltaE(lab1, lab2)  → ΔE 2000          C.hex([r, g, b]) → '#rrggbb'
 *   C.hsl([r, g, b]) → [h, s, l]             C.name([r, g, b]) → 'dusty rose'
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  const toLinear = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const fromLinear = c => { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(v * 255))); };
  const Xn = 0.95047, Yn = 1, Zn = 1.08883;
  const f = t => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fInv = t => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));

  // A cache: the palette converts many pixels and most images repeat colors.
  const cache = new Map();
  function rgbToLab([r, g, b]) {
    const key = (r << 16) | (g << 8) | b;
    const hit = cache.get(key);
    if (hit) return hit;
    const R = toLinear(r), G = toLinear(g), B = toLinear(b);
    const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / Xn;
    const Y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750) / Yn;
    const Z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / Zn;
    const lab = [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
    if (cache.size > 200000) cache.clear();
    cache.set(key, lab);
    return lab;
  }
  function labToRgb([L, a, b]) {
    const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    const X = fInv(fx) * Xn, Y = (L > 8 ? fy ** 3 : L / (24389 / 27)) * Yn, Z = fInv(fz) * Zn;
    return [
      fromLinear(X * 3.2404542 - Y * 1.5371385 - Z * 0.4985314),
      fromLinear(-X * 0.9692660 + Y * 1.8760108 + Z * 0.0415560),
      fromLinear(X * 0.0556434 - Y * 0.2040259 + Z * 1.0572252),
    ];
  }

  /** CIEDE2000 color difference (≈ 1: just noticeable; < 5: the same color to most people). */
  function deltaE([L1, a1, b1], [L2, a2, b2]) {
    const rad = Math.PI / 180;
    const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
    const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
    const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
    const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
    const h = (x, y) => { if (!x && !y) return 0; const v = Math.atan2(y, x) / rad; return v < 0 ? v + 360 : v; };
    const h1p = h(a1p, b1), h2p = h(a2p, b2);
    const dL = L2 - L1, dC = C2p - C1p;
    let dh = 0;
    if (C1p * C2p) { dh = h2p - h1p; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
    const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh / 2) * rad);
    const Lm = (L1 + L2) / 2, Cmp = (C1p + C2p) / 2;
    let hm = h1p + h2p;
    if (C1p * C2p) { if (Math.abs(h1p - h2p) > 180) hm += hm < 360 ? 360 : -360; hm /= 2; }
    const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
    const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
    const Rc = 2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7));
    const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2), Sc = 1 + 0.045 * Cmp, Sh = 1 + 0.015 * Cmp * T;
    const Rt = -Math.sin(2 * dTheta * rad) * Rc;
    return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
  }

  const hex = ([r, g, b]) => `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  const fromHex = s => { const m = /^#?([0-9a-f]{6})$/i.exec(String(s).trim()); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  function hsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, Math.round(l * 100)];
    const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)];
  }
  /** Chroma and hue angle in Lab (LCh). */
  const lch = ([L, a, b]) => { let hh = Math.atan2(b, a) * 180 / Math.PI; if (hh < 0) hh += 360; return [L, Math.hypot(a, b), hh]; };
  /** WCAG contrast ratio of two sRGB colors. */
  const luminance = ([r, g, b]) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  const contrast = (x, y) => { const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };

  // ——— names: the nearest entry by ΔE 2000 ———
  const NAMES = [
    ['black', '#000000'], ['soft black', '#1b1b1b'], ['charcoal', '#36454f'], ['graphite', '#41424c'], ['slate gray', '#708090'],
    ['gray', '#808080'], ['warm gray', '#8b8378'], ['cool gray', '#8c92ac'], ['silver', '#c0c0c0'], ['light gray', '#d3d3d3'],
    ['pale gray', '#e8e8e8'], ['off-white', '#f5f5f0'], ['white', '#ffffff'], ['ivory', '#fffff0'], ['cream', '#fffdd0'],
    ['eggshell', '#f0ead6'], ['linen', '#faf0e6'], ['beige', '#f5f5dc'], ['sand', '#c2b280'], ['tan', '#d2b48c'],
    ['khaki', '#c3b091'], ['camel', '#c19a6b'], ['taupe', '#8b7d6b'], ['dark taupe', '#483c32'], ['coffee', '#6f4e37'],
    ['chocolate', '#7b3f00'], ['dark brown', '#4b2e1e'], ['brown', '#964b00'], ['caramel', '#af6f3c'], ['cinnamon', '#d2691e'],
    ['rust', '#b7410e'], ['terracotta', '#e2725b'], ['burnt orange', '#cc5500'], ['orange', '#ff8c00'], ['tangerine', '#f28500'],
    ['amber', '#ffbf00'], ['peach', '#ffcba4'], ['apricot', '#fbceb1'], ['coral', '#ff7f50'], ['salmon', '#fa8072'],
    ['tomato red', '#ff6347'], ['vermilion', '#e34234'], ['scarlet', '#ff2400'], ['bright red', '#ff0000'], ['cherry red', '#d2042d'],
    ['crimson', '#dc143c'], ['brick red', '#b22222'], ['deep red', '#8b0000'], ['burgundy', '#800020'], ['maroon', '#5c1a1b'],
    ['wine', '#722f37'], ['oxblood', '#4a0000'], ['raspberry', '#e30b5c'], ['rose', '#ff007f'], ['dusty rose', '#c08081'],
    ['blush pink', '#f4c2c2'], ['pale pink', '#fadadd'], ['pink', '#ffc0cb'], ['hot pink', '#ff69b4'], ['bubblegum pink', '#ff85c1'],
    ['magenta', '#ff00ff'], ['fuchsia', '#c3189b'], ['orchid', '#da70d6'], ['mauve', '#b784a7'], ['lilac', '#c8a2c8'],
    ['lavender', '#e6e6fa'], ['periwinkle', '#ccccff'], ['violet', '#8f00ff'], ['purple', '#800080'], ['plum', '#8e4585'],
    ['grape', '#6f2da8'], ['eggplant', '#3b1f3a'], ['deep purple', '#36013f'], ['indigo', '#4b0082'], ['slate blue', '#6a5acd'],
    ['ultramarine', '#3f00ff'], ['blue', '#0000ff'], ['royal blue', '#4169e1'], ['cobalt blue', '#0047ab'], ['denim blue', '#1560bd'],
    ['navy', '#000080'], ['deep navy', '#0b1a3a'], ['midnight blue', '#191970'], ['ink blue', '#1f2a44'], ['steel blue', '#4682b4'],
    ['azure', '#007fff'], ['cornflower blue', '#6495ed'], ['sky blue', '#87ceeb'], ['baby blue', '#a1caf1'], ['powder blue', '#b0e0e6'],
    ['ice blue', '#dbeef4'], ['cyan', '#00ffff'], ['aqua', '#00d7d7'], ['turquoise', '#40e0d0'], ['teal', '#008080'],
    ['deep teal', '#014d4e'], ['petrol', '#005f6a'], ['seafoam', '#93e9be'], ['mint', '#98ff98'], ['pale mint', '#d5f5e3'],
    ['jade', '#00a86b'], ['emerald', '#50c878'], ['kelly green', '#4cbb17'], ['bright green', '#00ff00'], ['green', '#008000'],
    ['forest green', '#228b22'], ['bottle green', '#006a4e'], ['dark green', '#013220'], ['hunter green', '#355e3b'], ['olive', '#808000'],
    ['olive drab', '#6b8e23'], ['moss green', '#8a9a5b'], ['sage', '#9caf88'], ['pistachio', '#93c572'], ['lime', '#bfff00'],
    ['chartreuse', '#7fff00'], ['lemon yellow', '#fff44f'], ['bright yellow', '#ffff00'], ['butter yellow', '#fff5a0'], ['pale yellow', '#fdfd96'],
    ['mustard', '#e1ad01'], ['gold', '#ffd700'], ['golden yellow', '#ffc72c'], ['ochre', '#cc7722'], ['bronze', '#cd7f32'],
    ['copper', '#b87333'], ['mahogany', '#c04000'], ['sienna', '#a0522d'], ['umber', '#635147'], ['sepia', '#704214'],
  ].map(([name, h]) => ({ name, rgb: fromHex(h), lab: null }));
  for (const n of NAMES) n.lab = rgbToLab(n.rgb);

  function name(rgb) {
    const lab = rgbToLab(rgb);
    let best = NAMES[0], bestD = Infinity;
    for (const n of NAMES) { const d = deltaE(lab, n.lab); if (d < bestD) { bestD = d; best = n; } }
    return best.name;
  }

  Mochi.imageColor = { rgbToLab, labToRgb, deltaE, hex, fromHex, hsl, lch, luminance, contrast, name, NAMES };
  if (typeof module !== 'undefined') module.exports = Mochi.imageColor;
})();
