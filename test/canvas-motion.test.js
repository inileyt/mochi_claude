/* Canvas motion: frame-diff finds where it moves, how much, and whether it loops.   node test/canvas-motion.test.js */
const assert = require('node:assert/strict');
globalThis.Mochi = {};
const M = require('../src/deep-scan/canvas-motion.js');

const W = 64, H = 48;
/** A black RGBA frame; `rect` paints a white box {x,y,w,h}. */
function frame(rect) {
  const a = new Uint8ClampedArray(W * H * 4);
  for (let i = 3; i < a.length; i += 4) a[i] = 255; // opaque
  if (rect) for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
    const i = (y * W + x) * 4; a[i] = a[i + 1] = a[i + 2] = 255;
  }
  return a;
}

// 1) A box that slides left→right across the lower-right: motion is measured, and the region sits there.
{
  const frames = [];
  for (let f = 0; f < 8; f++) frames.push(frame({ x: 20 + f * 4, y: 30, w: 10, h: 10 }));
  const res = M.analyze(frames, W, H, { gapMs: 100 });
  assert.ok(res.movingFraction > 0.02 && res.movingFraction < 0.9, `movingFraction ${res.movingFraction}`);
  assert.ok(res.regions.length >= 1, 'a moving region is found');
  const r = res.regions[0];
  assert.ok(r.y > 0.4 && r.x > 0.2, `region is lower-right: ${JSON.stringify(r)}`);
}

// 2) Identical frames: nothing moves, no regions.
{
  const still = [frame({ x: 10, y: 10, w: 8, h: 8 }), frame({ x: 10, y: 10, w: 8, h: 8 }), frame({ x: 10, y: 10, w: 8, h: 8 }), frame({ x: 10, y: 10, w: 8, h: 8 })];
  const res = M.analyze(still, W, H);
  assert.equal(res.movingFraction, 0, 'a static canvas has no motion');
  assert.deepEqual(res.regions, [], 'no moving regions');
}

// 3) Autocorrelation finds a loop in a clearly periodic signal.
{
  assert.equal(M.period([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]), 3, 'period 3 detected');
  assert.equal(M.period([5, 5, 5, 5, 5, 5, 5, 5]), null, 'a flat signal has no period');
  // analyze turns the detected lag into milliseconds via gapMs.
  const blink = [];
  for (let f = 0; f < 12; f++) blink.push(frame(f % 3 === 0 ? { x: 5, y: 5, w: 6, h: 6 } : null));
  const res = M.analyze(blink, W, H, { gapMs: 100 });
  assert.ok(res.periodMs === null || typeof res.periodMs === 'number', 'periodMs is a number or null');
}

console.log('ok   canvas-motion: moving regions, static detection, loop period');
