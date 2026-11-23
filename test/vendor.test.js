/*
 * Image Scan ships its libraries (no CDN): check every bundled file is there and the
 * extension stays a reasonable size.   node test/vendor.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const { FONTS, files } = require('../src/image-scan/fonts.js');

const tess = ['worker.min.js', 'tesseract.min.js', 'tesseract-core-simd-lstm.js', 'tesseract-core-simd-lstm.wasm', 'lang/eng.traineddata.gz', 'lang/rus.traineddata.gz'];
for (const f of tess) assert.ok(fs.existsSync(path.join(root, 'src/vendor/tesseract', f)), `missing src/vendor/tesseract/${f}`);
assert.equal(FONTS.length, 20);
for (const font of FONTS) for (const f of files(font)) assert.ok(fs.existsSync(path.join(root, f.path)), `missing ${f.path}`);
for (const cat of ['sans-serif', 'serif', 'slab', 'monospace', 'script', 'display']) assert.ok(FONTS.some(f => f.category === cat), `no ${cat} font`);

// Nothing in the shipped code loads from a CDN.
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const size = ['src', 'pages', 'icons'].flatMap(d => walk(path.join(root, d))).reduce((n, f) => n + fs.statSync(f).size, 0);
assert.ok(size < 15e6, `the extension is ${(size / 1e6).toFixed(1)} MB`);
for (const f of walk(path.join(root, 'src')).filter(f => /\.(js|html)$/.test(f) && !f.includes('/vendor/'))) {
  const text = fs.readFileSync(f, 'utf8');
  assert.ok(!/cdn\.jsdelivr|unpkg\.com|cdnjs|tessdata\.projectnaptha/.test(text), `${f} mentions a CDN`);
}
console.log(`ok   vendor files present (${tess.length} Tesseract, ${FONTS.length} fonts); extension ${(size / 1e6).toFixed(1)} MB unpacked`);
