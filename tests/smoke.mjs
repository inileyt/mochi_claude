// Mochi smoke test: loads the unpacked extension in Chromium and checks that
// Mochi mounts, raises no console errors, and that the old and new behaviour
// works. Run from the repo root:
//
//   node tests/smoke.mjs            all groups
//   node tests/smoke.mjs base sync  only some groups
//
// Uses Playwright from dev/node_modules, or a globally installed one.
// Nothing here goes to the network: pages are served from this folder or
// answered by page.route().
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', '.out');
fs.mkdirSync(OUT, { recursive: true });

let chromium;
for (const from of [path.join(ROOT, 'dev', 'package.json'), import.meta.url]) {
  try { ({ chromium } = createRequire(from)('playwright')); break; } catch (_) { /* try the next */ }
}
if (!chromium) { console.error('Playwright not found: cd dev && npm install'); process.exit(2); }

// ——— a tiny static server for the repo (test pages and fixtures) ———
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ——— results ———
const results = [];
const check = async (name, fn) => {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    results.push({ name, ok: false, detail: err.message });
    console.log(`FAIL ${name} — ${err.message.split('\n')[0]}`);
  }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

// ——— browser helpers ———
/** A copy of the extension with extra manifest fields (e.g. host permissions the toolbar test needs). */
function extensionCopy(name, patch = m => m) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mochi-${name}-`));
  for (const item of ['manifest.json', 'src', 'icons', 'welcome.html', 'welcome']) {
    const from = path.join(ROOT, item);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(dir, item), { recursive: true });
  }
  const mf = path.join(dir, 'manifest.json');
  fs.writeFileSync(mf, JSON.stringify(patch(JSON.parse(fs.readFileSync(mf, 'utf8'))), null, 2));
  return dir;
}

/** A Chromium with the extension loaded; collects console errors per page. */
async function launch(ext = ROOT, { name = 'main', dark = false } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `mochi-profile-${name}-`));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 800 }, colorScheme: dark ? 'dark' : 'light',
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  ctx.errors = [];
  ctx.on('page', p => watchPage(ctx, p));
  for (const p of ctx.pages()) watchPage(ctx, p);
  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  ctx.sw = sw;
  return ctx;
}
function watchPage(ctx, p) {
  p.on('pageerror', e => ctx.errors.push(`pageerror ${p.url()}: ${e.message}`));
  p.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource|net::ERR_/.test(t)) return; // requests the test itself blocked
    ctx.errors.push(`console ${p.url()}: ${t}`);
  });
}
/** Pretend sites: https://<site>/… is answered with a local fixture file. */
async function routeSites(ctx, map) {
  await ctx.route('**/*', route => {
    const url = route.request().url();
    for (const [prefix, file] of Object.entries(map)) {
      if (url.startsWith(prefix)) return route.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(ROOT, file), 'utf8') });
    }
    if (url.startsWith(BASE) || url.startsWith('chrome') || url.startsWith('data:')) return route.continue();
    return route.abort();
  });
}

/** Mochi's shadow root is closed: reach into it through DevTools. */
async function shadow(page, selector, action = 'exists') {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const host = (await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'mochi-companion' })).nodeId;
    if (!host) return null;
    const desc = await cdp.send('DOM.describeNode', { nodeId: host, depth: 1, pierce: true });
    const sr = desc.node.shadowRoots?.[0];
    if (!sr) return null;
    const [sid] = (await cdp.send('DOM.pushNodesByBackendIdsToFrontend', { backendNodeIds: [sr.backendNodeId] })).nodeIds;
    const ids = (await cdp.send('DOM.querySelectorAll', { nodeId: sid, selector })).nodeIds;
    if (!ids.length) return null;
    if (action === 'exists') return true;
    if (action === 'text') return (await cdp.send('DOM.getOuterHTML', { nodeId: ids[0] })).outerHTML.replace(/<[^>]+>/g, '');
    if (action === 'html') return (await cdp.send('DOM.getOuterHTML', { nodeId: ids[0] })).outerHTML;
    if (action === 'box' || action === 'click') {
      await cdp.send('DOM.scrollIntoViewIfNeeded', { nodeId: ids[0] }).catch(() => {});
      const { model } = await cdp.send('DOM.getBoxModel', { nodeId: ids[0] });
      const [x1, y1, , , x3, y3] = model.border;
      const box = { x: (x1 + x3) / 2, y: (y1 + y3) / 2 };
      if (action === 'click') { await page.mouse.click(box.x, box.y); await page.waitForTimeout(250); }
      return box;
    }
  } finally { await cdp.detach().catch(() => {}); }
  return null;
}
const hostAttr = (page, name) => page.evaluate(n => document.querySelector('mochi-companion')?.getAttribute(n), name);
const debug = (page, detail) => page.evaluate(d => document.dispatchEvent(new CustomEvent('mochi:debug', { detail: d })), detail);
const until = async (fn, ms = 8000, step = 100) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, step)); } return v; };

// A claude.ai-like page for the real extension (no Mochi scripts in it: the extension injects them).
const CLAUDE_FIXTURE = 'tests/fixtures/claude.html';

// ——— groups ———
const groups = {};

groups.base = async () => {
  // 1) The local test page (Mochi's scripts are loaded by the page itself).
  const ctx = await launch(ROOT, { name: 'base' });
  try {
    const p = await ctx.newPage();
    await p.goto(`${BASE}/test/test-page.html`);
    await check('test page: Mochi mounts', async () => { assert(await until(() => p.evaluate(() => !!window.Mochi?.debug?.companion)), 'no Mochi'); return ''; });
    await check('test page: moods', async () => {
      await debug(p, { mood: 'happy' });
      const m = await until(() => p.evaluate(() => Mochi.debug.companion.el.dataset.mood === 'happy' && 'happy'));
      assert(m === 'happy', 'mood did not change');
      await debug(p, { mood: 'neutral' });
      return 'happy → neutral';
    });
    await check('test page: chat watcher reacts to a reply', async () => {
      await p.click('[data-send="Can you explain how a rainbow forms?"]');
      const thinking = await until(() => p.evaluate(() => ['curious', 'thinking'].includes(Mochi.debug.companion.mood) && Mochi.debug.companion.mood), 4000);
      assert(thinking, 'no reaction to the message');
      const after = await until(() => p.evaluate(() => Mochi.debug.engine.phase === 'reacting' || Mochi.debug.engine.phase === 'idle' ? Mochi.debug.engine.phase : ''), 15000);
      assert(after, 'no end-of-answer reaction');
      return `${thinking} → ${after}`;
    });
    await check('test page: dark theme', async () => {
      await p.click('#theme');
      const t = await until(() => p.evaluate(() => document.querySelector('mochi-companion')?.dataset.theme === 'dark' && 'dark'), 3000);
      assert(t === 'dark', `theme is ${await p.evaluate(() => document.querySelector('mochi-companion')?.dataset.theme)}`);
      await p.click('#theme');
      return 'light ↔ dark';
    });
    await check('test page: drag moves Mochi', async () => {
      const before = await p.evaluate(() => Mochi.debug.companion.root.getBoundingClientRect().left);
      const c = await p.evaluate(() => { const r = Mochi.debug.companion.el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await p.mouse.move(c.x, c.y); await p.mouse.down(); await p.mouse.move(c.x - 120, c.y - 40, { steps: 8 }); await p.mouse.up();
      await p.waitForTimeout(400);
      const after = await p.evaluate(() => Mochi.debug.companion.root.getBoundingClientRect().left);
      assert(after < before - 60, `left ${before} → ${after}`);
      await p.evaluate(() => Mochi.debug.companion.resetPosition());
      return `${Math.round(before)} → ${Math.round(after)} px`;
    });
    await p.close();

    // 2) The real extension on claude.ai (a local copy of the page shape).
    await routeSites(ctx, { 'https://claude.ai/': CLAUDE_FIXTURE });
    const c = await ctx.newPage();
    await c.goto('https://claude.ai/chat/smoke');
    await check('extension on claude.ai: Mochi mounts', async () => {
      assert(await until(() => c.evaluate(() => !!document.querySelector('mochi-companion'))), 'no mochi-companion');
      assert(await until(() => shadow(c, '.character')), 'no character in the shadow root');
      return '';
    });
    await check('extension on claude.ai: menu opens', async () => {
      await shadow(c, '.character', 'click');
      assert(await until(() => shadow(c, '.app:not([hidden])')), 'menu did not open');
      await c.keyboard.press('Escape');
      return '';
    });
    await check('extension on claude.ai: reacts to a reply', async () => {
      await c.evaluate(() => window.fixture.send('How do rainbows form?'));
      const mood = await until(async () => { const m = await hostAttr(c, 'data-mood'); return ['curious', 'thinking'].includes(m) && m; }, 5000);
      assert(mood, `mood stayed ${await hostAttr(c, 'data-mood')}`);
      return mood;
    });
    await check('extension: chrome:// pages get the × badge', async () => {
      const page = await ctx.newPage();
      await page.goto('chrome://version');
      const r = await ctx.sw.evaluate(async () => { const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); const res = await toggleIn(tab); return { res, badge: await chrome.action.getBadgeText({ tabId: tab.id }) }; });
      assert(r.res === 'blocked' && r.badge === '×', JSON.stringify(r));
      await page.close();
      return 'blocked, ×';
    });
    await check('no console errors (base)', async () => { assert(!ctx.errors.length, ctx.errors.join(' | ')); return ''; });
  } finally { await ctx.close(); }

  // 3) The toolbar button on another page. Headless tests can't click the
  //    toolbar, which is what grants activeTab, so this copy gets host access.
  const ext = extensionCopy('toolbar', m => ({ ...m, host_permissions: ['<all_urls>'] }));
  const t = await launch(ext, { name: 'toolbar' });
  try {
    await routeSites(t, { 'https://example.org/': 'tests/fixtures/plain.html' });
    const p = await t.newPage();
    await p.goto('https://example.org/');
    await check('toolbar: brings Mochi to another page, then hides it', async () => {
      const toggle = () => t.sw.evaluate(async () => { const [tab] = await chrome.tabs.query({ url: 'https://example.org/*' }); return toggleIn(tab); });
      const first = await toggle();
      assert(first === 'added', `first click: ${first}`);
      assert(await until(() => p.evaluate(() => !!document.querySelector('mochi-companion'))), 'not mounted');
      const second = await until(async () => { const r = await toggle(); return r === 'hidden' && r; }, 4000, 400);
      assert(second === 'hidden', `second click: ${second}`);
      return 'added → hidden';
    });
    await check('no console errors (toolbar)', async () => { assert(!t.errors.length, t.errors.join(' | ')); return ''; });
  } finally { await t.close(); fs.rmSync(ext, { recursive: true, force: true }); }
};

// ——— run ———
const wanted = process.argv.slice(2);
const order = Object.keys(groups).filter(g => !wanted.length || wanted.includes(g));
for (const g of order) {
  console.log(`\n# ${g}`);
  try { await groups[g](); } catch (err) { results.push({ name: `${g} (crashed)`, ok: false, detail: err.message }); console.log(`FAIL ${g} crashed — ${err.stack}`); }
}
server.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
fs.writeFileSync(path.join(OUT, 'last-run.json'), JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
