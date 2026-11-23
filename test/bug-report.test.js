/* Bug Reporter: the report.   node test/bug-report.test.js */
const assert = require('node:assert/strict');
const B = require('../src/tools/bug-report.js');
const events = [
  { kind: 'exception', text: 'TypeError: Cannot read properties of undefined (reading \'price\')\n    at total (app.js:12)', url: 'https://shop.example/app.js', line: 12 },
  { kind: 'console', level: 'error', text: 'Checkout failed: 500' },
  { kind: 'log', level: 'warning', text: 'Deprecated API' },
  { kind: 'http', status: 500, method: 'POST', url: 'https://shop.example/api/checkout' },
  { kind: 'failed', error: 'net::ERR_NAME_NOT_RESOLVED', method: 'GET', url: 'https://cdn.example/x.js' },
];
assert.deepEqual(B.summary(events), { errors: 2, warnings: 1, failed: 2 });
const md = B.markdown({
  title: 'Checkout button does nothing', expected: 'The order is placed.', actual: 'Nothing happens.',
  steps: [{ text: 'Click “Add to cart”' }, { text: 'Fill in “Coupon”' }, { text: 'Click “Checkout”' }],
  events, env: { url: 'https://shop.example/cart', title: 'Cart', ua: 'Chrome 140', viewport: '1280×800', dpr: 2, lang: 'en', time: Date.UTC(2026, 10, 23, 12, 30) },
  shots: [{ name: '01.jpg', step: 0 }, { name: '02.jpg', step: 2 }],
});
for (const want of ['# Checkout button does nothing', '1. Click “Add to cart” _(screenshot 01)_', '3. Click “Checkout” _(screenshot 02)_', '## Expected\nThe order is placed.', '(2 errors, 1 warnings, 2 failed requests)', '[uncaught] TypeError: Cannot read properties of undefined', '(https://shop.example/app.js:12)', '| 500 | POST | https://shop.example/api/checkout |', '| net::ERR_NAME_NOT_RESOLVED | GET |', 'screenshots/02.jpg — after step 3', '2026-11-23 12:30 UTC', 'never recorded']) assert.ok(md.includes(want), `report lacks: ${want}`);
assert.match(B.markdown({}), /^# Bug report\n[\s\S]*_\(no steps recorded\)_[\s\S]*Nothing went wrong/);
assert.ok(!B.markdown({ events: [{ kind: 'console', level: 'error', text: 'a ``` b' }] }).includes('a ``` b'), 'fences inside errors are broken up');
assert.match(B.forClaude('# X'), /^Please help me find the cause/);
console.log('ok   bug report: summary, steps with screenshots, console, failed requests, environment');
