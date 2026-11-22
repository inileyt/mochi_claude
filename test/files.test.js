/*
 * The extension loads the same files, in the same order, in two places:
 * manifest.json (claude.ai) and src/background.js (the toolbar button), and
 * the local test pages load them too. This checks they agree.
 *   node test/files.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const fromManifest = manifest.content_scripts[0].js;
const bg = fs.readFileSync(path.join(root, 'src/background.js'), 'utf8');
const fromBackground = [...bg.match(/const FILES = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);

assert.deepEqual(fromBackground, fromManifest, 'background.js FILES must match manifest.json content_scripts');
for (const f of fromManifest) assert.ok(fs.existsSync(path.join(root, f)), `missing file ${f}`);
for (const page of ['test/test-page.html', 'test/scan-fixtures.html', 'test/pick-fixtures.html']) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  const fromPage = [...html.matchAll(/<script src="\.\.\/([^"]+)"><\/script>/g)].map(m => m[1]);
  assert.deepEqual(fromPage, fromManifest, `${page} must load the same files in the same order`);
}
assert.equal(fromManifest.at(-1), 'src/content.js', 'content.js starts everything, so it loads last');
console.log(`ok   ${fromManifest.length} files agree across manifest, background and test pages`);
