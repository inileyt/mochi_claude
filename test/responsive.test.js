/*
 * Mochi — Responsive preview: the pure bits (no DOM, no debugger).
 *   node test/responsive.test.js
 */
const assert = require('node:assert/strict');
const { isOverflow, DEVICES } = require('../src/tools/responsive.js');

// Content wider than the viewport (by more than a rounding pixel) means a sideways scrollbar.
assert.equal(isOverflow(800, 390), true, 'wide content on a narrow screen overflows');
assert.equal(isOverflow(390, 390), false, 'exact fit is not overflow');
assert.equal(isOverflow(391, 390), false, 'a single rounding pixel is not overflow');
assert.equal(isOverflow(392, 390), true, 'two pixels over is overflow');
assert.equal(isOverflow(700, 1280), false, 'fits on desktop');

// Three sensible presets, phone → desktop, each with a width and a height.
assert.deepEqual(DEVICES.map(d => d.id), ['mobile', 'tablet', 'desktop']);
assert.ok(DEVICES.every(d => d.w > 0 && d.h > 0 && typeof d.mobile === 'boolean'));
assert.ok(DEVICES[0].w < DEVICES[2].w, 'mobile is narrower than desktop');

console.log('ok   responsive: overflow test + device presets');
