/* Scan animation: the pure core (reconstruct JS motion, describe, prompt).  node test/anim-core.test.js */
const assert = require('node:assert/strict');
const A = require('../src/tools/anim-core.js');

// A vertical bob: ty swings 0 → -12 → 0 over ~3s.
const samples = [];
for (let i = 0; i <= 60; i++) { const t = i * 50; samples.push({ t, tx: 0, ty: -12 * Math.sin((t / 3000) * 2 * Math.PI) * 0.5 - 6 + 6, scale: 1, rot: 0, opacity: 1 }); }
// make it clearly move on ty
for (let i = 0; i <= 60; i++) samples[i].ty = -12 * (0.5 - 0.5 * Math.cos((i / 60) * 2 * Math.PI));

const r = A.reconstruct(samples);
assert.ok(r, 'reconstruct returned null for a moving element');
assert.ok(r.moving.includes('ty'), `moving: ${r.moving}`);
assert.ok(/@keyframes mochi-move \{/.test(r.css) && /\d+% \{/.test(r.css), r.css);
assert.ok(/animation: mochi-move [\d.]+s/.test(r.shorthand), r.shorthand);
assert.ok(r.duration >= 2 && r.duration <= 4, `duration ${r.duration}`);

// A still element → nothing to reconstruct.
assert.equal(A.reconstruct(Array.from({ length: 20 }, (_, i) => ({ t: i * 50, tx: 0, ty: 0, scale: 1, rot: 0, opacity: 1 }))), null);
assert.equal(A.reconstruct([{ t: 0 }]), null, 'too few samples');

// describe
assert.match(A.describe({ kind: 'css', name: 'spin', duration: 2, timing: 'linear', iterations: 'infinite' }), /CSS animation `spin`.*2s.*linear.*looping/);
assert.match(A.describe({ kind: 'js', moving: ['ty'], duration: 3 }), /moves vertically.*~3s/);
assert.match(A.describe({ kind: 'transition', transitions: ['opacity 0.2s ease'] }), /transitions: opacity 0\.2s ease/);
assert.match(A.describe({ kind: 'none' }), /No animation/);

// prompt carries the css and the reduced-motion note
const p = A.prompt({ kind: 'css', selector: '.btn', host: 'x.com', name: 'spin', css: '@keyframes spin { to { transform: rotate(360deg); } }' });
assert.ok(p.includes('@keyframes spin') && /prefers-reduced-motion/.test(p) && p.startsWith('Recreate this animation from x.com'), p.slice(0, 80));

console.log('ok   anim core: reconstruct, describe, prompt');
