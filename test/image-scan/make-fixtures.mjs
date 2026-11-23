// Makes the Image Scan test images (PNG) with known content: node test/image-scan/make-fixtures.mjs
// Each one is an HTML snippet rendered by Chromium at its exact size, with the fonts Mochi bundles
// (src/vendor/fonts/), so the expected palette, text and font are known. The PNGs are committed;
// run this again only to change them (then update EXPECTED.json).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
let chromium;
for (const from of [path.join(ROOT, 'dev', 'package.json'), path.join(ROOT, 'tests', 'smoke.mjs')]) {
  try { ({ chromium } = createRequire(from)('playwright')); break; } catch (_) { /* next */ }
}
const font = (family, file, weight = '400') => `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${fs.readFileSync(path.join(ROOT, 'src/vendor/fonts', file)).toString('base64')});font-weight:${weight}}`;
const FONTS = [
  font('Oswald', 'oswald-latin-wght-normal.woff2', '200 700'),
  font('Lora', 'lora-latin-wght-normal.woff2', '400 700'), font('Lora', 'lora-cyrillic-wght-normal.woff2', '400 700'),
  font('Rubik', 'rubik-latin-wght-normal.woff2', '300 900'),
].join('');

const IMAGES = {
  // 4 known colors, "SUMMER SALE" in Oswald bold.
  'poster.png': [900, 600, `<div style="position:absolute;inset:0;background:#ffd166"></div>
    <div style="position:absolute;left:0;top:430px;width:900px;height:170px;background:#ef476f"></div>
    <div style="position:absolute;left:60px;top:470px;width:220px;height:90px;background:#118ab2"></div>
    <div style="position:absolute;left:0;top:90px;width:900px;text-align:center;font:700 150px/1 Oswald;color:#073b4c">SUMMER SALE</div>`],
  // Russian text in Lora.
  'russian.png': [800, 300, `<div style="position:absolute;inset:0;background:#fdf6e3"></div>
    <div style="position:absolute;left:50px;top:70px;font:400 72px/1.2 Lora;color:#3d2b1f">Летняя распродажа</div>`],
  // A flat illustration, no text: sky, sun, two hills.
  'flat.png': [600, 600, `<div style="position:absolute;inset:0;background:#8ecae6"></div>
    <div style="position:absolute;left:380px;top:80px;width:140px;height:140px;border-radius:50%;background:#ffb703"></div>
    <div style="position:absolute;left:-150px;top:330px;width:600px;height:600px;border-radius:50%;background:#2a9d8f"></div>
    <div style="position:absolute;left:250px;top:400px;width:600px;height:600px;border-radius:50%;background:#219ebc"></div>`],
  // A photo-like gradient (a sunset sky, top to bottom) with a little grain.
  'gradient.png': [800, 450, `<div style="position:absolute;inset:0;background:linear-gradient(180deg,#1d2b64,#f8cdda)"></div>
    <svg style="position:absolute;inset:0;opacity:.06" width="800" height="450"><filter id="n"><feTurbulence baseFrequency=".9" numOctaves="2" seed="4"/></filter><rect width="800" height="450" filter="url(#n)"/></svg>`],
  // Served from a second port in the test (a cross-origin image: only the screenshot path can read it).
  'cross.png': [640, 360, `<div style="position:absolute;inset:0;background:#1d3557"></div>
    <div style="position:absolute;left:0;top:250px;width:640px;height:110px;background:#e63946"></div>
    <div style="position:absolute;left:0;top:70px;width:640px;text-align:center;font:800 120px/1 Rubik;color:#f1faee">PIXELS</div>`],
  // Taller than the window: 5 bands (tiles + stitching).
  'tall.png': [400, 2000, ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'].map((c, i) => `<div style="position:absolute;left:0;top:${i * 400}px;width:400px;height:400px;background:${c}"></div>`).join('')],
};

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, [w, h, body]] of Object.entries(IMAGES)) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><html><head><style>${FONTS}html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;position:relative}</style></head><body>${body}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(HERE, name), clip: { x: 0, y: 0, width: w, height: h } });
  console.log(`${name} ${w}×${h}`);
}
await browser.close();
