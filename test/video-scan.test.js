/*
 * Mochi — Scan a video: the pure HTML/prompt builders (no DOM).
 *   node test/video-scan.test.js
 */
const assert = require('node:assert/strict');
const V = require('../src/tools/video-scan.js');

const info = {
  selector: 'video.hero-bg', host: 'example.com', videoW: 1920, videoH: 1080, boxW: 1200, boxH: 675,
  duration: 12.4, live: false, poster: 'https://example.com/p.jpg',
  attrs: { autoplay: true, loop: true, muted: true, controls: false, playsinline: true, preload: 'auto' },
  objectFit: 'cover', radius: '12px',
  sources: [{ src: 'https://example.com/v.mp4', type: 'video/mp4', media: '' }, { src: 'https://example.com/v.webm', type: 'video/webm', media: '' }],
};

const html = V.html(info);
// a background hero video: autoplay/loop/muted/inline, NO controls
assert(/^<video autoplay loop muted playsinline/.test(html), html);
assert(!/controls/.test(html), 'hero bg video should not add controls');
assert(html.includes('poster="https://example.com/p.jpg"'), 'poster');
assert(html.includes('object-fit: cover') && html.includes('border-radius: 12px'), 'style');
assert(html.includes('<source src="https://example.com/v.mp4" type="video/mp4">'), 'mp4 source');
assert(html.includes('<source src="https://example.com/v.webm" type="video/webm">'), 'webm source');

const p = V.prompt(info);
assert(/Recreate this HTML5 video player/.test(p) && /1920×1080/.test(p) && /object-fit: cover/.test(p), p.slice(0, 120));
assert(p.includes('v.mp4') && p.includes('```html'), 'prompt lists sources + html');

// a normal player WITH controls
const player = V.html({ ...info, attrs: { ...info.attrs, controls: true, autoplay: false }, poster: null, radius: null });
assert(/^<video controls loop muted playsinline/.test(player), player);
assert(!/poster=/.test(player), 'no poster');

console.log('ok   video-scan: html (flags, sources, poster, style) + prompt');
