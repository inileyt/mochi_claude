/* Mochi Guides: steps and targets from an answer.   node test/guide-parse.test.js */
const assert = require('node:assert/strict');
const G = require('../src/tools/guide-parse.js');

// Targets.
assert.deepEqual(G.targetsOf('Click “Settings” in the top right.'), ['Settings']);
assert.deepEqual(G.targetsOf('Go to "Settings" → "Password and authentication".'), ['Settings', 'Password and authentication']);
assert.deepEqual(G.targetsOf('Open Settings → Security → Two-factor authentication'), ['Settings', 'Security', 'Two-factor authentication']);
assert.deepEqual(G.targetsOf('Click Save changes.'), ['Save changes']);
assert.deepEqual(G.targetsOf('Click the Enable button and scan the code'), ['Enable']);
assert.deepEqual(G.targetsOf('Press «Войти» внизу'), ['Войти']);
assert.deepEqual(G.targetsOf('Wait a few seconds.'), []);
assert.deepEqual(G.targetsOf('Choose the plan', { strong: ['Pro plan'], code: [] }), ['Pro plan']);
assert.equal(G.actionOf('Type your email into "Email"'), 'type');
assert.equal(G.actionOf('Go to https://github.com/settings'), 'navigate');
assert.equal(G.actionOf('Click "Save"'), 'click');

// From numbered lines in the text.
const text = `Here's how to turn on two-factor authentication on GitHub:

1. Go to https://github.com/settings/security
2. Click "Password and authentication" in the sidebar.
3. Under Two-factor authentication, click "Enable two-factor authentication".
4. Scan the QR code with your authenticator app.
5. Type the 6-digit code into "Verify the code from the app" and click "Continue".

That's it!`;
const g = G.parse({ text });
assert.equal(g.steps.length, 5);
assert.equal(g.startUrl, 'https://github.com/settings/security');
assert.equal(g.host, 'github.com');
assert.equal(g.title, "Here's how to turn on two-factor authentication on GitHub:");
assert.deepEqual(g.steps[1].targets, ['Password and authentication']);
assert.deepEqual(g.steps[2].targets, ['Enable two-factor authentication']);
assert.equal(g.steps[3].targets.length, 0);
assert.equal(g.steps[4].action, 'type');
assert.deepEqual(g.steps[4].targets, ['Verify the code from the app', 'Continue']);

// From the page's list items (bold/code count), links from the page, claude.ai links ignored.
const g2 = G.parse({ text: 'Do this:', items: [{ text: 'Open the dashboard', links: ['https://claude.ai/x'] }, { text: 'Click New project', strong: ['New project'] }, { text: 'Name it and press Create', code: ['Create'] }], links: ['https://example.app/dashboard'] });
assert.equal(g2.startUrl, 'https://example.app/dashboard');
assert.deepEqual(g2.steps[1].targets, ['New project']);
assert.ok(g2.steps[2].targets.includes('Create'));
// Not a guide.
assert.equal(G.parse({ text: '1. one\n2. two' }), null);
assert.equal(G.parse({ text: 'Just a paragraph.' }), null);

// The question for Claude, and files.
assert.match(G.prompt('turn on 2FA on GitHub', 'ru'), /^How do I turn on 2FA on GitHub\? .*\n- First give the full address[\s\S]*"double quotes"[\s\S]*Russian/);
const back = G.fromFile(G.toFile(g));
assert.deepEqual(back.steps.map(s => s.text), g.steps.map(s => s.text));
assert.equal(back.startUrl, g.startUrl);
assert.throws(() => G.fromFile('{"kind":"notes"}'), /not-a-guide/);
assert.equal(G.fromFile(JSON.stringify({ kind: 'guide', startUrl: 'javascript:alert(1)', steps: [{ text: 'a', url: 'javascript:x' }] })).startUrl, null, 'no javascript: urls from files');
console.log('ok   guide parsing: targets (quotes, paths, verbs, bold), numbered lines, page items, start url, prompt, files');
