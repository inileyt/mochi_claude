/*
 * Mochi — Scan the hero: the pure CSS/prompt builders + the WebGL check (no DOM).
 *   node test/hero-scan.test.js
 */
const assert = require('node:assert/strict');
const H = require('../src/tools/hero-scan.js');

// is3D: a WebGL canvas refuses a 2d context (null); a 2d/unused one returns one.
assert.equal(H.is3D({ getContext: t => (t === '2d' ? null : {}) }), true, 'webgl canvas → 3D');
assert.equal(H.is3D({ getContext: () => ({}) }), false, '2d canvas → not 3D');
assert.equal(H.is3D({ getContext: () => { throw new Error('x'); } }), true, 'a throwing canvas is treated as 3D');

// buildCss: CSS animations keep their @keyframes; reveals add a reusable reveal animation.
const info = {
  selector: 'header.hero', host: 'example.com', kind: 'css', threeD: false,
  anims: [{ selector: '.title', name: 'floaty', duration: '3s', timing: 'ease-in-out', iterations: 'infinite', keyframes: '@keyframes floaty { 0% { transform: none } 50% { transform: translateY(-8px) } 100% { transform: none } }' }],
  reveals: [{ selector: '.card', duration: '0.6s', timing: 'ease-out', delay: '0s', props: 'opacity, transform' }],
  canvases: [], counts: { anims: 1, reveals: 1, canvases: 0 },
};
const css = H.buildCss(info);
assert(/@keyframes floaty/.test(css) && /\.title \{ animation: floaty 3s ease-in-out infinite; \}/.test(css), 'css anim kept');
assert(/@keyframes mochi-reveal/.test(css) && /\.reveal\.in \{ animation: mochi-reveal 0\.6s ease-out both; \}/.test(css), 'reveal block');

const p = H.prompt(info);
assert(/Recreate the hero section's motion/.test(p) && /1 CSS animation/.test(p) && /1 scroll\/entrance reveal/.test(p), p.slice(0, 160));
assert(/IntersectionObserver/.test(p), 'reveal → IO snippet in prompt');

// a WebGL hero gets a Three.js recreation note and no CSS
const webgl = { selector: 'section.hero', host: 'x.com', kind: 'webgl', threeD: true, anims: [], reveals: [], canvases: [{ selector: 'canvas', webgl: true, snapshot: 'data:image/png;base64,AAA' }], counts: { anims: 0, reveals: 0, canvases: 1 } };
assert.equal(H.buildCss(webgl), '', 'no CSS for a WebGL hero');
assert(/3D \/ WebGL/.test(H.prompt(webgl)) && /Three\.js/.test(H.prompt(webgl)), 'webgl prompt');

console.log('ok   hero-scan: is3D + buildCss (anims kept, reveal block) + prompt (reveals, WebGL)');
