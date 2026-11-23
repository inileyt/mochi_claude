/* Color picker: formats, OKLCH and WCAG contrast against known values.   node test/color-math.test.js */
const assert = require('node:assert/strict');
globalThis.Mochi = {};
require('../src/image-scan/colors.js');
const M = require('../src/tools/color-math.js');

const f = M.formats('#f97316');
assert.equal(f.hex, '#F97316');
assert.equal(f.rgb, 'rgb(249 115 22)');
assert.equal(f.hsl, 'hsl(25 95% 53%)');
// OKLCH references (CSS Color 4 / oklch.com): red, white, black, Tailwind orange-500.
const near = (a, b, e) => Math.abs(a - b) <= e;
const red = M.oklch([255, 0, 0]);
assert.ok(near(red[0], 0.62796, 0.0005) && near(red[1], 0.25768, 0.0005) && near(red[2], 29.234, 0.05), `red ${red}`);
assert.ok(near(M.oklch([255, 255, 255])[0], 1, 0.0001) && M.oklch([255, 255, 255])[1] < 0.001);
assert.deepEqual(M.oklch([0, 0, 0]).map(v => Math.round(v * 1000)), [0, 0, 0]);
assert.ok(/^oklch\(70\.5% 0\.187 4[67]\.\d\)$/.test(f.oklch), f.oklch);
assert.ok(f.name);

// WCAG contrast: well-known pairs.
assert.equal(M.wcag('#000000', '#ffffff').ratio, 21);
assert.equal(M.wcag('#777777', '#ffffff').ratio, 4.48); // the classic "just fails AA"
assert.deepEqual(M.wcag('#777777', '#ffffff'), { ratio: 4.48, aa: false, aaLarge: true, aaa: false, aaaLarge: false });
assert.equal(M.wcag('#767676', '#ffffff').ratio, 4.54); // the lightest gray that passes AA
assert.equal(M.wcag('#767676', '#ffffff').aa, true);
assert.equal(M.wcag('#1f2937', '#ffffff').ratio, 14.68);
assert.equal(M.wcag('#ffffff', '#1f2937').ratio, 14.68, 'symmetric');
assert.equal(M.wcag('#595959', '#ffffff').aaa, true); // 7.0
assert.equal(M.wcag('#f97316', '#ffffff').ratio, 2.8);

// Export.
const css = M.exportAs(['#f97316', '#000000'], 'css');
assert.match(css, /^:root \{\n  --[a-z-]+: #f97316;\n  --black: #000000;\n\}$/);
assert.match(M.exportAs(['#f97316'], 'tailwind'), /'[a-z-]+': '#f97316',/);
const json = JSON.parse(M.exportAs(['#f97316'], 'json'));
assert.equal(json[0].hex, '#F97316'); assert.ok(json[0].oklch && json[0].name);
console.log(`ok   color math: ${f.hex} ${f.rgb} ${f.hsl} ${f.oklch}; WCAG pairs; exports`);
