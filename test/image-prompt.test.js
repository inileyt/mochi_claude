/*
 * Image Scan: the AI image prompts and the "Ask Claude" question.   node test/image-prompt.test.js
 */
const assert = require('node:assert/strict');
const P = require('../src/image-scan/prompt.js');

// Aspect ratios: common ones snap, others become a small fraction.
assert.equal(P.aspect(1200, 800).label, '3:2');
assert.equal(P.aspect(1080, 1920).label, '9:16');
assert.equal(P.aspect(500, 500).orientation, 'square');
assert.equal(P.aspect(1000, 610).label, '13:8');
assert.equal(P.aspect(600, 1800).label, '1:3');
assert.equal(P.sdSize(P.aspect(1200, 800)), '1280×832');

const palette = {
  colors: [
    { hex: '#ffd166', name: 'golden yellow', role: 'background', share: 70, exact: true },
    { hex: '#073b4c', name: 'deep teal', role: 'text', share: 20, exact: true },
    { hex: '#ef476f', name: 'raspberry', role: 'accent', share: 10, exact: true },
  ],
  overall: { tone: 'light', temperature: 'warm', saturation: 'high' },
  gradient: null,
};
const font = { category: 'display', weight: { value: 700, label: 'bold' }, width: 'condensed', case: 'all caps', letterSpacing: { em: 0.02, label: 'normal' }, color: { hex: '#073b4c', name: 'deep teal' }, matches: [{ family: 'Oswald', score: 97 }] };
const base = { width: 1200, height: 800, palette, ocr: { found: true, text: 'SUMMER SALE' }, fonts: [font], source: { full: { w: 600, h: 400 }, alt: '' } };

// Without a description: still useful prompts from palette + text + font.
const a = P.build(base);
assert.equal(a.aspect.label, '3:2');
for (const [name, text] of Object.entries({ universal: a.universal, midjourney: a.midjourney, sd: a.sd.prompt, dalle: a.dalle })) {
  for (const c of palette.colors) assert.ok(text.includes(c.hex), `${name} lacks ${c.hex}`);
  assert.ok(text.includes('SUMMER SALE'), `${name} lacks the text`);
}
assert.match(a.universal, /^Flat graphic design built around a headline\. /);
assert.match(a.universal, /bold condensed all-caps display sans-serif type, similar to Oswald/);
assert.match(a.universal, /Aspect ratio 3:2 \(landscape\)/);
assert.match(a.midjourney, /--ar 3:2 --stylize 50 --no watermark, signature, blurry$/);
assert.match(a.sd.negative, /misspelled text/);
assert.doesNotMatch(a.sd.negative, /(^|, )text,/);
assert.equal(a.sd.size, '1280×832 (3:2)');
assert.match(a.dalle, /Write the text “SUMMER SALE” exactly as given/);
assert.match(a.alt, /^Flat graphic design with the text “SUMMER SALE” in golden yellow and deep teal\.$/);

// With the on-device description: subject, setting, camera, lighting go in.
const d = { subject: 'a red vintage bicycle', objects: ['oak tree', 'wooden bench'], setting: 'a quiet park in autumn', style: 'photo', lighting: 'golden hour backlight', mood: 'nostalgic', composition: 'rule of thirds', camera: 'eye level', caption: 'A red vintage bicycle leaning on an oak tree in an autumn park.' };
const photo = { ...base, ocr: { found: false, text: '' }, fonts: [], description: d, palette: { ...palette, colors: palette.colors.map(c => ({ ...c, exact: false })) } };
const b = P.build(photo);
assert.match(b.universal, /^Photo of a red vintage bicycle, with oak tree and wooden bench, set in a quiet park in autumn\./);
assert.match(b.universal, /Composition: rule of thirds; camera: eye level\./);
assert.match(b.midjourney, / --ar 3:2 --style raw --stylize 100 --no watermark, signature, blurry, text, letters$/);
assert.match(b.sd.negative, /(^|, )text, letters/);
assert.match(b.dalle, /Do not add any text\./);
assert.equal(b.alt, d.caption);

// A gradient: the direction is in the palette sentence.
const g = P.build({ ...base, ocr: { found: false }, fonts: [], palette: { ...palette, gradient: { direction: 'to bottom', from: '#000080', to: '#ffa500' } } });
assert.match(g.universal, /^Smooth gradient artwork\. /);
assert.match(g.universal, /gradient to bottom from #000080 to #ffa500/);

// The question for Claude: the four formats, what Mochi measured, and the answer language.
const q = P.question(base, 'hy');
for (const want of ['Midjourney', '--ar 3:2', 'Stable Diffusion', 'negative prompt', 'DALL·E', 'alt text', '#ffd166', '“SUMMER SALE”', 'Please answer in Armenian']) assert.ok(q.includes(want), `question lacks ${want}`);
assert.ok(!P.question(base, 'en').includes('Please answer in'));
console.log('ok   prompts: universal / Midjourney / SD + negative / DALL·E / alt, with and without a description; the Claude question');
