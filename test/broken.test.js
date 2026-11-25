/*
 * Mochi — Broken links & images: the pure classifier (no DOM).
 *   node test/broken.test.js
 */
const assert = require('node:assert/strict');
const { classify } = require('../src/tools/broken.js');

// Images: a loaded-but-empty one is broken; a no-src one is broken; a good one with no alt is a warning.
const images = [
  { el: 1, sel: 'img#hero', hasSrc: true, complete: true, naturalWidth: 0, hasAlt: true, srcShort: 'https://x/hero.png' }, // broken
  { el: 2, sel: 'img.icon', hasSrc: false, complete: true, naturalWidth: 0, hasAlt: true, srcShort: '' }, // broken (no src)
  { el: 3, sel: 'img#ok', hasSrc: true, complete: true, naturalWidth: 300, hasAlt: false, srcShort: '/ok.jpg' }, // missing alt only
  { el: 4, sel: 'img#loading', hasSrc: true, complete: false, naturalWidth: 0, hasAlt: true, srcShort: '/slow.jpg' }, // still loading → fine
  { el: 5, sel: 'img#fine', hasSrc: true, complete: true, naturalWidth: 120, hasAlt: true, srcShort: '/fine.jpg' }, // fine
];
// Links: empty / "#" / javascript: are dead; an in-page #id with no target is dead; a real one is fine.
const links = [
  { el: 10, sel: 'a#empty', rawHref: '', hash: '', samePage: false }, // empty
  { el: 11, sel: 'a#hash', rawHref: '#', hash: '', samePage: false }, // empty
  { el: 12, sel: 'a#js', rawHref: 'javascript:void(0)', hash: '', samePage: false }, // empty
  { el: 13, sel: 'a#anchor', rawHref: '#nowhere', hash: '#nowhere', samePage: true }, // dead anchor
  { el: 14, sel: 'a#good-anchor', rawHref: '#there', hash: '#there', samePage: true }, // fine (id present)
  { el: 15, sel: 'a#ext', rawHref: 'https://example.com', hash: '', samePage: false }, // fine (not fetched)
];
const ids = ['there', 'ok', 'hero'];

const r = classify({ images, links, ids });
assert.deepEqual(r.brokenImages.map(i => i.sel), ['img#hero', 'img.icon'], 'broken images');
assert.deepEqual(r.imagesNoAlt.map(i => i.sel), ['img#ok'], 'missing alt');
assert.deepEqual(r.deadLinks.map(i => i.sel), ['a#empty', 'a#hash', 'a#js', 'a#anchor'], 'dead links');
assert.equal(r.deadLinks.find(d => d.sel === 'a#anchor').reason, 'anchor');
assert.equal(r.deadLinks.find(d => d.sel === 'a#empty').reason, 'empty');
assert.deepEqual(r.counts, { images: 5, links: 6, brokenImages: 2, imagesNoAlt: 1, deadLinks: 4 });

// Nothing wrong → empty report.
const clean = classify({ images: [{ el: 1, sel: 'img', hasSrc: true, complete: true, naturalWidth: 10, hasAlt: true, srcShort: '/a.png' }], links: [{ el: 2, sel: 'a', rawHref: '/page', hash: '', samePage: false }], ids: [] });
assert.equal(clean.counts.brokenImages + clean.counts.imagesNoAlt + clean.counts.deadLinks, 0, 'clean page');

console.log('ok   broken: classify (broken images, missing alt, dead/empty/anchor links)');
