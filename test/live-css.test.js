/* Live Edit: the CSS sanitizer, finding CSS in an answer, the question.   node test/live-css.test.js */
const assert = require('node:assert/strict');
const L = require('../src/tools/live-css.js');

// Safe CSS passes as it is.
const ok = '.card { font-size: 18px !important; background: linear-gradient(90deg, #fff, #eee); }\n@media (prefers-color-scheme: dark) { body { background: #111 } }';
assert.deepEqual(L.sanitize(ok), { css: ok, removed: [] });
// Nothing that loads from the web or runs code.
const bad = `@import url("https://evil.example/x.css");
@font-face { font-family: X; src: url(https://fonts.example/x.woff2); }
@font-face { font-family: Y; src: local("Inter"), url(data:font/woff2;base64,AAAA); }
.a { background: url('https://img.example/a.png') no-repeat; color: red; }
.b { background-image: url(data:image/png;base64,iVBOR); }
.c { width: expression(alert(1)); height: 2px; }
.d { -moz-binding: url(x.xml#a); behavior: url(a.htc); }
.e { background: url("javascript:alert(1)"); }
.f { background-image: image-set("https://x.example/a.png" 1x); }`;
const s = L.sanitize(bad);
assert.ok(!/https?:|expression|binding|behavior|javascript|@import/i.test(s.css), s.css);
assert.ok(s.css.includes('font-family: Y') && s.css.includes('data:font/woff2'), 'the data: font stays');
assert.ok(s.css.includes('url(data:image/png;base64,iVBOR)'), 'data: images stay');
assert.ok(/\.a \{ background: none no-repeat; color: red; \}/.test(s.css), s.css);
assert.ok(s.css.includes('height: 2px'), 'other declarations stay');
assert.ok(s.removed.includes('@import') && s.removed.some(r => /font-face/.test(r)) && s.removed.length >= 6, s.removed.join(' | '));
assert.equal(L.sanitize('a{b:c}'.repeat(20000)).css.length <= L.MAX, true);

// CSS in an answer.
const answer = 'Sure! Here you go:\n\n```css\n.card { padding: 24px; }\n```\n\nAnd for dark mode:\n```css\n@media (prefers-color-scheme: dark) { .card { background: #222 } }\n```\n```js\nconsole.log(1)\n```';
assert.equal(L.fromText(answer), '.card { padding: 24px; }\n\n@media (prefers-color-scheme: dark) { .card { background: #222 } }');
assert.equal(L.fromText('```\nh1 { color: red; }\n```'), 'h1 { color: red; }', 'an unlabelled block that looks like CSS');
assert.equal(L.fromText('```\nconst a = { b: 1 };\n```'), '', 'not CSS');
assert.equal(L.fromText('No code here.'), '');
assert.equal(L.fromBlocks([{ lang: 'html', text: '<p>' }, { lang: 'css', text: 'p{x:y}' }]), 'p{x:y}');

// The question: the wish, the element, one css block, the marker.
const q = L.question({ id: 'k1', wish: 'make the title bigger', url: 'https://a.example/', title: 'A', selector: '#hero h1', tag: 'h1', size: '600×48px', styles: 'font 32px/1.2 Inter 700, color #111', html: '<h1>Hello</h1>', lang: 'hy' });
for (const want of ['make the title bigger', '`#hero h1`', 'ONE ```css code block', '```html\n<h1>Hello</h1>\n```', 'Armenian', '[Mochi Live Edit #k1]']) assert.ok(q.includes(want), `question lacks ${want}`);
assert.ok(L.question({ id: 'k2', wish: 'x', selector: 'body', whole: true, current: 'body{a:b}' }).includes('```css\nbody{a:b}\n```'), 'the current CSS for a tweak');
console.log('ok   live css: sanitizer (imports, remote urls/fonts, scripts), CSS from answers, the question');
