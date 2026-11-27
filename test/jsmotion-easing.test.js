/* JS-motion easing: a one-shot move's easing is fitted to the nearest cubic-bezier.   node test/jsmotion-easing.test.js */
const assert = require('node:assert/strict');
globalThis.Mochi = { deepScan: { addPhase() {}, cleanup: [] } };
const M = require('../src/deep-scan/jsmotion.js');
const { fit, bezierY, nearestEasing } = M;

const ts = Array.from({ length: 21 }, (_, i) => i * 50); // 0 … 1000 ms

// A perfectly linear move fits 'linear' with ~no error.
{
  const vs = ts.map(t => (t / 1000) * 100);
  const f = fit(ts, vs);
  assert.equal(f.kind, 'once');
  assert.equal(f.easing, 'linear', `linear → ${f.easing}`);
  assert.ok(f.easingError < 0.02, `error ${f.easingError}`);
  assert.ok(/^cubic-bezier\(/.test(f.cubicBezier), f.cubicBezier);
}

// A slow-start move (value ~ t²) fits an "ease-in" family curve.
{
  const vs = ts.map(t => 100 * (t / 1000) ** 2);
  const f = fit(ts, vs);
  assert.ok(/in/.test(f.easing) && !/out/.test(f.easing), `t² → ${f.easing}`);
}

// A fast-start move (value ~ 1-(1-t)²) fits an "ease-out" family curve.
{
  const vs = ts.map(t => 100 * (1 - (1 - t / 1000) ** 2));
  const f = fit(ts, vs);
  assert.ok(/out/.test(f.easing), `fast-start → ${f.easing}`);
}

// bezierY is monotonic and spans 0..1; nearestEasing recovers the curve it was sampled from.
{
  assert.ok(Math.abs(bezierY([0, 0, 1, 1], 0.5) - 0.5) < 1e-6, 'linear bezier is identity');
  const p = [0, 0, 0.58, 1]; // ease-out
  const nx = Array.from({ length: 11 }, (_, i) => i / 10);
  const ny = nx.map(x => bezierY(p, x));
  assert.equal(nearestEasing(nx, ny).name, 'ease-out', 'recovers ease-out');
}

console.log('ok   jsmotion: cubic-bezier easing fit (linear / ease-in / ease-out)');
