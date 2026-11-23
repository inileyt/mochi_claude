/* Site notes: page and site keys from URLs.   node test/note-url.test.js */
const assert = require('node:assert/strict');
const U = require('../src/tools/note-url.js');
const n = u => U.normalize(u);
assert.deepEqual(n('https://www.Example.com/shop/?utm_source=x&b=2&a=1&fbclid=Z#top'), { page: 'https://example.com/shop?a=1&b=2', site: 'example.com' });
assert.equal(n('https://example.com/shop?gclid=1&utm_medium=mail').page, 'https://example.com/shop');
assert.equal(n('https://example.com/').page, 'https://example.com/');
assert.equal(n('https://example.com').page, 'https://example.com/');
assert.equal(n('http://127.0.0.1:8080/test/tools/notes.html?utm_campaign=a&id=7#x').page, 'http://127.0.0.1:8080/test/tools/notes.html?id=7');
assert.equal(n('http://127.0.0.1:8080/a').site, '127.0.0.1:8080');
assert.equal(n('https://a.com/p?ref=keep&spm=drop').page, 'https://a.com/p?ref=keep');
assert.equal(n('chrome://settings'), null);
assert.equal(n('not a url'), null);
assert.equal(U.keyOf('https://www.a.com/x#h', 'site'), 'site:a.com');
assert.equal(U.keyOf('https://www.a.com/x?utm_x=1#h'), 'page:https://a.com/x');
// The same page with and without tracking → the same key.
assert.equal(U.keyOf('https://news.site/story/42?utm_source=tw&fbclid=abc'), U.keyOf('https://news.site/story/42/'));
console.log('ok   note URLs: tracking params, hash, www, order, trailing slash, site keys');
