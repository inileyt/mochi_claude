/*
 * Image Scan: color math and the palette.   node test/palette.test.js
 */
const assert = require('node:assert/strict');
const C = require('../src/image-scan/colors.js');
const P = require('../src/image-scan/palette.js');

// ΔE 2000: a reference pair from Sharma, Wu & Dalal (2005).
assert.ok(Math.abs(C.deltaE([50, 2.6772, -79.7751], [50, 0, -82.7485]) - 2.0425) < 1e-3, 'ΔE2000 reference');
assert.ok(Math.abs(C.deltaE([50, -1, 2], [50, -1, 2])) < 1e-9);
const white = C.rgbToLab([255, 255, 255]);
assert.ok(Math.abs(white[0] - 100) < 0.01 && Math.abs(white[1]) < 0.01 && Math.abs(white[2]) < 0.01, `white ${white}`);
for (const hex of ['#e4572e', '#17324d', '#2a9d8f', '#f4e1c1', '#000000', '#ffffff']) {
  assert.equal(C.hex(C.labToRgb(C.rgbToLab(C.fromHex(hex)))), hex, `Lab round trip ${hex}`);
}
assert.deepEqual(C.hsl([255, 0, 0]), [0, 100, 50]);
assert.equal(C.name(C.fromHex('#000080')), 'navy');
assert.equal(C.name(C.fromHex('#c08081')), 'dusty rose');
assert.equal(C.name(C.fromHex('#0c1b3b')), 'deep navy');
assert.ok(C.contrast([0, 0, 0], [255, 255, 255]) > 20);

/** A fake ImageData: draw(x, y) → [r, g, b]. */
const image = (w, h, draw) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const [r, g, b] = draw(x, y); data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; }
  return { width: w, height: h, data };
};

// A poster: background, a big orange block, a teal block, dark "text" stripes, with anti-aliased edges.
const poster = { bg: '#f4e1c1', orange: '#e4572e', teal: '#2a9d8f', ink: '#17324d' };
const rgb = Object.fromEntries(Object.entries(poster).map(([k, v]) => [k, C.fromHex(v)]));
const mix = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
const img = image(400, 300, (x, y) => {
  if (x >= 40 && x < 220 && y >= 40 && y < 170) return x === 40 || x === 219 ? mix(rgb.orange, rgb.bg, 0.5) : rgb.orange;
  if (x >= 250 && x < 360 && y >= 40 && y < 170) return rgb.teal;
  if (y >= 200 && y < 260 && x >= 40 && x < 360 && (Math.floor(x / 6) % 2 === 0)) return (x % 6 === 5) ? mix(rgb.ink, rgb.bg, 0.5) : rgb.ink;
  return rgb.bg;
});
const pal = P.extract(img);
for (const [role, hex] of Object.entries(poster)) {
  const want = C.rgbToLab(C.fromHex(hex));
  const got = pal.colors.map(c => C.deltaE(C.rgbToLab(C.fromHex(c.hex)), want)).sort((a, b) => a - b)[0];
  assert.ok(got < 2, `${role} ${hex} not in the palette (closest ΔE ${got.toFixed(1)}): ${pal.colors.map(c => c.hex)}`);
}
assert.ok(pal.colors.length >= 4 && pal.colors.length <= 8, `${pal.colors.length} colors`);
assert.equal(pal.colors.find(c => c.role === 'background')?.hex, poster.bg, JSON.stringify(pal.colors.map(c => [c.hex, c.role, c.share])));
assert.equal(pal.colors.find(c => c.role === 'text')?.hex, poster.ink, 'text role');
assert.equal(pal.colors.find(c => c.role === 'dominant')?.hex, poster.orange, 'dominant role');
assert.equal(pal.colors.find(c => c.role === 'accent')?.hex, poster.teal, 'accent role');
const total = pal.colors.reduce((t, c) => t + c.share, 0);
assert.ok(Math.abs(total - 100) < 0.5, `shares add to ${total}`);
assert.equal(pal.overall.tone, 'light');
assert.equal(pal.gradient, null, 'a poster is not a gradient');
for (const c of pal.colors) assert.ok(c.name && c.hsl.length === 3 && c.rgb.length === 3);

// Gradients: the direction and the ends.
const red = [255, 0, 0], blue = [0, 0, 255];
const horiz = P.extract(image(320, 200, x => mix(red, blue, x / 319)));
assert.equal(horiz.gradient?.direction, 'to right', JSON.stringify(horiz.gradient));
assert.ok(C.deltaE(C.rgbToLab(C.fromHex(horiz.gradient.from)), C.rgbToLab(red)) < 12, horiz.gradient.from);
const vert = P.extract(image(200, 320, (x, y) => mix([10, 20, 80], [255, 165, 0], y / 319)));
assert.equal(vert.gradient?.direction, 'to bottom', JSON.stringify(vert.gradient));
assert.equal(vert.overall.temperature, 'warm');
const diag = P.extract(image(300, 300, (x, y) => mix([250, 250, 250], [20, 40, 120], (x + y) / 598)));
assert.equal(diag.gradient?.direction, 'to bottom right', JSON.stringify(diag.gradient));

// Temperature and saturation.
assert.equal(P.extract(image(100, 100, () => [30, 80, 200])).overall.temperature, 'cool');
const grayish = P.extract(image(100, 100, (x) => [120 + (x % 3), 120, 121]));
assert.equal(grayish.overall.saturation, 'low');
assert.equal(grayish.overall.tone, 'dark');

// Copy formats.
assert.match(P.asCss(pal.colors), /--color-background: #f4e1c1;/);
assert.match(P.asTailwind(pal.colors), /'dominant': '#e4572e'/);

// Deterministic: the same image → the same palette.
assert.deepEqual(P.extract(img).colors.map(c => c.hex), pal.colors.map(c => c.hex));
console.log(`ok   palette: ${pal.colors.map(c => `${c.hex} ${c.role} ${c.share}%`).join(', ')}; gradients ${horiz.gradient.direction} / ${vert.gradient.direction} / ${diag.gradient.direction}`);
