/*
 * Mochi — color picker: one color in every format, and the WCAG contrast check.
 *   Mochi.colorMath.formats('#f97316') → { hex: '#F97316', rgb: 'rgb(249 115 22)', hsl: 'hsl(25 95% 53%)', oklch: 'oklch(70.5% 0.187 47.6)' }
 *   Mochi.colorMath.oklch([r, g, b]) → [L (0–1), C, h (deg)]
 *   Mochi.colorMath.wcag(fg, bg) → { ratio, aa, aaLarge, aaa, aaaLarge }   (ratio rounded to 2 decimals)
 *   Mochi.colorMath.exportAs(colors, 'css' | 'tailwind' | 'json')
 * Uses the color names and the contrast formula of src/image-scan/colors.js.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const C = Mochi.imageColor || (typeof require === 'function' ? require('../image-scan/colors.js') : null);

  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  function oklch([r, g, b]) {
    const R = lin(r), G = lin(g), B = lin(b);
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    const Cc = Math.hypot(A, Bb);
    let h = (Math.atan2(Bb, A) * 180) / Math.PI;
    if (h < 0) h += 360;
    return [L, Cc, Cc < 0.0005 ? 0 : h];
  }
  const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

  function formats(hex) {
    const rgb = C.fromHex(hex);
    if (!rgb) return null;
    const [h, s, l] = C.hsl(rgb);
    const [L, Cc, H] = oklch(rgb);
    return {
      hex: C.hex(rgb).toUpperCase(),
      rgb: `rgb(${rgb.join(' ')})`,
      hsl: `hsl(${h} ${s}% ${l}%)`,
      oklch: `oklch(${round(L * 100, 1)}% ${round(Cc, 3)} ${round(H, 1)})`,
      name: C.name(rgb),
      values: { rgb, hsl: [h, s, l], oklch: [round(L, 4), round(Cc, 4), round(H, 2)] },
    };
  }

  /** WCAG 2.x: AA needs 4.5 (normal text) / 3 (large: 24px, or 18.66px bold); AAA 7 / 4.5. */
  function wcag(fg, bg) {
    const ratio = round(C.contrast(C.fromHex(fg), C.fromHex(bg)), 2);
    return { ratio, aa: ratio >= 4.5, aaLarge: ratio >= 3, aaa: ratio >= 7, aaaLarge: ratio >= 4.5 };
  }

  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'color';
  function names(colors) {
    const seen = {};
    return colors.map(hex => { const base = slug(C.name(C.fromHex(hex))); seen[base] = (seen[base] || 0) + 1; return seen[base] > 1 ? `${base}-${seen[base]}` : base; });
  }
  function exportAs(colors, kind) {
    const list = colors.map(h => C.hex(C.fromHex(h)));
    const n = names(list);
    if (kind === 'css') return `:root {\n${list.map((h, i) => `  --${n[i]}: ${h};`).join('\n')}\n}`;
    if (kind === 'tailwind') return `// tailwind.config.js → theme.extend.colors\ncolors: {\n${list.map((h, i) => `  '${n[i]}': '${h}',`).join('\n')}\n},`;
    return JSON.stringify(list.map((h, i) => ({ name: n[i], ...(({ name, values, ...f }) => f)(formats(h)) })), null, 2);
  }

  Mochi.colorMath = { oklch, formats, wcag, exportAs };
  if (typeof module !== 'undefined') module.exports = Mochi.colorMath;
})();
