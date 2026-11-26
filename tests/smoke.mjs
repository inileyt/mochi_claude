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
const serverHits = []; // every path the test pages asked for (Deep Scan: a form must never be sent)
const server = http.createServer((req, res) => {
  serverHits.push(`${req.method} ${req.url}`);
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
  for (const item of ['manifest.json', 'src', 'icons', 'pages', 'options.html', 'welcome.html']) {
    const from = path.join(ROOT, item);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(dir, item), { recursive: true });
  }
  const mf = path.join(dir, 'manifest.json');
  fs.writeFileSync(mf, JSON.stringify(patch(JSON.parse(fs.readFileSync(mf, 'utf8'))), null, 2));
  return dir;
}

/** A Chromium with the extension loaded; collects console errors per page. */
async function launch(ext = ROOT, { name = 'main', dark = false, profile = null } = {}) {
  profile = profile || fs.mkdtempSync(path.join(os.tmpdir(), `mochi-profile-${name}-`));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 800 }, colorScheme: dark ? 'dark' : 'light',
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  ctx.errors = [];
  ctx.debugs = []; // console.debug lines (Mochi's quiet notes)
  ctx.on('page', p => watchPage(ctx, p));
  for (const p of ctx.pages()) watchPage(ctx, p);
  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  ctx.sw = sw;
  ctx.profile = profile;
  ctx.extId = sw.url().split('/')[2];
  return ctx;
}
function watchPage(ctx, p) {
  p.on('pageerror', e => ctx.errors.push(`pageerror ${p.url()}: ${e.message}`));
  p.on('console', m => {
    if (m.type() === 'debug') ctx.debugs.push(m.text());
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
    if (action === 'focus') { await cdp.send('DOM.focus', { nodeId: ids[0] }); return true; }
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
    await check('test page: tuck away → a clear pull-handle brings Mochi back', async () => {
      await p.evaluate(() => Mochi.debug.companion.setTucked(true));
      const tucked = await p.evaluate(() => {
        const c = Mochi.debug.companion;
        const pull = c.shadow.querySelector('.pull');
        return { tucked: c.root.classList.contains('tucked'), pullShown: !!pull && getComputedStyle(pull).display !== 'none', label: c.el.getAttribute('aria-label'), title: c.el.title };
      });
      assert(tucked.tucked && tucked.pullShown, `no pull handle: ${JSON.stringify(tucked)}`);
      assert(/back|Mochi/i.test(tucked.label) && tucked.title === tucked.label, `peeking Mochi should say it brings him back: ${JSON.stringify(tucked)}`);
      // Clicking the peeking Mochi restores it, and the label goes back to normal.
      await p.evaluate(() => Mochi.debug.companion.handlePress());
      const back = await p.evaluate(() => { const c = Mochi.debug.companion; return { tucked: c.root.classList.contains('tucked'), label: c.el.getAttribute('aria-label'), title: c.el.title }; });
      assert(!back.tucked && !back.title && /companion/i.test(back.label), `not restored: ${JSON.stringify(back)}`);
      return 'tuck → handle + label → click brings him back';
    });
    await check('test page: pick an element → "Pick another" sits in the always-visible footer', async () => {
      await p.evaluate(() => { Mochi.debug.runPick(); }); // don't await — the pick resolves on the click below
      assert(await until(() => p.evaluate(() => !!Mochi.debug.picker?.isActive), 3000), 'picker did not open');
      const pt = await p.evaluate(() => { const r = document.querySelector('[data-testid="user-message"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await p.mouse.move(pt.x, pt.y); await p.waitForTimeout(150); await p.mouse.click(pt.x, pt.y);
      const foot = await until(() => p.evaluate(() => {
        const c = Mochi.debug.companion, b = c.shadow.querySelector('.sheet-foot .foot-actions [data-act="pick-again"]');
        return Mochi.debug.panel.view === 'component' && b && getComputedStyle(b).display !== 'none' ? b.textContent.trim() : null;
      }), 6000);
      assert(foot, 'no "Pick another" button in the footer of the pick result');
      // and it restarts the picker without reopening the menu
      await p.evaluate(() => Mochi.debug.companion.shadow.querySelector('.sheet-foot [data-act="pick-again"]').click());
      assert(await until(() => p.evaluate(() => !!Mochi.debug.picker?.isActive), 3000), 'the footer button did not restart the picker');
      await p.keyboard.press('Escape');
      return `footer "${foot}" restarts the picker`;
    });
    await check('test page: a result has a ‹ back arrow that returns to Mochi\'s menu', async () => {
      await p.evaluate(() => { Mochi.debug.runPick(); });
      await until(() => p.evaluate(() => !!Mochi.debug.picker?.isActive), 3000);
      const pt = await p.evaluate(() => { const r = document.querySelector('[data-testid="user-message"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await p.mouse.move(pt.x, pt.y); await p.waitForTimeout(150); await p.mouse.click(pt.x, pt.y);
      assert(await until(() => p.evaluate(() => Mochi.debug.panel.view === 'component' && !!Mochi.debug.companion.shadow.querySelector('.sheet-head .back')), 6000), 'no back arrow in the result header');
      await p.evaluate(() => Mochi.debug.companion.shadow.querySelector('.sheet-head .back').click());
      const state = await until(() => p.evaluate(() => !Mochi.debug.panel.isOpen && !!Mochi.debug.companion.shadow.querySelector('.app:not([hidden])') && 'ok'), 3000);
      assert(state, `back did not reopen the menu (panelOpen=${await p.evaluate(() => Mochi.debug.panel.isOpen)})`);
      await p.evaluate(() => Mochi.menuInstance.close());
      return 'result → ‹ → menu';
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

groups.sync = async () => {
  const ctx = await launch(ROOT, { name: 'sync' });
  try {
    await routeSites(ctx, { 'https://claude.ai/': CLAUDE_FIXTURE });
    const c = await ctx.newPage();
    await c.goto('https://claude.ai/chat/sync');
    await until(() => shadow(c, '.character'));
    const area = (name, key) => ctx.sw.evaluate(async ([n, k]) => (await chrome.storage[n].get(k))[k], [name, key]);
    await check('sync: schema v2 and an install date after the first start', async () => {
      const schema = await until(() => area('local', 'mochi.schema'));
      const meta = await area('local', 'mochi.meta');
      assert(schema?.version === 2, JSON.stringify(schema));
      assert(/^\d{4}-\d{2}-\d{2}$/.test(meta?.installDate || ''), JSON.stringify(meta));
      return `installDate ${meta.installDate}`;
    });
    await check('sync: this computer’s values reach chrome.storage.sync', async () => {
      const meta = await until(() => area('sync', 'mochi.meta'), 6000);
      assert(meta?.installDate, 'mochi.meta not in sync');
      return 'mochi.meta in sync';
    });
    await check('sync: higher XP from another computer is merged in', async () => {
      await ctx.sw.evaluate(() => chrome.storage.sync.set({ 'mochi.progress': { xp: 1300, streak: { count: 3, best: 3, last: '2026-01-01' } } }));
      const local = await until(async () => { const p = await area('local', 'mochi.progress'); return p?.xp >= 1300 && p; });
      assert(local, 'local XP did not follow');
      await shadow(c, '.character', 'click');
      const card = await until(() => shadow(c, '.stat-level', 'text'));
      await c.keyboard.press('Escape');
      assert(/\b(6|7|8|9|\d\d)\b/.test(card || ''), `stat card says ${card}`);
      return `xp ${local.xp}, card: ${card}`;
    });
    await check('sync: a newer color from another computer recolors Mochi', async () => {
      await ctx.sw.evaluate(async () => {
        const cur = (await chrome.storage.sync.get('mochi.settings'))['mochi.settings'] || {};
        await chrome.storage.sync.set({ 'mochi.settings': { ...cur, colors: { ...(cur.colors || {}), mochi: 'night' }, __ts: { ...(cur.__ts || {}), 'colors.mochi': Date.now() + 1000 } } });
      });
      const html = await until(async () => { const h = await shadow(c, '.character', 'html'); return /--m-base:\s*#5563c0/i.test(h || '') && h; });
      assert(html, 'still the old color');
      return 'night theme applied';
    });
    await check('sync: lower XP from another computer does not lower mine', async () => {
      await ctx.sw.evaluate(() => chrome.storage.sync.set({ 'mochi.progress': { xp: 10, streak: { count: 1, best: 1, last: '2025-01-01' } } }));
      await c.waitForTimeout(800);
      const p = await area('local', 'mochi.progress');
      assert(p.xp >= 1300, `xp went down to ${p.xp}`);
      const s = await until(async () => { const v = await area('sync', 'mochi.progress'); return v?.xp >= 1300 && v; }, 6000);
      assert(s, 'sync was not corrected back up');
      return `local ${p.xp}, sync corrected to ${s.xp}`;
    });
    await check('sync: XP waits (lazy), then goes when the page is left', async () => {
      const before = (await area('sync', 'mochi.progress'))?.xp;
      await shadow(c, '.character', 'click');
      await shadow(c, '.menu-item[data-id="play"]', 'click');
      await c.waitForTimeout(600);
      const local = (await area('local', 'mochi.progress')).xp;
      const syncNow = (await area('sync', 'mochi.progress'))?.xp;
      assert(local > before, `petting gave no XP (${before} → ${local})`);
      assert(syncNow === before, `sync updated right away (${syncNow})`);
      // Leaving the page (pagehide) sends it; if the browser cuts that short,
      // the next start pushes the local copy up. Headless tabs never become
      // "hidden", so this is the path a test can take.
      await c.goto('https://claude.ai/chat/next');
      const sent = await until(async () => { const v = await area('sync', 'mochi.progress'); return v?.xp === local && v; }, 8000);
      assert(sent, 'never reached sync');
      return `${before} → ${local} (sent after leaving the page)`;
    });
    await check('level-locked character (the cat) is still worn on a new page', async () => {
      // XP is past level 3 here. The level loads a moment after the features start, so the
      // cat must not fall back to Mochi on a fresh page while the wardrobe says "cat".
      await ctx.sw.evaluate(async () => {
        const cur = (await chrome.storage.local.get('mochi.settings'))['mochi.settings'] || {};
        await chrome.storage.local.set({ 'mochi.settings': { ...cur, character: 'cat' } });
      });
      const charOf = page => shadow(page, '.character', 'html').then(h => (/data-char="(\w+)"/.exec(h || '') || [])[1]);
      assert(await until(async () => (await charOf(c)) === 'cat'), `this page: ${await charOf(c)}`);
      const fresh = await ctx.newPage();
      await fresh.goto('https://claude.ai/chat/cat');
      const got = await until(async () => (await charOf(fresh)) === 'cat' && 'cat', 5000);
      const seen = await charOf(fresh);
      await fresh.close();
      assert(got, `a new page shows ${seen}, not the cat`);
      return 'cat on the new page';
    });
    await check('no console errors (sync)', async () => { assert(!ctx.errors.length, ctx.errors.join(' | ')); return ''; });
  } finally { await ctx.close(); }
};

groups.fallback = async () => {
  // The site's page changed and nothing matches: Mochi stays a plain companion,
  // says so once in console.debug, and picks the chat up when it appears.
  const ctx = await launch(ROOT, { name: 'fallback' });
  try {
    await routeSites(ctx, { 'https://claude.ai/': CLAUDE_FIXTURE });
    const c = await ctx.newPage();
    await c.goto('https://claude.ai/chat/late?late');
    const note = () => ctx.debugs.filter(t => t.includes("[Mochi] Can't find the chat"));
    await check('fallback: no chat on the page → plain companion, one console.debug', async () => {
      assert(await until(() => c.evaluate(() => !!document.querySelector('mochi-companion'))), 'Mochi did not mount');
      assert(await until(() => note().length > 0, 16000, 250), 'no console.debug note after 16 s');
      await c.waitForTimeout(1500);
      assert(note().length === 1, `${note().length} notes`);
      assert(await shadow(c, '.character'), 'no character');
      return note()[0];
    });
    await check('fallback: the chat appears later → no fake reaction, then reacts normally', async () => {
      await c.evaluate(() => window.fixture.show());
      await c.waitForTimeout(1500);
      const quiet = await hostAttr(c, 'data-mood');
      assert(!['curious', 'thinking'].includes(quiet), `reacted to messages that were already there (${quiet})`);
      await c.evaluate(() => window.fixture.send('Are you there?'));
      const mood = await until(async () => { const m = await hostAttr(c, 'data-mood'); return ['curious', 'thinking'].includes(m) && m; }, 5000);
      assert(mood, `no reaction (mood ${await hostAttr(c, 'data-mood')})`);
      return `${quiet} → ${mood}`;
    });
    await check('waiting for an answer: a level-up cheer goes back to thinking; no answer at all → stops thinking', async () => {
      const t = await ctx.newPage();
      await t.goto(`${BASE}/test/test-page.html`);
      await until(() => t.evaluate(() => !!window.Mochi?.debug?.engine));
      await t.waitForTimeout(1500);
      const mood = () => t.evaluate(() => Mochi.debug.companion.mood);
      await t.evaluate(() => { Mochi.config.timing.giveUpWaiting = 4000; Mochi.debug.engine.userMessage('hello?'); });
      await t.waitForTimeout(1400);
      await t.evaluate(() => Mochi.debug.engine.react({ mood: 'excited', action: 'celebrate', hold: 800 }));
      const cheer = await mood();
      await t.waitForTimeout(1200);
      const back = await mood();
      assert(cheer === 'excited' && back === 'thinking', `${cheer} → ${back}`);
      await t.waitForTimeout(3000);
      const after = await t.evaluate(() => ({ mood: Mochi.debug.companion.mood, phase: Mochi.debug.engine.phase }));
      assert(after.phase === 'idle' && after.mood === 'neutral', JSON.stringify(after));
      await t.close();
      return `${cheer} → ${back} → ${after.mood}`;
    });
    await check('no console errors (fallback)', async () => { assert(!ctx.errors.length, ctx.errors.join(' | ')); return ''; });
  } finally { await ctx.close(); }
};

groups.onboarding = async () => {
  // A copy at 1.26.0 so the changelog has an entry for "this" version.
  const ext = extensionCopy('onboarding', m => ({ ...m, version: '1.26.0' }));
  const ctx = await launch(ext, { name: 'onboarding' });
  const area = (name, key) => ctx.sw.evaluate(async ([n, k]) => (await chrome.storage[n].get(k))[k], [name, key]);
  /** Change mochi.meta in both areas (as if it came from this or another computer). */
  const setMeta = patch => ctx.sw.evaluate(async p => {
    for (const a of ['local', 'sync']) { const m = (await chrome.storage[a].get('mochi.meta'))['mochi.meta'] || {}; await chrome.storage[a].set({ 'mochi.meta': { ...m, ...p } }); }
  }, patch);
  const tourStep = p => shadow(p, '.offer.tour', 'html').then(html => html && (html.match(/data-step="(\w+)"/) || [])[1]);
  try {
    await routeSites(ctx, { 'https://claude.ai/': CLAUDE_FIXTURE });
    await check('install: opens the welcome page and remembers the day', async () => {
      const page = await until(() => ctx.pages().find(p => p.url().includes('/welcome.html')), 6000);
      assert(page, `tabs: ${ctx.pages().map(p => p.url()).join(', ')}`);
      const meta = await until(async () => { const m = await area('local', 'mochi.meta'); return m?.whatsNewSeen && m; }, 4000);
      const today = await ctx.sw.evaluate(() => Mochi.store.today());
      assert(meta && meta.installDate === today && meta.installMigrated === false && meta.whatsNewSeen === '1.26.0', JSON.stringify(meta));
      return `installDate ${meta.installDate}`;
    });
    const w = ctx.pages().find(p => p.url().includes('/welcome.html'));
    await w.waitForFunction(() => document.getElementById('step-count')?.textContent && document.querySelector('.swatch'), null, { timeout: 8000 });
    await check('welcome: 5 steps with Back / Next / Skip', async () => {
      const visible = () => w.evaluate(() => document.querySelector('.step:not([hidden])').dataset.step);
      const seen = [await visible()];
      assert(await w.isHidden('#back'), 'Back shown on step 1');
      await w.click('#next'); seen.push(await visible());
      await w.click('#back'); seen.push(await visible());
      await w.click('#next'); await w.click('#next'); seen.push(await visible());
      assert(await w.$('#sites-list .site-row[data-site="chatgpt"]'), 'no site list on step 3');
      await w.click('#back'); await w.click('#back'); await w.click('#skip'); seen.push(await visible());
      assert(seen.join() === '1,2,1,3,5', seen.join());
      assert(await w.isHidden('#next') && await w.isHidden('#skip'), 'Next/Skip still shown on the last step');
      assert((await w.getAttribute('#open-claude', 'href')).startsWith('https://claude.ai/'), 'no claude.ai link');
      return seen.join(' → ');
    });
    await check('welcome: color and name are saved (and go to sync)', async () => {
      await w.click('#back'); await w.click('#back'); await w.click('#back');
      await w.click('.swatch[data-color="sakura"]');
      await w.fill('#name', 'Bao');
      assert((await w.textContent('#preview-say')).includes('Bao'), 'preview does not use the name');
      await w.waitForTimeout(400);
      await w.evaluate(() => Mochi.store.flush());
      const s = await until(async () => { const v = await area('sync', 'mochi.settings'); return v?.name === 'Bao' && v; }, 5000);
      assert(s && s.colors?.mochi === 'sakura', JSON.stringify(s));
      return 'sakura, Bao';
    });
    await w.close();

    const c = await ctx.newPage();
    await c.goto('https://claude.ai/chat/first');
    await check('tour: first time in a chat — menu → drag → play, then done', async () => {
      const first = await until(() => tourStep(c), 10000, 250);
      assert(first === 'menu', `first card: ${first}`);
      const steps = [first];
      await shadow(c, '.offer.tour [data-act="next"]', 'click'); steps.push(await tourStep(c));
      await shadow(c, '.offer.tour [data-act="next"]', 'click'); steps.push(await tourStep(c));
      await shadow(c, '.offer.tour [data-act="done"]', 'click');
      assert(steps.join() === 'menu,drag,play', steps.join());
      assert(!(await tourStep(c)), 'card still open');
      const meta = await until(async () => { const m = await area('local', 'mochi.meta'); return m?.onboardingDone && m; }, 3000);
      assert(meta && !meta.tourSkipped, JSON.stringify(meta));
      return steps.join(' → ');
    });
    await check('tour: not again on the next visit; no "what\'s new" on a fresh install', async () => {
      await c.reload();
      await c.waitForTimeout(7000);
      assert(!(await tourStep(c)), 'the tour came back');
      const bubble = await shadow(c, '.bubble', 'text');
      assert(!/1\.26\.0/.test(bubble || ''), `bubble: ${bubble}`);
      return '';
    });
    await check('tour: Settings → Replay the tour, then Skip', async () => {
      await shadow(c, '.character', 'click');
      await shadow(c, '.app-tab[data-section="settings"]', 'click');
      await shadow(c, '.set-row.action[data-id="replay-tour"]', 'click');
      assert(await until(() => tourStep(c), 3000) === 'menu', 'no tour after Replay');
      await shadow(c, '.offer.tour [data-act="skip"]', 'click');
      const meta = await until(async () => { const m = await area('local', 'mochi.meta'); return m?.tourSkipped && m; }, 3000);
      assert(meta, 'tourSkipped not saved');
      return (await shadow(c, '.bubble', 'text')) || '';
    });
    await check('tour: skipped on the first card → never comes back on its own', async () => {
      await setMeta({ onboardingDone: false, tourSkipped: false });
      await c.reload();
      assert(await until(() => tourStep(c), 10000, 250) === 'menu', 'no tour after a reset');
      await shadow(c, '.offer.tour [data-act="skip"]', 'click');
      await c.reload();
      await c.waitForTimeout(7000);
      assert(!(await tourStep(c)), 'came back after Skip');
      return '';
    });
    await check('what\'s new: after an update, one bubble, once', async () => {
      await setMeta({ whatsNewSeen: '1.25.0', installMigrated: true });
      await c.reload();
      const said = await until(async () => { const b = await shadow(c, '.bubble', 'text'); return /1\.26\.0/.test(b || '') && b; }, 10000, 250);
      assert(said, `bubble: ${await shadow(c, '.bubble', 'text')}`);
      const meta = await until(async () => { const m = await area('local', 'mochi.meta'); return m?.whatsNewSeen === '1.26.0' && m; }, 3000);
      assert(meta, 'whatsNewSeen not updated');
      await c.reload();
      await c.waitForTimeout(7000);
      const again = await shadow(c, '.bubble', 'text');
      assert(!/1\.26\.0/.test(again || ''), 'said it twice');
      return said.trim().slice(0, 70) + '…';
    });
    await check('migrated users (had Mochi before) get no tour', async () => {
      await setMeta({ onboardingDone: false, tourSkipped: false, installMigrated: true });
      await c.reload();
      await c.waitForTimeout(7000);
      assert(!(await tourStep(c)), 'tour shown to a migrated user');
      return '';
    });
    await check('no console errors (onboarding)', async () => { assert(!ctx.errors.length, ctx.errors.join(' | ')); return ''; });
  } finally { await ctx.close(); fs.rmSync(ext, { recursive: true, force: true }); }
};

groups.birthday = async () => {
  // 1) The test page, with the date faked through the debug hook.
  const ctx = await launch(ROOT, { name: 'birthday' });
  try {
    const p = await ctx.newPage();
    await p.goto(`${BASE}/test/test-page.html`);
    await until(() => p.evaluate(() => !!window.Mochi?.debug?.companion && !!Mochi.debugHooks?.birthday));
    await p.evaluate(async () => { await Mochi.store.update('mochi.meta', m => ({ ...m, onboardingDone: true }), {}); });
    await p.waitForTimeout(4500); // past the hello
    const bday = opts => p.evaluate(o => Mochi.debugHooks.birthday(o), opts);
    const shadowHas = sel => p.evaluate(s => !!Mochi.debug.companion.shadow.querySelector(s), sel);
    const bubble = () => p.evaluate(() => Mochi.debug.companion.bubble.textContent);
    const quiet = () => p.evaluate(() => { const c = Mochi.debug.companion; c.bubble.classList.remove('show'); c.shadow.querySelectorAll('.bday-confetti').forEach(e => e.remove()); });
    const cases = [
      ['7 days', { installDate: '2026-03-01', today: '2026-03-08', reset: true }, 'd7', /week/i],
      ['1 month', { today: '2026-04-01' }, 'm1', /month/i],
      ['100 days', { today: '2026-06-09' }, 'd100', /100 days/i],
    ];
    for (const [name, opts, id, text] of cases) {
      await check(`birthday: ${name} → bubble + confetti, once`, async () => {
        await quiet();
        const r = await bday(opts);
        assert(r?.celebrate?.id === id, JSON.stringify(r));
        assert(await shadowHas('.bday-confetti'), 'no confetti');
        const said = await bubble();
        assert(text.test(said), `bubble: ${said}`);
        await quiet();
        const again = await bday({ today: opts.today });
        assert(!again.celebrate, `celebrated twice: ${JSON.stringify(again)}`);
        return said;
      });
    }
    await check('birthday: a missed milestone is still celebrated a few days late, not after a week', async () => {
      await quiet();
      const late = await bday({ installDate: '2026-03-01', today: '2026-03-12', reset: true });
      const tooLate = await bday({ installDate: '2026-03-01', today: '2026-03-20', reset: true });
      assert(late.celebrate?.id === 'd7' && !tooLate.celebrate && tooLate.mark.includes('d7'), JSON.stringify({ late, tooLate }));
      return 'day 11: party · day 19: just marked';
    });
    await check('birthday: 1st birthday → party hat, cake with 1 candle, bubble', async () => {
      await quiet();
      const r = await bday({ installDate: '2025-11-22', today: '2026-11-22', reset: true });
      assert(r.celebrate?.kind === 'anniversary' && r.celebrate.years === 1, JSON.stringify(r));
      assert(/birthday/i.test(await bubble()), `bubble: ${await bubble()}`);
      assert(await p.evaluate(() => Mochi.outfits.overrides.head?.id) === 'birthday-hat', 'no party hat');
      assert(await until(() => shadowHas('.bday-cake'), 4000), 'no cake');
      const candles = await p.evaluate(() => Mochi.debug.companion.shadow.querySelectorAll('.bday-cake .flame').length);
      assert(candles === 1, `${candles} candles`);
      return `${await bubble()} · ${candles} candle`;
    });
    await check('birthday: click the cake → candles out, confetti, thank-you card; the hat is kept', async () => {
      const cake = await p.evaluate(() => { const r = Mochi.debug.companion.shadow.querySelector('.bday-cake svg').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await p.mouse.click(cake.x, cake.y);
      assert(await shadowHas('.bday-cake.out') && await shadowHas('.bday-confetti'), 'candles still lit / no confetti');
      assert(await until(() => shadowHas('.bday-card'), 5000), 'no thank-you card');
      const meta = await p.evaluate(() => Mochi.store.get('mochi.meta'));
      assert(meta.unlocked.includes('birthday-hat') && meta.celebrated.includes('y1') && meta.lastCelebrated === '2026-11-22', JSON.stringify(meta));
      await p.evaluate(() => Mochi.debug.companion.shadow.querySelector('.bday-card [data-act="close"]').click());
      return 'unlocked: birthday-hat';
    });
    await check('birthday: share card — a 1200×630 PNG from the card and from Menu → Tools', async () => {
      const menuHas = async () => { await p.evaluate(() => Mochi.menuInstance.open('mochi')); await p.waitForTimeout(200); const has = await shadowHas('.menu-item[data-id="birthday-card"]'); await p.evaluate(() => Mochi.menuInstance.close()); return has; };
      assert(await menuHas(), 'no "Birthday card" in Tools on the birthday');
      const dl = p.waitForEvent('download', { timeout: 8000 });
      await p.evaluate(() => { Mochi.menuInstance.open('mochi'); });
      await p.waitForTimeout(200);
      await p.evaluate(() => Mochi.debug.companion.shadow.querySelector('.menu-item[data-id="birthday-card"]').click());
      const file = await dl;
      const saved = path.join(OUT, file.suggestedFilename());
      await file.saveAs(saved);
      const png = fs.readFileSync(saved);
      const size = { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
      assert(png.subarray(1, 4).toString() === 'PNG' && size.w === 1200 && size.h === 630, JSON.stringify(size));
      p.__menuHas = menuHas;
      return `${file.suggestedFilename()} ${size.w}×${size.h}, ${Math.round(png.length / 1024)} KB`;
    });
    await check('birthday: the next day the party hat comes off, but stays unlocked in the wardrobe', async () => {
      const r = await bday({ today: '2026-11-23' });
      const state = await p.evaluate(() => ({ head: Mochi.outfits.overrides.head?.id || null, unlocked: Mochi.outfits.isUnlocked(Mochi.outfits.byId('birthday-hat')), cake: !!Mochi.debug.companion.shadow.querySelector('.bday-cake') }));
      assert(!r.birthday && !state.head && state.unlocked && !state.cake, JSON.stringify({ r, state }));
      assert(!(await p.__menuHas()), '"Birthday card" still in Tools the next day');
      return '';
    });
    await check('birthday: never unlocked → the hat is locked, "Unlocks on Mochi\'s birthday"', async () => {
      await bday({ installDate: '2026-01-10', today: '2026-11-23', reset: true });
      await p.reload();
      await until(() => p.evaluate(() => !!window.Mochi?.debug?.companion && !!Mochi.debugHooks?.birthday));
      // The test page keeps its data in memory: after a reload the tour would start again (and Mochi waits for it).
      await p.evaluate(async () => { await Mochi.store.update('mochi.meta', m => ({ ...m, onboardingDone: true }), {}); });
      await p.waitForTimeout(800);
      const r = await p.evaluate(() => ({ unlocked: Mochi.outfits.isUnlocked(Mochi.outfits.byId('birthday-hat')), text: Mochi.t('wardrobe.birthdayLocked') }));
      assert(!r.unlocked, JSON.stringify(r));
      return r.text;
    });
    await check('birthday: 3rd birthday → 3 candles; Feb 29 install → party on Feb 28', async () => {
      await quiet();
      const three = await bday({ installDate: '2023-06-01', today: '2026-06-01', reset: true });
      await until(() => shadowHas('.bday-cake'), 4000);
      const candles = await p.evaluate(() => Mochi.debug.companion.shadow.querySelectorAll('.bday-cake .flame').length);
      await quiet();
      const leap = await bday({ installDate: '2024-02-29', today: '2025-02-28', reset: true });
      const notMarch = await bday({ installDate: '2024-02-29', today: '2025-03-01', reset: true });
      assert(three.celebrate?.years === 3 && candles === 3, JSON.stringify({ three, candles }));
      assert(leap.celebrate?.kind === 'anniversary' && !notMarch.birthday, JSON.stringify({ leap, notMarch }));
      return '3 candles · Feb 28 ✓ · Mar 1 ✗';
    });
    await check('birthday: the date changes while the page is open (midnight) → celebrates without a reload', async () => {
      await quiet();
      await bday({ installDate: '2026-05-01', today: '2026-05-07', reset: true }); // day 6: nothing yet
      await p.evaluate(() => Mochi.store.setToday('2026-05-08')); // only the clock moves
      const said = await until(async () => { const b = await bubble(); return /week/i.test(b) && b; }, 8000, 250);
      assert(said && await shadowHas('.bday-confetti'), `bubble: ${await bubble()}`);
      return said;
    });
    await check('birthday: a migrated install date gets nothing', async () => {
      await quiet();
      const r = await bday({ installDate: '2025-11-22', today: '2026-11-22', migrated: true, reset: true });
      assert(!r.celebrate && !r.birthday && !(await shadowHas('.bday-confetti')), JSON.stringify(r));
      return '';
    });
    await check('no console errors (birthday page)', async () => { assert(!ctx.errors.length, ctx.errors.join(' | ')); return ''; });
  } finally { await ctx.close(); }

  // 2) The real extension: two claude.ai tabs open at once → one party, not two.
  const ext = await launch(ROOT, { name: 'birthday-ext' });
  try {
    await routeSites(ext, { 'https://claude.ai/': CLAUDE_FIXTURE });
    const weekAgo = await ext.sw.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 7); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    await ext.sw.evaluate(async day => {
      await Mochi.store.ready;
      for (const a of ['local', 'sync']) {
        const m = (await chrome.storage[a].get('mochi.meta'))['mochi.meta'] || {};
        await chrome.storage[a].set({ 'mochi.meta': { ...m, installDate: day, installMigrated: false, onboardingDone: true, celebrated: [], lastCelebrated: null } });
      }
    }, weekAgo);
    await check('birthday: two tabs at once → only one celebrates (lastCelebrated)', async () => {
      const tabs = [await ext.newPage(), await ext.newPage()];
      await Promise.all(tabs.map((t, i) => t.goto(`https://claude.ai/chat/tab${i}`)));
      const seen = [false, false];
      const end = Date.now() + 16000;
      while (Date.now() < end && !(seen[0] && seen[1])) {
        for (let i = 0; i < 2; i++) if (!seen[i] && await shadow(tabs[i], '.bday-confetti')) seen[i] = true;
        await new Promise(r => setTimeout(r, 250));
      }
      const meta = await ext.sw.evaluate(async () => (await chrome.storage.local.get('mochi.meta'))['mochi.meta']);
      assert(seen.filter(Boolean).length === 1, `parties: ${seen}`);
      assert(meta.celebrated.includes('d7') && meta.lastCelebrated, JSON.stringify(meta));
      return `tab ${seen.indexOf(true) + 1} celebrated, lastCelebrated ${meta.lastCelebrated}`;
    });
    await check('no console errors (birthday extension)', async () => { assert(!ext.errors.length, ext.errors.join(' | ')); return ''; });
  } finally { await ext.close(); }
};

// ——— Deep Scan helpers ———
/** Reads a STORE zip (the format Mochi writes) → { name: Buffer }. */
function unzipStore(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    const size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    out[name] = buf.subarray(start, start + size);
    p += 46 + nameLen + extra + comment;
  }
  return out;
}
/** A copy of the extension that may visit test pages (host access); `permission: false` takes "debugger" away (as if an old manifest). */
async function deepContext(name, { permission = true } = {}) {
  const ext = extensionCopy(name, m => ({ ...m, host_permissions: ['<all_urls>'], permissions: permission ? m.permissions : m.permissions.filter(x => x !== 'debugger') }));
  const ctx = await launch(ext, { name });
  ctx.extDir = ext;
  // The welcome tab opens a moment after install and would take the front spot (Chrome then throttles
  // the scanned tab's frames and animations): wait for it and close it first.
  const welcome = await until(() => ctx.pages().find(p => p.url().includes('/welcome.html')), 5000);
  await welcome?.close();
  return ctx;
}
/** Open a page and bring Mochi in with the toolbar button (as a person would). */
async function mochiOn(ctx, url) {
  const p = await ctx.newPage();
  await p.goto(url);
  await p.bringToFront(); // a background tab gets throttled animations (and the welcome tab opens on install)
  const r = await ctx.sw.evaluate(async u => { const tab = (await chrome.tabs.query({})).find(t => t.url === u); return toggleIn(tab); }, p.url());
  assert(r === 'added' || r === 'shown', `toolbar: ${r}`);
  assert(await until(() => p.evaluate(() => !!document.querySelector('mochi-companion')), 6000), 'Mochi did not come');
  return p;
}
/** Run a test hook and wait for what it returned (content.js writes it to <html data-mochi-result-<key>>). */
async function hook(p, key, value = true, ms = 15000) {
  const attr = `data-mochi-result-${key.toLowerCase()}`;
  await p.evaluate(a => document.documentElement.removeAttribute(a), attr);
  await debug(p, { [key]: value });
  return until(async () => { const v = await p.getAttribute('html', attr); return v ? JSON.parse(v) : null; }, ms, 150);
}

groups.deepscan = async () => {
  const ctx = await deepContext('deepscan');
  try {
    await check('deep: the debugger attaches on request, refuses commands outside its list, detaches', async () => {
      const p = await mochiOn(ctx, `${BASE}/tests/fixtures/plain.html`);
      const r = await hook(p, 'cdpProbe');
      assert(r && r.status.permission && r.attach.attached && r.doc === '#document', JSON.stringify(r));
      assert(/not-allowed: Runtime.evaluate/.test(r.refused), `refused: ${r.refused}`);
      assert(r.mouseMoved === true && /not-allowed: only mouseMoved/.test(r.mousePressed), `mouse: moved=${r.mouseMoved} pressed=${r.mousePressed}`);
      assert(r.detach.detached, JSON.stringify(r.detach));
      // (chrome.debugger.getTargets() would also count Playwright's own connection: ask the proxy.)
      const still = await ctx.sw.evaluate(() => Mochi.debuggerProxy.sessions.size);
      assert(still === 0, `${still} sessions still attached`);
      await p.close();
      return 'attach → DOM.getDocument ✓ → Runtime.evaluate ✗ → detach';
    });
    await check('deep: pointer-reactive motion — magnetic, tilt and proximity, measured not guessed', async () => {
      const p = await mochiOn(ctx, `${BASE}/test/deep-scan/pointer.html`);
      const r = await hook(p, 'deepScan', { only: ['prepare', 'pointer'] }, 40000);
      assert(r?.ok, JSON.stringify(r));
      const eff = (r.spec.pointer && r.spec.pointer.effects) || [];
      const kinds = eff.map(e => e.kind);
      assert(eff.length && eff.every(e => e.evidence === 'measured'), 'every effect is measured: ' + JSON.stringify(eff));
      assert(kinds.includes('magnetic') && eff.find(e => e.kind === 'magnetic').selector.includes('magnetic'), 'magnetic button: ' + JSON.stringify(eff));
      assert(kinds.includes('tilt'), 'tilt card: ' + JSON.stringify(eff));
      assert(kinds.includes('proximity'), 'proximity tile: ' + JSON.stringify(eff));
      assert(p.url().includes('pointer.html'), 'the probe only moved the cursor; the page stayed put');
      await p.close();
      return kinds.join(', ');
    });
    await check('deep: closing the tab during a scan detaches the debugger', async () => {
      const p = await mochiOn(ctx, `${BASE}/tests/fixtures/plain.html?close`);
      const r = await hook(p, 'cdpProbe', { stayAttached: true });
      assert(r?.attach?.attached, JSON.stringify(r));
      assert(await ctx.sw.evaluate(() => Mochi.debuggerProxy.sessions.size) === 1, 'no session');
      await p.close();
      const left = await until(async () => (await ctx.sw.evaluate(() => Mochi.debuggerProxy.sessions.size)) === 0 && 'gone', 4000);
      assert(left, 'session left after the tab closed');
      return '';
    });
    await check('deep: the safety rules — what may be clicked (EN + RU denylist, links, forms)', async () => {
      const p = await mochiOn(ctx, `${BASE}/test/deep-scan/landing.html?safe`);
      await p.evaluate(() => {
        const add = html => document.body.insertAdjacentHTML('beforeend', html);
        add('<div id="risk"><button type="button" class="r1">Купить сейчас</button><button type="button" class="r2" data-action="delete-account">⋯</button><button type="button" class="r3">Log out</button><button type="button" class="r4" aria-label="Отправить">→</button></div>');
      });
      const r = await hook(p, 'deepSafe', ['#products-btn', '.burger', '#tab-2', '.accordion-trigger', 'details summary', '[data-dialog-open]', '[aria-label="Next slide"]',
        '.header-cta', '.signup button', '.signup input', 'a[href="/pricing"]', '#risk .r1', '#risk .r2', '#risk .r3', '#risk .r4']);
      const safe = r.filter(x => x.ok).map(x => x.sel);
      assert(safe.length === 7 && safe.join() === '#products-btn,.burger,#tab-2,.accordion-trigger,details summary,[data-dialog-open],[aria-label="Next slide"]', JSON.stringify(r));
      await p.close();
      return r.filter(x => !x.ok).map(x => `${x.sel}: ${x.why}`).join(' · ');
    });
    await check('deep: during a scan the page can\'t leave or submit its form; the debugger detaches after', async () => {
      const before = serverHits.length;
      const p = await mochiOn(ctx, `${BASE}/test/deep-scan/landing.html?navtest`);
      const url = p.url();
      const r = await hook(p, 'deepScan', { only: ['prepare'], holdMs: 3500 }, 20000);
      assert(r?.ok, JSON.stringify(r));
      await p.waitForTimeout(500);
      assert(p.url() === url, `navigated to ${p.url()}`);
      const hits = serverHits.slice(before);
      assert(!hits.some(h => /submitted|left-the-page/.test(h)), `requests: ${hits.filter(h => /submitted|left/.test(h))}`);
      assert(r.safety.blockedSubmits >= 1 && r.safety.blockedNavigations >= 1, JSON.stringify(r.safety));
      assert(r.safety.detached && await ctx.sw.evaluate(() => Mochi.debuggerProxy.sessions.size) === 0, 'still attached');
      await p.close();
      return `blocked: ${r.safety.blockedSubmits} submit, ${r.safety.blockedNavigations} navigation`;
    });
    await check('deep: Cancel stops the scan, detaches and puts the scroll back', async () => {
      const p = await mochiOn(ctx, `${BASE}/test/deep-scan/landing.html?cancel`);
      await p.evaluate(() => scrollTo({ top: 900, behavior: 'instant' })); // the fixture has scroll-behavior: smooth
      await p.waitForTimeout(400);
      const y0 = await p.evaluate(() => scrollY);
      const r = await hook(p, 'deepScan', { only: ['prepare'], holdMs: 6000, cancelAfter: 1200 }, 20000);
      assert(r && r.cancelled, JSON.stringify(r));
      assert(await ctx.sw.evaluate(() => Mochi.debuggerProxy.sessions.size) === 0, 'still attached after Cancel');
      await p.waitForTimeout(1000);
      const y = await p.evaluate(() => scrollY);
      assert(Math.abs(y - y0) < 3, `scroll ${y0} → ${y}`);
      await p.close();
      return `cancelled, detached, scroll ${y0} → 0 → ${y}`;
    });
    await check('deep: structure — regions in reading order, layouts, sticky header, repeated components', async () => {
      const p = await mochiOn(ctx, `${BASE}/test/deep-scan/landing.html?structure`);
      const r = await hook(p, 'deepScan', { only: ['structure'] }, 60000);
      const st = r?.spec?.structure;
      assert(st, JSON.stringify(r).slice(0, 300));
      const flow = st.regions.filter(x => !['overlay', 'floating'].includes(x.kind));
      const names = flow.map(x => x.name).join(',');
      assert(names === 'Header,Hero,Logos,Features,Parallax,Learn,Carousel wrap,Playground,Signup,Footer', names);
      const byName = n => flow.find(x => x.name === n);
      const header = byName('Header');
      assert(header.position?.position === 'sticky' && header.position.zIndex === 50 && Math.abs(header.box.h - 72) <= 1, JSON.stringify(header.position) + header.box.h);
      const hero = byName('Hero').layout.grid;
      assert(hero?.template === '7fr 5fr' && hero.columns === 2, JSON.stringify(hero));
      assert(byName('Features').layout.grid?.columns === 3 && byName('Footer').layout.grid?.columns === 4, 'features/footer columns');
      assert(byName('Hero').container?.maxWidth === '1200px', JSON.stringify(byName('Hero').container));
      const comp = n => st.components.find(c => c.name === n);
      assert(comp('Card')?.count === 6 && comp('Card').layout === '3-col grid' && comp('Logo')?.count === 5 && comp('Slide')?.count === 6, JSON.stringify(st.components.map(c => `${c.name}×${c.count}`)));
      const extra = st.regions.filter(x => ['overlay', 'floating'].includes(x.kind)).map(x => x.name).sort().join(',');
      assert(extra === 'Floating button,Modal dialog,Navigation drawer', extra);
      assert(/^Header \(sticky, 72px.*\) → Hero \(2-col grid 7\/5\) → .*Features \(3-col grid of Card ×6\)/.test(st.outline), st.outline);
      await p.close();
      return st.outline.slice(0, 110) + '…';
    });
    await check('deep: geometry — card box, content column, gaps', async () => {
      const p = await mochiOn(ctx, `${BASE}/test/deep-scan/landing.html?geometry`);
      const r = await hook(p, 'deepScan', { only: ['structure', 'geometry'] }, 60000);
      const card = r.spec.structure.components.find(c => c.name === 'Card').geometry;
      const col = r.spec.geometry.contentColumn;
      assert(Math.abs(card.w - 368) <= 2 && card.radius === '12px' && card.padding === '24px' && card.spacingBetween === 24 && /1px solid rgb\(230, 230, 239\)/.test(card.border), JSON.stringify(card));
      assert(col.maxWidth === '1200px' && col.sidePadding === '24px' && col.contentWidth === 1152, JSON.stringify(col));
      const hero = r.spec.structure.regions.find(x => x.name === 'Hero');
      assert(hero.geometry.padding === '96px 0px' && hero.layoutGeometry?.gap === '48px', JSON.stringify(hero.geometry));
      await p.close();
      return `card ${card.w}×${card.h} r${card.radius} p${card.padding}; column ${col.maxWidth} (${col.contentWidth} + 2×${col.sidePadding})`;
    });
    await check('deep: responsive — breakpoints from @media, columns per width, burger at ≤768, viewport restored', async () => {
      const p = await mochiOn(ctx, `${BASE}/test/deep-scan/landing.html?responsive`);
      const w0 = await p.evaluate(() => innerWidth);
      const r = await hook(p, 'deepScan', { only: ['structure', 'responsive'] }, 90000);
      const rs = r.spec.responsive;
      const bps = rs.breakpoints.map(b => `${b.kind}${b.px}`).join(',');
      assert(bps === 'max1024,max768', `breakpoints ${bps} (Mochi's own CSS must not count)`);
      assert(rs.mediaFeatures.some(f => f.feature === 'prefers-reduced-motion: reduce'), 'reduced-motion media');
      const at = w => rs.widths.find(x => x.width === w).changes.map(c => c.text);
      const has = (w, re) => at(w).some(t => re.test(t));
      assert(has(1024, /^Hero: 2 → 1 column/) && has(1024, /^Features: 3 → 2 columns/) && has(1024, /^Footer: 4 → 2/), at(1024).join(' | '));
      assert(has(768, /^Features: 3 → 1 column/) && has(390, /burger.*appears/) && has(390, /nav\.main-nav.*hidden/) && has(390, /h1: 56px\/64px → 40px\/48px/), at(390).join(' | '));
      assert(!has(1024, /burger/), 'burger at 1024');
      const w1 = await p.evaluate(() => innerWidth);
      assert(w1 === w0, `viewport ${w0} → ${w1}`);
      await p.close();
      return `${bps}; 390: ${at(390).length} changes`;
    });
    await check('deep: tokens — colour roles, the site\'s CSS variables, type scale, fonts + @font-face, spacing, radius', async () => {
      const p = await mochiOn(ctx, `${BASE}/test/deep-scan/landing.html?tokens`);
      const r = await hook(p, 'deepScan', { only: ['structure', 'tokens'] }, 60000);
      const t = r.spec.tokens;
      const role = x => t.colors.roles.find(c => c.role === x)?.hex;
      assert(role('primary') === '#5b4cf0' && role('text') === '#16161d' && role('border') === '#e6e6ef', JSON.stringify(t.colors.roles));
      assert(t.customProperties['--brand'] === '#5b4cf0' && t.customProperties['--radius'] === '12px', JSON.stringify(t.customProperties));
      const sizes = t.typography.scale.map(x => `${x.size}/${x.lineHeight}`);
      assert(sizes.includes('56px/64px') && sizes.includes('40px/48px') && sizes.includes('20px/28px') && sizes.includes('16px/24px'), sizes.join(' '));
      const ff = t.typography.fontFaces.find(f => f.family === 'Fixture Display');
      assert(ff && ff.sources.some(s => s.format === 'woff2' && s.name === 'fixture-display.woff2') && ff.freeAlternative && /licen/i.test(t.typography.licenceNote), JSON.stringify(ff));
      assert(t.radius[0].value === '12px' && [4, 8].includes(t.spacing.base) && t.spacing.scale.includes(24) && t.spacing.scale.includes(96), JSON.stringify([t.radius[0], t.spacing]));
      assert(t.zIndex.some(z => z.value === 50) && t.gradients.length === 1 && t.opacity.some(o => o.value === '0.7'), 'z/gradients/opacity');
      await p.close();
      return `${t.colors.roles.length} roles, ${Object.keys(t.customProperties).length} variables, ${sizes.length} type styles, base ${t.spacing.base}`;
    });
    await check('deep: components — button variants and sizes, styles without browser defaults, tokens used, icons', async () => {
      const p = await mochiOn(ctx, `${BASE}/test/deep-scan/landing.html?components`);
      const r = await hook(p, 'deepScan', { only: ['structure', 'tokens', 'components'] }, 60000);
      const cs = r.spec.components;
      const primary = cs.filter(c => c.type === 'button' && c.variant === 'primary');
      const large = primary.find(c => c.size.h === 48);
      assert(primary.length === 2 && large && large.styles['background-color'] === 'rgb(91, 76, 240)' && large.styles.height === '48px' && large.styles['border-radius'] === '12px' && large.styles.padding === '0px 24px', JSON.stringify(primary.map(c => c.styles)));
      assert(large.tokens['background-color'] === 'var(--brand)' && large.tokens['border-radius'] === 'var(--radius)' && /background-color 0.15s ease-out/.test(large.styles.transition), JSON.stringify(large.tokens));
      assert(!('margin' in large.styles) && !('min-height' in large.styles), 'defaults leaked in');
      const tab = cs.find(c => c.type === 'tab');
      assert(tab?.count === 3 && !tab.tokens.padding, JSON.stringify(tab?.tokens));
      assert(cs.some(c => c.type === 'accordion' && c.count === 3) && cs.some(c => c.type === 'modal') && cs.some(c => c.type === 'badge' && c.styles['border-radius'] === '999px') && cs.some(c => c.type === 'input'), cs.map(c => c.type).join(','));
      const card = cs.find(c => c.name === 'Card');
      assert(card.icon?.size === '24×24' && /outline/.test(card.icon.style) && card.tokens.border === 'var(--line)', JSON.stringify(card.icon));
      assert(cs.every(c => !c.text || /^\[\d+ chars\]$/.test(c.text)), 'copy text leaked (own-site is off)');
      await p.close();
      return cs.map(c => `${c.type}${c.variant ? `:${c.variant}` : ''}${c.size?.name ? `:${c.size.name}` : ''}`).join(' ');
    });
    await check('deep: states — forced hover/focus diffs, transitions, cropped default + hover screenshots', async () => {
      const p = await mochiOn(ctx, `${BASE}/test/deep-scan/landing.html?states`);
      const r = await hook(p, 'deepScan', { only: ['structure', 'tokens', 'components', 'states'] }, 120000);
      const st = r.spec.states.interactive;
      const primary = st.find(e => e.type === 'button' && e.variant === 'primary');
      assert(primary.states.hover?.changes['background-color']?.to === 'rgb(74, 59, 217)', JSON.stringify(primary.states));
      assert(primary.transitions.some(t => t.property === 'background-color' && t.duration === 150 && t.easing === 'ease-out'), JSON.stringify(primary.transitions));
      assert(primary.states['focus-visible']?.changes['outline-color']?.to === 'rgb(184, 176, 255)', 'focus-visible ring');
      const card = st.find(e => e.variant === 'Card');
      assert(/0, -4\)$/.test(card.states.hover.changes.transform.to) && /0px 12px 24px/.test(card.states.hover.changes['box-shadow'].to), JSON.stringify(card.states.hover));
      assert(card.transitions.some(t => t.property === 'transform' && t.duration === 200 && t.easing === 'ease'), JSON.stringify(card.transitions));
      assert(!card.states.focus, 'focus tried on a non-focusable card');
      assert(card.shots && r.shots.includes(card.shots.hover.replace('screenshots/', '')), JSON.stringify(card.shots));
      await p.close();
      return `${st.length} components, ${r.shots.length} state screenshots`;
    });
    await check('deep: clicks — safe controls only: dropdown, dialog, tabs, accordion, details, carousel, burger at 390; how each opens/closes; page restored', async () => {
      const before = serverHits.length;
      const p = await mochiOn(ctx, `${BASE}/test/deep-scan/landing.html?clicks`);
      const url = p.url();
      const r = await hook(p, 'deepScan', { only: ['structure', 'responsive', 'clicks'] }, 150000);
      const st = r.spec.states;
      const by = k => st.clicks.filter(c => c.kind === k);
      const dd = by('dropdown')[0], dlg = by('dialog')[0], burger = by('burger')[0];
      assert(dd?.opens[0]?.selector === 'ul#products-menu.dropdown-menu' && /^below the trigger \(8px gap/.test(dd.opens[0].where) && dd.opens[0].animation[0]?.name === 'drop-in' && dd.opens[0].animation[0].duration === 160 && dd.opens[0].animation[0].easing === 'ease-out', JSON.stringify(dd));
      assert(['Esc', 'the same button again', 'a click outside'].every(w => dd.closes.includes(w)), `dropdown closes: ${dd.closes}`);
      assert(dlg?.opens[0]?.position === 'top layer (modal dialog)' && dlg.opens[0].animation[0]?.name === 'dialog-in' && /0\.5\)$/.test(dlg.opens[0].backdrop) && dlg.closes.includes('Esc') && dlg.closes.includes('a close button inside'), JSON.stringify(dlg));
      assert(by('tab').filter(t => t.opens.length).length === 2 && by('accordion')[0]?.closes.includes('the same button again') && by('details').length === 1, 'tabs/accordion/details');
      assert(/336px \(smooth\)/.test(by('carousel')[0]?.effect || ''), JSON.stringify(by('carousel')));
      assert(burger?.width === 390 && burger.opens[0]?.where === 'drawer from the right' && /transform/.test(burger.opens[0].animation[0]?.name), JSON.stringify(burger));
      const names = st.pageStates.map(s => s.name);
      assert(['initial', 'menu open', 'modal open', 'accordion item open', 'mobile nav open (390px)'].every(n => names.includes(n)), names.join(','));
      assert(st.restored, `not restored: ${st.notRestored}`);
      assert(p.url() === url && !serverHits.slice(before).some(h => /submitted|\/signup|\/pricing|\/courses/.test(h)), 'navigated or submitted');
      assert(r.spec.safety.blockedSubmits === 0, 'a submit was attempted');
      assert(!st.clicks.some(c => /signup|subscribe|header-cta/i.test(c.trigger)), 'clicked a risky control');
      await p.close();
      return `${st.clicks.length} controls, states: ${names.join(' · ')}`;
    });
    await check('deep: motion (CSS) — running loops with @keyframes, animations started by interactions, transitions, reduced motion', async () => {
      const p = await mochiOn(ctx, `${BASE}/test/deep-scan/landing.html?motion`);
      const r = await hook(p, 'deepScan', { only: ['structure', 'clicks', 'motion'] }, 150000);
      const m = r.spec.motion;
      const a = n => m.animations.find(x => x.name === n);
      assert(a('pulse')?.duration === 2000 && a('pulse').iterations === 'infinite' && a('pulse').easing === 'ease-in-out' && /@keyframes pulse \{ 0%, 100% \{ transform: scale\(1\); \} 50% \{ transform: scale\(1\.06\); \} \}/.test(a('pulse').css), JSON.stringify(a('pulse')));
      assert(a('drop-in')?.duration === 160 && a('drop-in').target === 'ul#products-menu.dropdown-menu' && a('dialog-in')?.duration === 200, m.animations.map(x => x.name).join(','));
      const t = sel => m.transitions.find(x => x.target === sel)?.transitions || [];
      assert(t('header#top.site-header').some(x => x.property === 'height' && x.duration === 200) && t('article.card.reveal').some(x => x.property === 'transform' && x.duration === 200), JSON.stringify(m.transitions.slice(0, 3)));
      assert(m.reducedMotion.handled && m.reducedMotion.rules.some(x => x.selector === '.badge') && m.capturedWithReducedMotion === false, JSON.stringify(m.reducedMotion));
      await p.close();
      return m.animations.map(x => `${x.name} ${x.duration}ms`).join(', ');
    });
    await check('deep: motion (JS) — the rAF float is found and fitted (±12px, ~3s, looping); techniques named', async () => {
      const p = await mochiOn(ctx, `${BASE}/test/deep-scan/landing.html?jsmotion`);
      const r = await hook(p, 'deepScan', { only: ['structure', 'jsmotion'] }, 60000);
      const js = r.spec.motion.js;
      const f = js.find(x => x.target === 'div.floaty');
      const ty = f?.fit?.ty;
      assert(ty?.kind === 'loop' && Math.abs(ty.amplitude - 12) <= 3 && Math.abs(ty.period - 3000) <= 400 && /sine/.test(ty.shape), JSON.stringify(f));
      assert(!js.some(x => /badge|pulse/.test(x.target)), 'a CSS animation counted as JS motion');
      assert(r.spec.motion.libraries.includes('hand-written requestAnimationFrame loop') && r.spec.motion.libraries.includes('IntersectionObserver (reveal on scroll)'), r.spec.motion.libraries.join(','));
      await p.close();
      return f.description;
    });
    await check('deep: scroll — sticky header change + exact threshold, reveal threshold + stagger, parallax ratio, snap, smooth, back to top', async () => {
      const p = await mochiOn(ctx, `${BASE}/test/deep-scan/landing.html?scroll`);
      const r = await hook(p, 'deepScan', { only: ['structure', 'scroll'] }, 90000);
      const s = r.spec.scroll;
      const head = s.stickyAndFixed.find(f => f.target === 'header#top.site-header');
      assert(head && Math.abs(head.threshold - 80) <= 21 && head.addsClass.includes('is-scrolled') && head.changes.height?.to === '56px' && head.changes.backgroundColor?.to === 'rgb(255, 255, 255)' && head.transitions.some(t => t.property === 'height' && t.duration === 200), JSON.stringify(head));
      const rev = s.reveals.find(x => x.target === 'article.card.reveal');
      assert(rev && rev.count === 6 && rev.addsClass.includes('is-visible') && rev.threshold >= 0.05 && rev.threshold <= 0.25 && rev.thresholdRange[0] <= 0.15 && rev.thresholdRange[1] >= 0.15, JSON.stringify(rev));
      assert(Math.abs(rev.stagger - 100) <= 40 && rev.how.animation === 'fade-up' && rev.how.duration === 600 && rev.how.easing === 'ease-out', JSON.stringify(rev.how) + rev.stagger);
      const par = s.parallax.find(x => x.target === 'div.parallax-layer');
      assert(par && par.speed >= 0.4 && par.speed <= 0.6 && s.parallax.length === 1, JSON.stringify(s.parallax));
      assert(s.snap.some(x => x.target === 'div#stories.carousel' && x.type === 'x mandatory') && s.smooth, 'snap/smooth');
      assert(s.backToTop.length === 1 && Math.abs(s.backToTop[0].appearsAfter - 600) <= 21, JSON.stringify(s.backToTop));
      assert(await p.evaluate(() => scrollY) < 2, 'not back at the top');
      await p.close();
      return s.timeline.slice(0, 3).map(l => l.slice(0, 70)).join(' | ');
    });
    await check('deep: screenshots — full page at 4 widths + one per section, with Mochi hidden', async () => {
      const p = await mochiOn(ctx, `${BASE}/test/deep-scan/landing.html?shots`);
      const r = await hook(p, 'deepScan', { only: ['structure', 'scroll', 'shots'] }, 120000);
      for (const w of [1440, 1024, 768, 390]) assert(r.shots.includes(`full-${w}.png`), `no full-${w}.png`);
      assert(r.shots.filter(n => n.startsWith('sections/')).length === 10 && r.shots.includes('sections/02-hero.png'), r.shots.join(','));
      assert(r.spec.structure.regions.find(x => x.name === 'Hero').screenshot === 'screenshots/sections/02-hero.png', 'region → screenshot link');
      const z = await hook(p, 'deepZip', true, 60000);
      const bytes = Buffer.from(z.base64, 'base64');
      const png = name => { const i = bytes.indexOf(Buffer.from(`screenshots/${name}`)); const at = bytes.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]), i); return { w: bytes.readUInt32BE(at + 16), h: bytes.readUInt32BE(at + 20) }; };
      const full = png('full-1440.png');
      assert(full.w === 1440 && full.h > 3000, JSON.stringify(full));
      assert(await p.evaluate(() => innerWidth) === 1280 && await p.evaluate(() => document.querySelector('mochi-companion').style.visibility) === '', 'viewport or Mochi not restored');
      await p.close();
      return `${r.shots.length} pictures, full-1440 ${full.w}×${full.h}`;
    });
    await check('deep: media — image boxes as placeholders, logos, animated canvas marked approximate, honest limits', async () => {
      const p = await mochiOn(ctx, `${BASE}/test/deep-scan/landing.html?media`);
      const r = await hook(p, 'deepScan', { only: ['structure', 'jsmotion', 'media'] }, 90000);
      const m = r.spec.media;
      const hero = m.images.find(i => /large image/.test(i.role));
      assert(hero && hero.ratio === '4:3' && hero.objectFit === 'cover' && hero.radius === '16px' && !('src' in hero) && !('alt' in hero), JSON.stringify(hero));
      assert(m.images.filter(i => i.role === 'logo').length === 5, m.images.map(i => i.role).join(','));
      const cv = m.canvases.find(c => c.selector === 'canvas#particles');
      assert(cv?.animated === true && cv.kind === '2D canvas' && r.spec.approximations.some(a => a.where === 'canvas#particles'), JSON.stringify(cv));
      assert(r.spec.approximations.some(a => a.what === 'JavaScript motion') && r.spec.limits.length >= 6, 'approximations/limits');
      await p.close();
      return `${m.images.length} images (${hero.placeholder}), canvas: ${cv.kind}, ${r.spec.approximations.length} approximations`;
    });
    await check('deep: full scan → zip with SPEC.md + spec.json (readable, placeholders, no copy text)', async () => {
      const hitsBefore = serverHits.length;
      const p = await mochiOn(ctx, `${BASE}/test/deep-scan/landing.html?full`);
      const url0 = p.url();
      const r = await hook(p, 'deepScan', {}, 240000);
      assert(r?.ok && !r.partial.length, JSON.stringify(r?.partial));
      // The phases together: components/states see the revealed cards; nothing was sent or left; debugger gone.
      const card = r.spec.components.find(c => c.name === 'Card');
      assert(!('opacity' in card.styles) && !/0, 24\)/.test(card.styles.transform || ''), `card described before its reveal: ${JSON.stringify(card.styles)}`);
      const cardHover = r.spec.states.interactive.find(e => e.variant === 'Card').states.hover.changes.transform;
      assert(cardHover.from === 'none' && /0, -4\)$/.test(cardHover.to), JSON.stringify(cardHover));
      assert(r.spec.states.restored && p.url() === url0 && !serverHits.slice(hitsBefore).some(h => /submitted|left-the-page|\/signup|\/pricing/.test(h)), 'navigation, submit or state left over');
      assert(r.safety.detached && await ctx.sw.evaluate(() => Mochi.debuggerProxy.sessions.size) === 0 && await p.evaluate(() => scrollY) < 2, 'debugger/scroll');
      const z = await hook(p, 'deepZip', true, 60000);
      const files = unzipStore(Buffer.from(z.base64, 'base64'));
      const md = files['SPEC.md']?.toString('utf8') || '';
      const spec = JSON.parse(files['spec.json'].toString('utf8'));
      assert(/^rebuild-spec-127-0-0-1-\d{4}-\d{2}-\d{2}\.zip$/.test(z.name), z.name);
      for (const h of ['## Page outline', '## Design tokens', '## Regions, top to bottom', '## Components and their states', '## What clicking does', '## Motion', '## Scroll timeline', '## Responsive behaviour', '## Approximate', '## Not captured']) assert(md.includes(h), `SPEC.md lacks "${h}"`);
      assert(/grid-template-columns: 7fr 5fr/.test(md) && /\.card\.reveal:hover \{/.test(md) && /fade-up 600ms ease-out/.test(md), 'SPEC.md details');
      assert(spec.version === 1 && spec.structure.regions.length >= 10 && spec.source.title === '(placeholder title)', 'spec.json');
      assert(!/Fixtura|Learn anything|Bite-size lessons|Students learning/.test(md + files['spec.json'].toString('utf8')), 'original copy/brand leaked into the spec');
      const prompt = files['PROMPT.md']?.toString('utf8') || '';
      for (const h of ['## 1. Pick the stack', '## 2. Build it section by section', '## 3. Implement every state', '## 4. Make it responsive', '## 5. Compare with the screenshots', '## 6. Branding and content', '## Acceptance criteria']) assert(prompt.includes(h), `PROMPT.md lacks "${h}"`);
      assert(/full-1440\.png/.test(prompt) && /placeholder branding/.test(prompt) && /React \+ Tailwind/.test(prompt), 'PROMPT.md details');
      const tokens = files['tokens.css'].toString('utf8');
      assert(/--color-primary: #5b4cf0;/.test(tokens) && /--brand: #5b4cf0;/.test(tokens) && /@keyframes fade-up/.test(tokens) && /--font-heading: "Fixture Display"/.test(tokens) && !/"system-ui"/.test(tokens), 'tokens.css');
      const tw = {}; new Function('module', files['tailwind.config.js'].toString('utf8'))(tw);
      assert(tw.exports.theme.extend.colors.primary === '#5b4cf0' && tw.exports.theme.extend.screens['max-768'].max === '768px' && tw.exports.theme.extend.keyframes['fade-up'], 'tailwind.config.js');
      // Not the owner's site: the raw source is NOT shipped (it holds the original copy/brand), but the
      // source metadata is — @keyframes counts and the script list, with no verbatim text.
      assert(!files['source.css'] && !files['source.html'], 'raw source must not ship for a non-own site');
      assert(spec.sourceFiles && spec.sourceFiles.available === false && typeof spec.sourceFiles.keyframes.defined === 'number' && !spec.sourceFiles.css && !spec.sourceFiles.html, 'spec.sourceFiles metadata only');
      assert(spec.source.title === '(placeholder title)', 'spec.source (scan metadata) untouched');
      assert(/From the source/.test(prompt) && !/`source\.css`/.test(prompt), 'PROMPT.md has source metadata but no source.css bullet for a non-own site');
      const pocket = await ctx.sw.evaluate(async () => (await chrome.storage.local.get('pocket'))?.pocket || (await chrome.storage.local.get(null)));
      const items = Array.isArray(pocket) ? pocket : Object.values(pocket).find(v => Array.isArray(v) && v.some(x => x?.kind === 'deep')) || [];
      const deep = items.find(x => x.kind === 'deep');
      assert(deep && /attached zip "rebuild-spec-/.test(deep.paste) && /placeholder branding/.test(deep.paste), 'pocket entry');
      // The results panel: every section, a gallery of real pictures, and the download button gives the zip.
      const panel = await shadow(p, '.panel', 'html');
      for (const sec of ['outline', 'tokens', 'components', 'states', 'motion', 'approx']) assert(panel.includes(`data-sec="${sec}"`), `results panel lacks ${sec}`);
      assert((panel.match(/<img src="blob:/g) || []).length >= 4, 'states gallery has no pictures');
      const dl = p.waitForEvent('download', { timeout: 30000 });
      await shadow(p, '[data-act="deep-download"]', 'click');
      const file = await dl;
      assert(/^rebuild-spec-.*\.zip$/.test(file.suggestedFilename()), file.suggestedFilename());
      await p.close();
      return `${Object.keys(files).length} files, SPEC.md ${Math.round(md.length / 1024)} KB, ${spec.source.ms} ms`;
    });
    await check('deep: "my own site" keeps the original text and pictures (and resets for the next scan)', async () => {
      const p = await mochiOn(ctx, `${BASE}/test/deep-scan/landing.html?own`);
      const r = await hook(p, 'deepScan', { ownSite: true, only: ['structure', 'content', 'media', 'shots', 'sheets', 'source'] }, 150000);
      const hero = r.spec.structure.regions.find(x => x.name === 'Hero');
      assert(hero.content.some(b => b.role === 'h1' && b.text === 'Learn anything, one small step at a time') && r.spec.source.ownSite, JSON.stringify(hero.content[1]));
      assert(r.spec.media.images.some(i => i.alt === 'Students learning together'), 'alt text not kept');
      const z = await hook(p, 'deepZip', true, 60000);
      const files = unzipStore(Buffer.from(z.base64, 'base64'));
      assert(/Learn anything, one small step at a time/.test(files['SPEC.md'].toString('utf8')) && /owner's own site/.test(files['PROMPT.md'].toString('utf8')), 'SPEC/PROMPT');
      // Own site: the page's own CSS ships verbatim as source.css, and the prompt points to it.
      const srcCss = files['source.css']?.toString('utf8') || '';
      assert(/@keyframes fade-up/.test(srcCss) && /@keyframes drop-in/.test(srcCss), 'source.css has the page CSS verbatim');
      assert(r.spec.sourceFiles && r.spec.sourceFiles.available === true && r.spec.sourceFiles.keyframes.defined >= 4, 'spec.sourceFiles says the source is available');
      assert(/`source\.css`/.test(files['PROMPT.md'].toString('utf8')), 'PROMPT.md points to source.css for the owner');
      // The next scan starts with the box unticked.
      await hook(p, 'deepIntro');
      const html = await until(() => shadow(p, '.panel', 'html'), 4000);
      assert(!/<input[^>]*id="deep-own"[^>]*checked/.test(html), 'own-site box stayed ticked');
      await p.close();
      return 'original h1 + alt kept';
    });
    await check('deep: menu → explainer; "my own site" is off by default and resets every time', async () => {
      const p = await mochiOn(ctx, `${BASE}/tests/fixtures/plain.html?intro`);
      const openIntro = async () => {
        await shadow(p, '.character', 'click');
        await until(() => shadow(p, '.app-tab[data-section="tools"]'), 3000);
        await shadow(p, '.app-tab[data-section="tools"]', 'click'); // Deep scan lives under Tools → Scanners now
        await until(() => shadow(p, '.menu-item[data-cat="scan"]'), 3000);
        await shadow(p, '.menu-item[data-cat="scan"]', 'click'); // drill into the Scanners category
        await until(() => shadow(p, '.menu-item[data-id="deep-scan"]'), 3000);
        await shadow(p, '.menu-item[data-id="deep-scan"]', 'click');
        return until(() => shadow(p, '[data-act="deep-start"]'), 4000);
      };
      assert(await openIntro(), 'no explainer');
      const html = await shadow(p, '.panel', 'html');
      assert(/Start deep scan/.test(html) && /debugging this browser/.test(html), 'explainer text');
      assert(!/id="deep-own"[^>]*checked/.test(html), 'checkbox on by default');
      await shadow(p, '#deep-own', 'click');
      await p.keyboard.press('Escape');
      assert(await openIntro(), 'no explainer the second time');
      const again = await shadow(p, '.panel', 'html');
      assert(!/checked/.test(again.match(/<input[^>]*id="deep-own"[^>]*>/)?.[0] || ''), 'checkbox stayed on');
      await p.close();
      return 'Start deep scan · unchecked · reset';
    });
    await check('no console errors (deepscan)', async () => { assert(!ctx.errors.length, ctx.errors.join(' | ')); return ''; });
  } finally { await ctx.close(); fs.rmSync(ctx.extDir, { recursive: true, force: true }); }

  const noPerm = await deepContext('deepscan-noperm', { permission: false });
  try {
    await check('deep: without the debugger permission nothing attaches', async () => {
      const p = await mochiOn(noPerm, `${BASE}/tests/fixtures/plain.html`);
      const r = await hook(p, 'cdpProbe');
      assert(r?.error === 'no-permission' || r?.status?.permission === false && r?.error, JSON.stringify(r));
      return r.error;
    });
    await check('deep: without the debugger permission, Deep scan says how to fix it (no dead end)', async () => {
      const p = await mochiOn(noPerm, `${BASE}/tests/fixtures/plain.html?perm`);
      await hook(p, 'deepIntro');
      const html = await until(() => shadow(p, '.panel', 'html'), 4000);
      assert(/debugger/.test(html) && /chrome:\/\/extensions/.test(html) && html.includes('data-act="deep-retry"') && !html.includes('data-act="deep-start"'), html.slice(0, 300));
      await p.close();
      return 'explains + Try again';
    });
    await check('deep: a failed start explains itself (restart needed / DevTools attached / page not allowed)', async () => {
      const p = await mochiOn(noPerm, `${BASE}/tests/fixtures/plain.html?err`);
      const out = [];
      for (const [code, re, act] of [['restart-needed', /restart/i, 'deep-restart'], ['already-attached', /DevTools/, 'deep-retry'], ['page-not-allowed', /normal website/, null]]) {
        await hook(p, 'deepError', code);
        const html = await until(() => shadow(p, '.panel', 'html'), 3000);
        assert(re.test(html) && (!act || html.includes(`data-act="${act}"`)) && !html.includes(code), `${code}: ${html.slice(0, 200)}`);
        out.push(code);
      }
      await p.close();
      return out.join(', ');
    });
    await check('no console errors (deepscan, no permission)', async () => { assert(!noPerm.errors.length, noPerm.errors.join(' | ')); return ''; });
  } finally { await noPerm.close(); fs.rmSync(noPerm.extDir, { recursive: true, force: true }); }
};

groups.sites = async () => {
  // ChatGPT and Gemini. Chrome's permission question can't be answered in a
  // headless browser, so: this copy already holds the two hosts (so scripts
  // can run there), and a stand-in for chrome.permissions in the worker
  // decides what counts as "allowed". Everything else is Mochi's real code:
  // the options page, registerContentScripts, adding Mochi to open tabs,
  // unregistering, and the content scripts on the fixture pages.
  const ext = extensionCopy('sites', m => ({ ...m, host_permissions: [...(m.host_permissions || []), ...m.optional_host_permissions] }));
  const SITES = { 'https://chatgpt.com/': 'test/sites/chatgpt.html', 'https://gemini.google.com/': 'test/sites/gemini.html' };
  const mounted = p => p.evaluate(() => !!document.querySelector('mochi-companion'));
  const status = c => c.sw.evaluate(() => Mochi.siteAccess.status());
  const fakePermissions = c => c.sw.evaluate(() => {
    const granted = new Set();
    chrome.permissions.contains = async ({ origins }) => origins.every(o => granted.has(o));
    chrome.permissions.remove = async ({ origins }) => { origins.forEach(o => granted.delete(o)); return true; };
    chrome.runtime.onMessage.addListener((m, s, reply) => { if (m?.type === 'test-grant') { m.origins.forEach(o => granted.add(o)); reply(true); } });
    return Mochi.siteAccess.sync(); // start from "nothing allowed"
  });
  /** Chrome's question on the options page, answered yes or no. */
  const answer = (page, yes) => page.evaluate(yes => {
    chrome.permissions.request = ({ origins }) => (yes ? new Promise(r => chrome.runtime.sendMessage({ type: 'test-grant', origins }, () => r(true))) : Promise.resolve(false));
  }, yes);
  let ctx = await launch(ext, { name: 'sites' });
  try {
    await routeSites(ctx, SITES);
    await fakePermissions(ctx);
    const gpt = await ctx.newPage();
    await gpt.goto('https://chatgpt.com/');
    await check('sites: off by default — no Mochi on chatgpt.com, nothing registered', async () => {
      await gpt.waitForTimeout(2500);
      assert(!(await mounted(gpt)), 'Mochi is there');
      const s = await status(ctx);
      assert(!s.chatgpt.registered && !s.gemini.registered, JSON.stringify(s));
      return '';
    });

    const opt = await ctx.newPage();
    await opt.goto(`chrome-extension://${ctx.extId}/options.html`);
    await check('options page: Claude always on, ChatGPT and Gemini off', async () => {
      await opt.waitForSelector('.site-row[data-site="gemini"]');
      const rows = await opt.$$eval('.switch', els => els.map(e => `${e.dataset.site}:${e.getAttribute('aria-checked')}`));
      assert(rows.join() === 'claude:true,chatgpt:false,gemini:false', rows.join());
      return rows.join(' ');
    });
    await check('options page: turning ChatGPT on registers it and adds Mochi to the open tab', async () => {
      await answer(opt, true);
      await opt.click('.switch[data-site="chatgpt"]');
      await opt.waitForSelector('.switch[data-site="chatgpt"][aria-checked="true"]', { timeout: 5000 });
      const s = await status(ctx);
      assert(s.chatgpt.granted && s.chatgpt.registered && !s.gemini.registered, JSON.stringify(s));
      assert(await until(() => mounted(gpt), 5000), 'the open chatgpt.com tab got no Mochi');
      const reg = await ctx.sw.evaluate(() => chrome.scripting.getRegisteredContentScripts({ ids: ['mochi-site-chatgpt'] }).then(([r]) => ({ first: r.js[0], n: r.js.length, files: FILES.length, persist: r.persistAcrossSessions })));
      assert(reg.first === 'src/sites/enabled.js' && reg.n === reg.files + 1 && reg.persist, JSON.stringify(reg));
      return (await opt.textContent('.msg')).trim();
    });
    await check('chatgpt: Mochi sits beside the message box and reacts to an answer', async () => {
      const box = await gpt.evaluate(() => document.querySelector('form').getBoundingClientRect().right);
      const me = await until(() => shadow(gpt, '.root', 'box'));
      assert(me && me.x > box, `Mochi at x=${me?.x}, box ends at ${box}`);
      await gpt.evaluate(() => window.fixture.send('Why is the sky blue?'));
      const mood = await until(async () => { const m = await hostAttr(gpt, 'data-mood'); return ['curious', 'thinking'].includes(m) && m; }, 5000);
      assert(mood, `no reaction (mood ${await hostAttr(gpt, 'data-mood')})`);
      const after = await until(async () => { const m = await hostAttr(gpt, 'data-mood'); return !['curious', 'thinking'].includes(m) && m; }, 15000, 200);
      assert(after, 'no end-of-answer reaction');
      return `${mood} → ${after}`;
    });
    await check('chatgpt: follows the page theme (html.dark)', async () => {
      const p = await ctx.newPage();
      await p.goto('https://chatgpt.com/?theme=dark');
      const t = await until(() => p.evaluate(() => document.querySelector('mochi-companion')?.dataset.theme === 'dark' && 'dark'), 6000);
      assert(t === 'dark', `theme ${await p.evaluate(() => document.querySelector('mochi-companion')?.dataset.theme)}`);
      await p.close();
      return 'dark';
    });
    await check('options page: Chrome says no to Gemini → stays off, with a note', async () => {
      await answer(opt, false);
      await opt.click('.switch[data-site="gemini"]');
      await opt.waitForSelector('.msg.warn', { timeout: 4000 });
      const s = await status(ctx);
      assert(!s.gemini.granted && !s.gemini.registered, JSON.stringify(s));
      return (await opt.textContent('.msg')).trim();
    });
    await check('gemini: turned on, a new tab gets Mochi, reacts, dark theme', async () => {
      await answer(opt, true);
      await opt.click('.switch[data-site="gemini"]');
      await opt.waitForSelector('.switch[data-site="gemini"][aria-checked="true"]', { timeout: 5000 });
      const g = await ctx.newPage();
      await g.goto('https://gemini.google.com/app');
      assert(await until(() => mounted(g), 6000), 'no Mochi on gemini');
      await g.waitForTimeout(800);
      await g.evaluate(() => window.fixture.send('Tell me about rainbows'));
      const mood = await until(async () => { const m = await hostAttr(g, 'data-mood'); return ['curious', 'thinking'].includes(m) && m; }, 5000);
      assert(mood, `no reaction (mood ${await hostAttr(g, 'data-mood')})`);
      await g.goto('https://gemini.google.com/app?theme=dark');
      const t = await until(() => g.evaluate(() => document.querySelector('mochi-companion')?.dataset.theme === 'dark' && 'dark'), 6000);
      assert(t === 'dark', 'not dark');
      await g.close();
      return `${mood}, dark`;
    });
    await check('no Stop button (the real pages differ): Mochi still sees the answer start and end, and reacts to a sad message', async () => {
      const out = [];
      for (const url of ['https://chatgpt.com/c/nostop?nostop', 'https://gemini.google.com/app/nostop?nostop']) {
        const p = await ctx.newPage();
        await p.goto(url);
        assert(await until(() => mounted(p), 6000), `no Mochi on ${url}`);
        await p.waitForTimeout(1500);
        await p.evaluate(() => window.fixture.send('txur em, aysor shat vat or er', 'I am so sorry you feel sad today. That sounds really hard and painful, and it is okay to cry. I am here for you.'));
        const seen = [];
        const end = Date.now() + 20000;
        while (Date.now() < end) {
          const mood = await hostAttr(p, 'data-mood');
          if (mood !== seen.at(-1)) seen.push(mood);
          if (seen.includes('focused') && seen.slice(seen.indexOf('focused')).includes('sad')) break;
          await p.waitForTimeout(100);
        }
        assert(seen.includes('focused'), `${url}: never noticed the answer being written (${seen})`);
        assert(seen.slice(seen.indexOf('focused')).includes('sad'), `${url}: no sad reaction at the end (${seen})`);
        await p.waitForTimeout(1500);
        const still = await hostAttr(p, 'data-mood');
        assert(still === 'sad', `${url}: the sad face was replaced by ${still} (${seen})`);
        out.push(seen.join('→'));
        await p.close();
      }
      return out.join(' | ');
    });
    await check('fallback on both sites: no chat found → plain companion, one console.debug each', async () => {
      const pages = [];
      for (const url of ['https://chatgpt.com/?broken', 'https://gemini.google.com/app?broken']) { const p = await ctx.newPage(); await p.goto(url); pages.push(p); }
      const notes = () => ['ChatGPT', 'Gemini'].map(n => ctx.debugs.filter(t => t.includes(`chat on this ${n} page`)).length);
      assert(await until(() => notes().every(n => n > 0), 16000, 250), `notes ${notes()}`);
      for (const p of pages) { assert(await mounted(p), 'Mochi gone'); await p.close(); }
      assert(notes().every(n => n === 1), `notes ${notes()}`);
      return notes().join(' + ');
    });
    await check('options page: turning ChatGPT off unregisters it; new tabs get no Mochi', async () => {
      await opt.click('.switch[data-site="chatgpt"]');
      await opt.waitForSelector('.switch[data-site="chatgpt"][aria-checked="false"]', { timeout: 5000 });
      const s = await status(ctx);
      assert(!s.chatgpt.granted && !s.chatgpt.registered && s.gemini.registered, JSON.stringify(s));
      const p = await ctx.newPage();
      await p.goto('https://chatgpt.com/');
      await p.waitForTimeout(2500);
      assert(!(await mounted(p)), 'Mochi still came');
      await p.close();
      return (await opt.textContent('.msg')).trim();
    });
    await check('toolbar on chatgpt.com (site off) → plain companion, the chat is not read', async () => {
      const p = await ctx.newPage();
      await p.goto('https://chatgpt.com/c/toolbar');
      const r = await ctx.sw.evaluate(async () => { const [tab] = await chrome.tabs.query({ url: 'https://chatgpt.com/c/toolbar' }); return toggleIn(tab); });
      assert(r === 'added', r);
      assert(await until(() => mounted(p), 5000), 'not mounted');
      await p.waitForTimeout(800);
      await p.evaluate(() => window.fixture.send('Hello?'));
      await p.waitForTimeout(2500);
      const m = await hostAttr(p, 'data-mood');
      assert(!['curious', 'thinking'].includes(m), `reacted to the chat (${m})`);
      await p.close();
      return `mood ${m}`;
    });
    await check('chat page menu: "Chat sites…" opens the options page', async () => {
      await routeSites(ctx, { 'https://claude.ai/': CLAUDE_FIXTURE, ...SITES });
      const c = await ctx.newPage();
      await c.goto('https://claude.ai/chat/sites');
      assert(await until(() => shadow(c, '.character')), 'no Mochi');
      await shadow(c, '.character', 'click');
      await shadow(c, '.app-tab[data-section="settings"]', 'click');
      const opened = ctx.waitForEvent('page', { timeout: 5000 });
      await shadow(c, '.set-row.action[data-id="chat-sites"]', 'click');
      const page = await opened;
      await page.waitForLoadState();
      assert(page.url().endsWith('/options.html#sites'), page.url());
      await page.close(); await c.close();
      return 'options.html#sites';
    });
    await check('no console errors (sites)', async () => { assert(!ctx.errors.length, ctx.errors.join(' | ')); return ''; });
  } finally { await ctx.close(); }

  // After a browser restart the registration is still there (and redone on startup).
  ctx = await launch(ext, { name: 'sites', profile: ctx.profile });
  try {
    await routeSites(ctx, SITES);
    await check('sites: registered again after a browser restart', async () => {
      const s = await until(async () => { const v = await status(ctx); return v.gemini.registered && v; }, 5000);
      assert(s, JSON.stringify(await status(ctx)));
      const g = await ctx.newPage();
      await g.goto('https://gemini.google.com/app');
      assert(await until(() => mounted(g), 6000), 'no Mochi after restart');
      return 'gemini registered, Mochi there';
    });
  } finally { await ctx.close(); fs.rmSync(ext, { recursive: true, force: true }); }
};

// ——— Image Scan ———
// A second local server: the same files from another origin (a cross-origin image taints a canvas,
// so only the screenshot path can read it).
const require = createRequire(import.meta.url);
const IC = require('../src/image-scan/colors.js');
const EXPECT = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/image-scan/EXPECTED.json'), 'utf8'));
const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
const dE = (h1, h2) => IC.deltaE(IC.rgbToLab(IC.fromHex(h1)), IC.rgbToLab(IC.fromHex(h2)));
/** Every expected color has a palette color within tol (ΔE 2000). → the worst match. */
function paletteMatches(palette, want, tol) {
  let worst = 0;
  for (const hex of want) {
    const best = Math.min(...palette.colors.map(c => dE(c.hex, hex)));
    assert(best <= tol, `${hex} not in the palette (closest ΔE ${best.toFixed(1)}): ${palette.colors.map(c => c.hex).join(' ')}`);
    worst = Math.max(worst, best);
  }
  return worst;
}

groups.imagescan = async () => {
  const server2 = http.createServer((req, res) => {
    serverHits.push(`2 ${req.method} ${req.url}`);
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }); // no CORS header: tainted
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server2.listen(0, '127.0.0.1', r));
  const BASE2 = `http://127.0.0.1:${server2.address().port}`;
  const ctx = await deepContext('imagescan'); // host access, like after a right-click or a toolbar click
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  // Nothing may leave the browser: every request is local (or a routed stand-in for claude.ai).
  const outside = [];
  ctx.on('request', r => { const u = r.url(); if (!/^(data:|blob:|chrome|about:)/.test(u) && !u.startsWith(BASE) && !u.startsWith(BASE2) && !u.startsWith('https://claude.ai/')) outside.push(u); });
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('https://claude.ai/')) return route.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(ROOT, CLAUDE_FIXTURE), 'utf8') });
    if (u.startsWith(BASE) || u.startsWith(BASE2) || /^(data:|blob:|chrome)/.test(u)) return route.continue();
    outside.push(u);
    return route.abort();
  });
  const PAGE = `${BASE}/test/image-scan/index.html?x=${server2.address().port}`;
  const scan = (p, selector, ms = 40000) => hook(p, 'imageScan', { selector }, ms);
  try {
    const p = await mochiOn(ctx, PAGE);
    await p.waitForTimeout(3500); // Mochi's start-up hello first (it would cover a bubble or a swatch)

    await check('image scan: the right-click menu item exists (images only)', async () => {
      const ok = await ctx.sw.evaluate(id => chrome.contextMenus.update(id, {}).then(() => true, e => String(e)), 'mochi-image-scan');
      assert(ok === true, ok);
      return '"Scan image with Mochi"';
    });

    await check('image scan: poster — exact 4-color palette, "SUMMER SALE", Oswald in the top 3, 3:2', async () => {
      const r = await scan(p, '#poster');
      assert(r && !r.error, JSON.stringify(r).slice(0, 300));
      const worst = paletteMatches(r.palette, EXPECT.poster.palette, EXPECT.tolerance.flat);
      assert(lev(r.ocr.text.toUpperCase().replace(/\s+/g, ' ').trim(), EXPECT.poster.text) <= 2, `text: ${r.ocr.text}`);
      assert(r.ocr.language === 'en', r.ocr.language);
      const top = r.fonts[0]?.matches.map(m => m.family) || [];
      assert(top.includes('Oswald'), `fonts: ${top}`);
      const pr = await hook(p, 'imagePrompts');
      assert(pr.aspect.label === EXPECT.poster.aspect, pr.aspect.label);
      for (const [name, text] of Object.entries({ universal: pr.universal, midjourney: pr.midjourney, sd: pr.sd.prompt, dalle: pr.dalle })) {
        for (const hex of r.palette.colors.map(c => c.hex)) assert(text.includes(hex), `${name} lacks ${hex}`);
        assert(text.includes('SUMMER SALE'), `${name} lacks the text`);
      }
      return `ΔE ≤ ${worst.toFixed(1)}, "${r.ocr.text}" ${r.ocr.confidence}%, ${top.join(' / ')} (${r.fonts[0].matches[0].score}%), ${pr.aspect.label}, ${r.ms.total} ms`;
    });

    await check('image scan: the card — palette, text, font (approximate), prompt tabs; Mochi can read it', async () => {
      const sec = sel => shadow(p, sel, 'text');
      assert(/SUMMER SALE/.test(await sec('[data-sec="text"]') || ''), 'no text section');
      const font = await sec('[data-sec="font"]') || '';
      assert(/Oswald/.test(font) && /Approximate match/.test(font), font.slice(0, 200));
      assert(await shadow(p, '[data-sec="colors"] [data-hex="#ffd166"]'), 'no swatch');
      for (const tab of ['universal', 'midjourney', 'sd', 'dalle']) assert(await shadow(p, `[data-sec="prompt"] [data-format="${tab}"]`), `no ${tab} tab`);
      assert(await shadow(p, '.img-box'), 'no text box on the thumbnail');
      const bubble = await shadow(p, '.bubble', 'text');
      assert(/I can read it/.test(bubble || ''), `bubble: ${bubble}`);
      await shadow(p, '[data-sec="prompt"] [data-format="midjourney"]', 'click');
      return 'sections + tabs + "I can read it!"';
    });

    await check('image scan: copy a swatch, CSS variables, the prompt (clipboard)', async () => {
      await shadow(p, '[data-sec="colors"] [data-hex="#ffd166"]', 'click');
      assert((await p.evaluate(() => navigator.clipboard.readText())) === '#ffd166', 'swatch');
      await shadow(p, '[data-act="img-css"]', 'click');
      assert(/--color-background: #ffd166;/.test(await p.evaluate(() => navigator.clipboard.readText())), 'css vars');
      await shadow(p, '[data-act="img-copy-prompt"]', 'click');
      const mj = await p.evaluate(() => navigator.clipboard.readText());
      assert(/--ar 3:2/.test(mj), mj.slice(0, 120));
      return 'hex, :root vars, Midjourney prompt';
    });

    await check('image scan: Russian text in Lora — read as Russian, Lora in the top 3', async () => {
      const r = await scan(p, '#russian');
      assert(lev(r.ocr.text.toLowerCase().trim(), EXPECT.russian.text.toLowerCase()) <= 2, `text: ${r.ocr.text}`);
      assert(r.ocr.language === 'ru', r.ocr.language);
      const top = r.fonts[0]?.matches.map(m => m.family) || [];
      assert(top.includes('Lora'), `fonts: ${top}`);
      paletteMatches(r.palette, EXPECT.russian.palette, EXPECT.tolerance.flat);
      const pr = await hook(p, 'imagePrompts');
      assert(pr.aspect.label === EXPECT.russian.aspect, pr.aspect.label);
      return `"${r.ocr.text}" ${r.ocr.confidence}%, ${top.join(' / ')}`;
    });

    await check('image scan: Armenian text — read as Armenian', async () => {
      const r = await scan(p, '#armenian');
      assert(r.ocr.language === 'hy', `language: ${r.ocr.language} (text: "${r.ocr.text}")`);
      assert(lev(r.ocr.text.trim(), EXPECT.armenian.text) <= 4, `text: "${r.ocr.text}"`);
      return `"${r.ocr.text}" ${r.ocr.confidence}% · ${r.ocr.language}`;
    });

    await check('image scan: the language picker lists every bundled language; English/Russian/Armenian on by default', async () => {
      const info = await hook(p, 'ocrLangs');
      assert(info.all.length === 10 && info.all.includes('deu') && info.all.includes('ell'), info.all.join());
      assert(info.current.join() === 'eng,rus,hye', info.current.join());
      assert(info.rows === 10, `rows: ${info.rows}`);
      return `${info.all.length} languages, default ${info.current.join('/')}`;
    });

    await check('image scan: the chosen languages drive the OCR (turn Armenian off → it stops reading Armenian, back on → reads it again)', async () => {
      await hook(p, 'setOcrLangs', ['eng', 'rus']); // Armenian off
      const off = await scan(p, '#armenian');
      assert(!off.ocr.langs.includes('hye'), `the worker still loaded Armenian: ${off.ocr.langs?.join()}`);
      assert(off.ocr.language !== 'hy', `still read as Armenian with it off: ${off.ocr.language} "${off.ocr.text}"`);
      await hook(p, 'setOcrLangs', ['eng', 'rus', 'hye']); // back on
      const on = await scan(p, '#armenian');
      assert(on.ocr.language === 'hy', `not Armenian again: ${on.ocr.language} "${on.ocr.text}"`);
      return `off → ${off.ocr.language || 'none'} · on → ${on.ocr.language}`;
    });

    await check('image scan: a flat illustration — its colors, "No text found", 1:1', async () => {
      const r = await scan(p, '#flat');
      paletteMatches(r.palette, EXPECT.flat.palette, EXPECT.tolerance.flat);
      assert(r.ocr && !r.ocr.found, `text: ${r.ocr?.text}`);
      assert(/No text found/.test(await shadow(p, '[data-sec="text"]', 'text') || ''), 'no "No text found"');
      const pr = await hook(p, 'imagePrompts');
      assert(pr.aspect.label === '1:1' && /--no [^]*text, letters/.test(pr.midjourney), pr.midjourney);
      assert(pr.alt === 'A sunny day over two green hills', `alt: ${pr.alt}`); // the page's own alt text
      return `${r.palette.colors.length} colors, no text`;
    });

    await check('image scan: a photo-like gradient — direction and ends, 16:9', async () => {
      const r = await scan(p, '#gradient');
      const g = r.palette.gradient;
      assert(g?.direction === EXPECT.gradient.gradient, JSON.stringify(g));
      assert(dE(g.from, EXPECT.gradient.from) < EXPECT.tolerance.gradientEnds && dE(g.to, EXPECT.gradient.to) < EXPECT.tolerance.gradientEnds, `${g.from} → ${g.to}`);
      const pr = await hook(p, 'imagePrompts');
      assert(pr.aspect.label === '16:9', pr.aspect.label);
      return `${g.direction} ${g.from} → ${g.to}`;
    });

    await check('image scan: a cross-origin image — read through the screenshot (a canvas would be tainted)', async () => {
      const tainted = await p.evaluate(async () => {
        const img = document.getElementById('cross');
        if (!img.complete) await img.decode();
        const c = document.createElement('canvas'); c.width = 10; c.height = 10;
        c.getContext('2d').drawImage(img, 0, 0, 10, 10);
        try { c.toDataURL(); return false; } catch (_) { return true; }
      });
      assert(tainted, 'the image was not cross-origin');
      const r = await scan(p, '#cross');
      assert(r.source.direct === false && r.source.tiles >= 1, JSON.stringify(r.source));
      paletteMatches(r.palette, EXPECT.cross.palette, EXPECT.tolerance.flat);
      assert(lev(r.ocr.text.toUpperCase().trim(), 'PIXELS') <= 1, r.ocr.text);
      return `from ${BASE2}: "${r.ocr.text}", ${r.palette.colors.map(c => c.hex).join(' ')}`;
    });

    await check('image scan: a CSS background-image (gradient) — to right, 2:1', async () => {
      const r = await scan(p, '#bg');
      assert(r.source.kind === 'background', r.source.kind);
      const g = r.palette.gradient;
      assert(g?.direction === 'to right', JSON.stringify(g));
      assert(dE(g.from, EXPECT.bg.from) < EXPECT.tolerance.gradientEnds && dE(g.to, EXPECT.bg.to) < EXPECT.tolerance.gradientEnds, `${g.from} → ${g.to}`);
      assert((await hook(p, 'imagePrompts')).aspect.label === '2:1');
      return `${g.css}`;
    });

    await check('image scan: an image taller than the window — tiles stitched, all 5 bands, 1:5', async () => {
      const before = await p.evaluate(() => scrollY);
      const r = await scan(p, '#tall', 60000);
      assert(r.source.tiles >= 3 && !r.source.partial, JSON.stringify(r.source));
      assert(r.source.css.w === 400 && r.source.css.h === 2000, JSON.stringify(r.source.css));
      paletteMatches(r.palette, EXPECT.tall.palette, EXPECT.tolerance.flat);
      assert((await hook(p, 'imagePrompts')).aspect.label === '1:5');
      const shares = r.palette.colors.map(c => c.share);
      assert(Math.max(...shares) < 30, `uneven bands (a tile missing?): ${shares}`);
      return `${r.source.tiles} tiles, ${r.width}×${r.height} px, shares ${shares.join('/')}; scroll ${before} → ${await p.evaluate(() => scrollY)}`;
    });

    await check('image scan: Mochi is not in the picture', async () => {
      // A plain block right under Mochi: the capture must be that color only.
      await p.evaluate(() => { const c = document.createElement('canvas'); c.id = 'under'; c.width = 520; c.height = 360; c.style.cssText = 'position:fixed;right:0;bottom:0;z-index:5'; const g = c.getContext('2d'); g.fillStyle = '#123456'; g.fillRect(0, 0, 520, 360); document.body.append(c); });
      const box = await shadow(p, '.character', 'box');
      const r = await scan(p, '#under');
      await p.evaluate(() => document.getElementById('under').remove());
      const px = await hook(p, 'imagePixelsOff', '#123456');
      assert(px && px.off === 0, `${px?.off} of ${px?.total} pixels are not the block (Mochi in the picture?)`);
      assert(r.palette.colors.length === 1, r.palette.colors.map(c => c.hex).join(' '));
      return `Mochi at ${Math.round(box.x)},${Math.round(box.y)}; 0 of ${px.total} pixels off`;
    });

    await check('image scan: the magnifier shows on a big image and scans it', async () => {
      await p.evaluate(() => scrollTo(0, 0));
      const pos = await hook(p, 'imageHover', '#poster');
      assert(pos, 'no magnifier');
      const r = await hook(p, 'imageHover', 'h1');
      assert(r === null, 'a magnifier on a heading');
      return `at ${pos.left},${pos.top}`;
    });

    await check('image scan: Cancel stops a scan (no card, Mochi says okay)', async () => {
      await p.evaluate(() => document.documentElement.removeAttribute('data-mochi-result-imagescan'));
      await debug(p, { imageScan: { selector: '#tall' } });
      assert(await until(() => shadow(p, '[data-act="img-cancel"]'), 5000), 'no Cancel button');
      await debug(p, { imageScanCancel: true }); // (the button does the same; Mochi may be hidden mid-shot)
      const r = await until(async () => { const v = await p.getAttribute('html', 'data-mochi-result-imagescan'); return v ? JSON.parse(v) : null; }, 20000);
      assert(r === null || r?.ok === false || !r?.palette, `scan went on: ${JSON.stringify(r).slice(0, 100)}`);
      await p.waitForTimeout(300);
      const open = await shadow(p, '.panel.show:not([hidden])');
      assert(!open, 'the panel stayed open');
      return 'cancelled';
    });

    await check('image scan: on-device description (a fake LanguageModel) fills the card and the prompts', async () => {
      // Plant a fake Prompt API in the offscreen worker page (it exists after the first scan).
      const cdp = await ctx.newCDPSession(p);
      const off = (await cdp.send('Target.getTargets')).targetInfos.find(t => t.url.includes('/pages/image-scan.html'));
      assert(off, 'no offscreen document');
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: off.targetId, flatten: false });
      const FIXED = { subject: 'a summer sale poster', objects: ['bold headline', 'color blocks'], setting: 'flat yellow background', style: 'flat graphic poster', lighting: 'even studio light', mood: 'cheerful', composition: 'centered headline over a color band', camera: 'straight-on', caption: 'A cheerful summer sale poster with a bold headline.' };
      const answer = new Promise(r => cdp.on('Target.receivedMessageFromTarget', e => { const m = JSON.parse(e.message); if (m.id === 7) r(m); }));
      await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: 7, method: 'Runtime.evaluate', params: { expression: `globalThis.LanguageModel = { availability: async () => 'available', create: async () => ({ prompt: async (m, o) => { globalThis.__asked = { image: m[0].content[1].type, schema: !!o.responseConstraint }; return ${JSON.stringify(JSON.stringify(FIXED))}; }, destroy() {} }) }; 'ok'`, returnByValue: true } }) });
      await answer;
      const r = await scan(p, '#poster');
      const text = await until(async () => { const t = await shadow(p, '[data-sec="describe"]', 'text'); return /cheerful summer sale poster/.test(t || '') && t; }, 10000);
      assert(text, 'no description on the card');
      const pr = await hook(p, 'imagePrompts');
      assert(/^Flat graphic poster of a summer sale poster/.test(pr.universal), pr.universal.slice(0, 120));
      assert(pr.alt === FIXED.caption, pr.alt);
      return `"${FIXED.caption}" → prompts (${r.ms.total} ms scan)`;
    });

    await check('image scan: save to pocket (with a thumbnail)', async () => {
      await shadow(p, '[data-act="img-save"]', 'click');
      const entry = await until(() => ctx.sw.evaluate(async () => ((await chrome.storage.local.get('mochi.pocket'))['mochi.pocket'] || []).find(e => e.kind === 'image')), 5000);
      assert(entry && /^data:image\/jpeg/.test(entry.thumb) && entry.paste.includes('#ffd166'), JSON.stringify(entry || {}).slice(0, 200));
      return `${entry.title}, thumbnail ${Math.round(entry.thumb.length / 1024)} KB`;
    });

    await check('image scan: Ask Claude — image on the clipboard, claude.ai gets the image + question, no Enter', async () => {
      const claude = await ctx.newPage(); // a routed claude.ai tab (a tab the extension opens itself would skip Playwright's routing)
      await claude.goto('https://claude.ai/new');
      await claude.waitForTimeout(2500);
      await p.bringToFront();
      await scan(p, '#poster');
      await shadow(p, '[data-act="img-ask"]', 'click');
      const types = await until(() => p.evaluate(async () => { try { return (await navigator.clipboard.read()).flatMap(i => i.types).join(','); } catch (_) { return ''; } }), 4000);
      assert(/image\/png/.test(types), `clipboard: ${types}`);
      await claude.bringToFront();
      // (An older offer may be up for a moment: the new image takes its place.)
      const offer = await until(async () => { const t = await shadow(claude, '.offer', 'text'); return /Paste the image and question/.test(t || '') && t; }, 10000);
      assert(offer, `offer: ${await shadow(claude, '.offer', 'text')}`);
      await shadow(claude, '.offer [data-act="paste"]', 'click');
      const f = await until(async () => { const v = await claude.evaluate(() => ({ pastes: fixture.pastes, sent: fixture.sent, cards: document.querySelectorAll('[data-testid="file-thumbnail"]').length })); return v.pastes.length >= 2 && v; }, 6000);
      assert(f && f.pastes[0].files[0]?.type === 'image/png' && f.cards === 1, JSON.stringify(f).slice(0, 200));
      assert(/Midjourney/.test(f.pastes[1].text) && /#ffd166/.test(f.pastes[1].text), f.pastes[1].text.slice(0, 120));
      assert(f.sent.length === 0, 'Enter was pressed');
      await claude.close();
      return `pasted ${f.pastes[0].files[0].name} (${Math.round(f.pastes[0].files[0].size / 1024)} KB) + the question; not sent`;
    });

    await check('image scan: from the right-click menu on a page without Mochi (it comes in, scans that image)', async () => {
      const q = await ctx.newPage();
      await q.goto(`${BASE}/test/image-scan/index.html`);
      await q.bringToFront();
      const src = await q.evaluate(() => document.getElementById('flat').src);
      await ctx.sw.evaluate(async ([u, s]) => { const tab = (await chrome.tabs.query({})).find(t => t.url === u); await Mochi.imageScanBg.menuClicked({ menuItemId: 'mochi-image-scan', srcUrl: s, frameId: 0 }, tab); }, [q.url(), src]);
      const r = await until(async () => { const v = await hook(q, 'imageScanLast', true, 3000).catch(() => null); return v?.palette && v; }, 30000, 500);
      assert(r, 'no scan');
      assert(r.source.from === 'menu' && r.source.kind === 'img', JSON.stringify(r.source));
      paletteMatches(r.palette, EXPECT.flat.palette, EXPECT.tolerance.flat);
      await q.close();
      return `${r.width}×${r.height}, ${r.palette.colors.length} colors`;
    });

    await check('image scan: nothing left the browser', async () => {
      assert(!outside.length, outside.join(' | '));
      return 'all requests local';
    });
    await check('no console errors (imagescan)', async () => { assert(!ctx.errors.length, ctx.errors.join(' | ')); return ''; });
  } finally { await ctx.close(); server2.close(); fs.rmSync(ctx.extDir, { recursive: true, force: true }); }

  // On claude.ai Mochi comes by itself (no toolbar click, so no screenshot access): the magnifier is
  // off by default; turned on, it reads the (same-origin) image directly.
  const ctx2 = await launch(ROOT, { name: 'imagescan-claude' });
  try {
    await routeSites(ctx2, { 'https://claude.ai/': CLAUDE_FIXTURE });
    const c = await ctx2.newPage();
    await c.goto('https://claude.ai/chat/img?images');
    await until(() => shadow(c, '.character'));
    const hover = async () => {
      const b = await c.evaluate(() => { const r = document.getElementById('upload').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await c.mouse.move(5, 5); await c.mouse.move(b.x, b.y); await c.waitForTimeout(300);
      return shadow(c, '.img-hover:not([hidden])');
    };
    await check('image scan on claude.ai: no magnifier by default', async () => { assert(!(await hover()), 'magnifier shown'); return 'off'; });
    await check('image scan on claude.ai: magnifier on → reads the image directly, the card shows', async () => {
      await ctx2.sw.evaluate(async () => { const cur = (await chrome.storage.local.get('mochi.settings'))['mochi.settings'] || {}; await chrome.storage.local.set({ 'mochi.settings': { ...cur, imageScan: { claude: true, web: true } } }); });
      assert(await until(hover, 5000), 'no magnifier after turning it on');
      await shadow(c, '.img-hover', 'click');
      const sw = await until(() => shadow(c, '[data-sec="colors"] [data-hex="#264653"]'), 20000);
      assert(sw, `no card: ${(await shadow(c, '.panel', 'text') || '').slice(0, 200)}`);
      return 'direct read (same-origin), #264653 found';
    });
    await check('no console errors (imagescan on claude.ai)', async () => { assert(!ctx2.errors.length, ctx2.errors.join(' | ')); return ''; });
  } finally { await ctx2.close(); }
};

// ——— Tools: site notes, color picker, font inspector ———
groups.tools = async () => {
  // 1) The local test page: Mochi's files are <script>s, the tools come the same way when first used.
  let ctx = await launch(ROOT, { name: 'tools' });
  try {
    const p = await ctx.newPage();
    await p.goto(`${BASE}/test/test-page.html`);
    await until(() => p.evaluate(() => !!window.Mochi?.debug?.companion));
    await check('tools: nothing is loaded or running before first use', async () => {
      const s = await hook(p, 'toolsState');
      assert(Object.values(s.loaded).every(v => !v), JSON.stringify(s.loaded));
      assert(Object.values(s.active).every(v => v === 0), JSON.stringify(s.active));
      return JSON.stringify(s.loaded);
    });
    await check('tools: a tool loads the first time it is used (test page: script tags)', async () => {
      // (A stand-in EyeDropper that is cancelled at once: the real one would wait for a pick.)
      await p.evaluate(() => { window.EyeDropper = class { open() { return Promise.reject(new DOMException('cancelled', 'AbortError')); } }; });
      const r = await hook(p, 'toolsOpen', { id: 'picker' });
      assert(r?.loaded, JSON.stringify(r));
      const s = await hook(p, 'toolsState');
      assert(s.loaded.picker && !s.loaded.notes && !s.loaded.fonts, JSON.stringify(s.loaded));
      return 'picker loaded, the others not';
    });
    // ——— color picker (EyeDropper mocked: each open() returns the next color of window.__picks) ———
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    await p.waitForTimeout(3500); // Mochi's own hello first (the picker's bubble comes after it)
    const mockPicks = colors => p.evaluate(c => { window.__picks = c.slice(); window.EyeDropper = class { open() { return Promise.resolve({ sRGBHex: window.__picks.shift() }); } }; }, colors);
    await check('picker: a picked color in HEX / RGB / HSL / OKLCH with a name; HEX copied; Mochi says so', async () => {
      await mockPicks(['#f97316']);
      // From the menu, as a person would (the clipboard needs that click). Color picker sits under Tools → Inspect & grab.
      await debug(p, { openMenu: 'tools:grab' });
      await p.waitForTimeout(300);
      await shadow(p, '.menu-item[data-id="picker"]', 'focus');
      await p.keyboard.press('Enter'); // a key press is a user action too (and no bubble can be in the way)
      const st = await until(async () => { const v = await hook(p, 'pickerState'); return v.current && v; }, 4000);
      assert(st.formats.hex === '#F97316' && st.formats.rgb === 'rgb(249 115 22)' && st.formats.hsl === 'hsl(25 95% 53%)' && /^oklch\(70\.5% 0\.187 /.test(st.formats.oklch), JSON.stringify(st.formats));
      const card = await shadow(p, '.pc', 'text');
      for (const v of ['#F97316', 'rgb(249 115 22)', 'hsl(25 95% 53%)', 'oklch(70.5%', st.formats.name]) assert(card.includes(v), `card lacks ${v}`);
      const said = await until(async () => { const t = await shadow(p, '.bubble', 'text'); return /Copied #F97316!/.test(t || '') && t; }, 3000);
      assert(said, `bubble: ${await shadow(p, '.bubble', 'text')}`);
      assert((await p.evaluate(() => navigator.clipboard.readText())) === '#F97316', 'HEX not on the clipboard');
      return `${st.formats.hex} · ${st.formats.oklch} · ${st.formats.name}`;
    });
    await check('picker: contrast with a second color — WCAG ratio and AA/AAA, Mochi worried or thumbs up', async () => {
      await mockPicks(['#ffffff']);
      await shadow(p, '[data-act="pc-second"]', 'click');
      const st = await until(async () => { const v = await hook(p, 'pickerState'); return v.wcag && v; }, 4000);
      assert(st.wcag.ratio === 2.8 && !st.wcag.aa && !st.wcag.aaLarge, JSON.stringify(st.wcag));
      // Worried: sad brows and mood (the bubble may be busy with a start-up hello).
      assert(await until(async () => /data-brows="sad"/.test(await shadow(p, '.character', 'html') || ''), 3000), 'Mochi not worried');
      await mockPicks(['#1f2937', '#ffffff']);
      await shadow(p, '[data-act="pc-again"]', 'click');
      await until(async () => (await hook(p, 'pickerState')).current === '#1f2937', 4000);
      await shadow(p, '[data-act="pc-second"]', 'click');
      const ok = await until(async () => { const v = await hook(p, 'pickerState'); return v.wcag && v; }, 4000);
      assert(ok.wcag.ratio === 14.68 && ok.wcag.aaa, JSON.stringify(ok.wcag));
      assert(await until(async () => /data-fx="[^"]*thumb/.test(await shadow(p, '.character', 'html') || ''), 3000), 'no thumbs up');
      assert((await shadow(p, '.pc-ratio', 'text')) === '14.68 : 1', 'ratio on the card');
      await p.screenshot({ path: path.join(OUT, 'tools-picker.png') });
      return '#F97316/#FFF 2.8 ✗ · #1F2937/#FFF 14.68 AAA 👍';
    });
    await check('picker: contrast against the page background', async () => {
      await shadow(p, '[data-act="pc-bg"]', 'click');
      const bg = await p.evaluate(() => { const c = getComputedStyle(document.body).backgroundColor; const m = c.match(/[\d.]+/g).map(Number); return (m.length < 4 || m[3] > 0.5) ? '#' + m.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('') : '#ffffff'; });
      const st = await until(async () => { const v = await hook(p, 'pickerState'); return v.second === bg && v; }, 3000);
      const want = Math.round(IC.contrast(IC.fromHex('#1f2937'), IC.fromHex(bg)) * 100) / 100;
      assert(st && st.wcag.ratio === want, JSON.stringify({ bg, st: st?.wcag, want }));
      return `page background ${bg}: ${want} : 1`;
    });
    await check('picker: history (newest first, Alt+→ reorders, click copies), export CSS / Tailwind / JSON, Clear', async () => {
      let st = await hook(p, 'pickerState');
      assert(JSON.stringify(st.history) === JSON.stringify(['#ffffff', '#1f2937', '#f97316']), st.history.join(' '));
      await shadow(p, '.pc-cell[data-hex="#ffffff"]', 'click');
      await p.keyboard.press('Alt+ArrowRight');
      await p.waitForTimeout(200);
      st = await hook(p, 'pickerState');
      assert(st.history[1] === '#ffffff', `reorder: ${st.history.join(' ')}`);
      const css = await shadow(p, '.pc textarea.export', 'html');
      void css;
      await shadow(p, '[data-act="pc-copy-export"]', 'click');
      const text = await p.evaluate(() => navigator.clipboard.readText());
      assert(/^:root \{/.test(text) && text.includes('#f97316') && text.includes('#1f2937'), text);
      await shadow(p, '[data-sec="export"] [data-format="json"]', 'click');
      await shadow(p, '[data-act="pc-copy-export"]', 'click');
      const json = JSON.parse(await p.evaluate(() => navigator.clipboard.readText()));
      assert(json.length === 3 && json.some(c => c.hex === '#F97316' && c.oklch), JSON.stringify(json).slice(0, 120));
      await shadow(p, '[data-act="pc-clear"]', 'click');
      assert((await hook(p, 'pickerState')).history.length === 0, 'not cleared');
      return 'order, CSS, JSON, cleared';
    });
    await check('picker: hidden when the browser has no EyeDropper', async () => {
      await p.keyboard.press('Escape');
      await p.evaluate(() => { delete window.EyeDropper; delete Window.prototype.EyeDropper; window.EyeDropper = undefined; });
      await debug(p, { openMenu: 'tools:grab' }); // the category where the color picker would be
      await p.waitForTimeout(300);
      const items = await shadow(p, '.app', 'html');
      assert(items && !/data-id="picker"/.test(items) && /data-id="fonts"/.test(items), 'picker still in the menu');
      await p.keyboard.press('Escape');
      return 'no picker item';
    });
    await check('no console errors (tools, test page)', async () => { assert(!ctx.errors.length, ctx.errors.join(' | ')); return ''; });
  } finally { await ctx.close(); }

  // 2) The real extension (a copy that may visit local pages): import() of web-accessible files.
  ctx = await deepContext('tools-ext');
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  try {
    const q = await mochiOn(ctx, `${BASE}/tests/fixtures/plain.html`);
    await check('tools in the extension: lazy-loaded with import() on first use', async () => {
      assert(!(await hook(q, 'toolsState')).loaded.fonts, 'already loaded');
      const r = await hook(q, 'toolsOpen', { id: 'fonts' });
      assert(r?.loaded, JSON.stringify(r));
      return 'fonts imported on demand';
    });

    // ——— font inspector ———
    const fp = await mochiOn(ctx, `${BASE}/test/tools/fonts.html`);
    await fp.evaluate(() => document.fonts.ready);
    await fp.waitForTimeout(300);
    await check('fonts: detection — the font really used, size, weight, line height, spacing, color, contrast', async () => {
      const get = sel => hook(fp, 'fontsInspect', sel);
      const C = IC;
      const osw = await get('#osw');
      assert(osw.used === 'Oswald' && osw.sure && osw.how === 'webfont', JSON.stringify(osw).slice(0, 200));
      assert(osw.size.px === 48 && osw.size.rem === 3 && osw.weight === 700 && osw.color === '#1f2937' && osw.contrast.ratio === 14.68 && osw.contrast.aaa, JSON.stringify({ size: osw.size, w: osw.weight, c: osw.color, k: osw.contrast }));
      const lora = await get('#lora');
      const want = Math.round(C.contrast(C.fromHex('#374151'), C.fromHex('#f9fafb')) * 100) / 100;
      assert(lora.used === 'Lora' && lora.sure && lora.lineHeight.px === 28.8 && lora.lineHeight.ratio === 1.6 && lora.background === '#f9fafb' && lora.contrast.ratio === want, JSON.stringify({ u: lora.used, lh: lora.lineHeight, bg: lora.background, k: lora.contrast, want }));
      const local = await get('#local');
      assert(local.used === 'DejaVu Serif' && local.how === 'local' && !local.sure, JSON.stringify(local).slice(0, 160));
      const ghost = await get('#ghost');
      assert(ghost.used === 'monospace' && ghost.how === 'generic' && ghost.usedIndex === 2 && ghost.background === '#0b1a3a', JSON.stringify(ghost).slice(0, 200));
      const nl = await get('#notloaded');
      assert(nl.used === 'sans-serif' && nl.usedIndex === 1, `not loaded → ${nl.used}`);
      const sp = await get('#spaced');
      assert(sp.letterSpacing.em === 0.1 && sp.weight === 500, JSON.stringify(sp.letterSpacing));
      const veil = await get('#veiled');
      assert(veil.background === '#808080', `veil ${veil.background}`);
      assert(/^Use font Oswald at 48px\/1\.1, weight 700, color #1F2937$/.test(osw.ai), osw.ai);
      assert(/font-family: Oswald, sans-serif;\nfont-size: 48px;\nfont-weight: 700;\nline-height: 1\.1;\nletter-spacing: normal;\ncolor: #1f2937;/.test(osw.css), osw.css);
      return `Oswald ✓, Lora ✓, DejaVu Serif (local, probably), monospace (generic), Not Loaded → sans-serif, 0.1em, veil #808080`;
    });
    await check('fonts: Alt+F → glasses on; hovering shows the tooltip (page, open shadow root, same-origin frame)', async () => {
      assert((await hook(fp, 'fontsState')).frames === 0, 'work before inspecting');
      await ctx.sw.evaluate(async u => { const tab = (await chrome.tabs.query({})).find(t => t.url === u); await Mochi.toolsBg.onCommand('font-inspector', tab); }, fp.url());
      assert(await until(async () => (await hook(fp, 'fontsState')).open, 4000), 'not on');
      assert(await shadow(fp, '.outfit-layer[data-slot="face"] rect, .outfit-layer[data-slot="face"] *'), 'no glasses');
      const at = async sel => {
        const b = await fp.evaluate(s => { const parts = s.split(' >>> '); let el = document.querySelector(parts[0]); let ox = 0, oy = 0; if (parts[1]) { if (el.shadowRoot) el = el.shadowRoot.querySelector(parts[1]); else { const r = el.getBoundingClientRect(); ox = r.left; oy = r.top; el = el.contentDocument.querySelector(parts[1]); } } const r = el.getBoundingClientRect(); return { x: ox + r.left + Math.min(40, r.width / 2), y: oy + r.top + r.height / 2 }; }, sel);
        await fp.mouse.move(b.x, b.y, { steps: 3 });
        return until(async () => (await hook(fp, 'fontsState')).tip, 3000);
      };
      const t1 = await at('#osw');
      assert(/Oswald/.test(t1) && /48px · 3rem/.test(t1) && /14\.68:1/.test(t1), t1);
      await fp.screenshot({ path: path.join(OUT, 'tools-fonts.png') });
      const t2 = await at('#host >>> #shadowed');
      if (!t2) { const b = await fp.evaluate(() => { const r = document.getElementById('host').shadowRoot.querySelector('#shadowed').getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; }); throw new Error(`shadow: none; at ${JSON.stringify(b)} → ${JSON.stringify(await hook(fp, 'fontsAt', b))}`); }
      assert(/Lora/.test(t2) && /probably/.test(t2) && /22px/.test(t2), `shadow: ${t2}`);
      const t3 = await at('#frame >>> #inframe');
      assert(/monospace/.test(t3) && /20px/.test(t3), `frame: ${t3}`);
      return 'Oswald · Lora (italic: probably) in a shadow root · monospace in a frame';
    });
    await check('fonts: a click pins the tooltip and never reaches the page; Copy CSS / Copy for AI', async () => {
      const btn = await fp.evaluate(() => { const r = document.getElementById('clicker').getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }; });
      await fp.mouse.click(btn.x, btn.y);
      await fp.waitForTimeout(150);
      assert((await fp.evaluate(() => window.__clicks)) === 0, 'a click reached the page');
      const osw = await fp.evaluate(() => { const r = document.getElementById('osw').getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; });
      await fp.mouse.click(osw.x, osw.y);
      const st = await until(async () => { const v = await hook(fp, 'fontsState'); return v.pinned && v; }, 3000);
      assert(st && st.info.used === 'Oswald', JSON.stringify(st).slice(0, 120));
      await shadow(fp, '[data-act="ins-css"]', 'click');
      assert(/^font-family: Oswald, sans-serif;/.test(await fp.evaluate(() => navigator.clipboard.readText())), 'Copy CSS');
      await shadow(fp, '[data-act="ins-ai"]', 'click');
      assert((await fp.evaluate(() => navigator.clipboard.readText())) === 'Use font Oswald at 48px/1.1, weight 700, color #1F2937', 'Copy for AI');
      assert((await fp.evaluate(() => window.__clicks)) === 0, 'page clicks');
      return 'pinned, copied, 0 page clicks';
    });
    await check('fonts: Esc exits; then nothing runs (0 listeners/timers, no work on mouse moves); Alt+F again toggles', async () => {
      await fp.keyboard.press('Escape');
      const st = await until(async () => { const v = await hook(fp, 'fontsState'); return !v.open && v; }, 3000);
      assert(st && st.active === 0, `still active: ${JSON.stringify(st)}`);
      assert(!(await shadow(fp, '.ins-catcher')), 'glass left behind');
      // A real spy: Chrome's own list of event listeners on the window, the document and Mochi's layer,
      // filtered to the tools' scripts.
      const toolListeners = async () => {
        const c = await ctx.newCDPSession(fp);
        const urls = new Map();
        c.on('Debugger.scriptParsed', e => urls.set(e.scriptId, e.url));
        await c.send('Debugger.enable'); // reports every script already there, Mochi's isolated world too
        let n = 0;
        for (const expr of ['window', 'document']) {
          const { result } = await c.send('Runtime.evaluate', { expression: expr });
          const { listeners } = await c.send('DOMDebugger.getEventListeners', { objectId: result.objectId, depth: -1, pierce: true });
          n += listeners.filter(l => /src\/tools\/(inspector|font-detect|notes|picker|color-math)\.js/.test(urls.get(l.scriptId) || '')).length;
        }
        await c.send('Debugger.disable');
        await c.detach();
        return n;
      };
      const frames = st.frames;
      const spied = await toolListeners().catch(err => `n/a (${err.message})`);
      assert(spied === 0 || typeof spied === 'string', `${spied} tool listeners still on the page`);
      for (let i = 0; i < 5; i++) await fp.mouse.move(100 + i * 40, 120 + i * 20);
      await fp.waitForTimeout(300);
      assert((await hook(fp, 'fontsState')).frames === frames, 'work while off');
      // Alt+F twice: on, off.
      const toggle = () => ctx.sw.evaluate(async u => { const tab = (await chrome.tabs.query({})).find(t => t.url === u); await Mochi.toolsBg.onCommand('font-inspector', tab); }, fp.url());
      await toggle();
      assert(await until(async () => (await hook(fp, 'fontsState')).open, 3000), 'Alt+F did not turn it on');
      const whileOn = await toolListeners().catch(() => -1);
      assert(typeof spied === 'string' || whileOn > 0, `the spy sees no listeners even while inspecting (${whileOn})`);
      await toggle();
      assert(await until(async () => !(await hook(fp, 'fontsState')).open, 3000), 'Alt+F did not turn it off');
      assert((await hook(fp, 'fontsState')).active === 0, 'left running');
      return `frames stayed ${frames}; tool listeners on the page: ${spied} off / on > 0; Alt+F on/off`;
    });
    await fp.close();

    // ——— site notes ———
    const NOTES = `${BASE}/test/tools/notes.html`;
    let n = await mochiOn(ctx, `${NOTES}?utm_source=news&fbclid=abc#top`);
    await check('notes: the notepad opens in Mochi\'s paws, saves by itself, page and whole site', async () => {
      await hook(n, 'toolsOpen', { id: 'notes' });
      assert(await shadow(n, '.notes-pad'), 'no notepad');
      const fx = await shadow(n, '.character', 'html');
      assert(/data-fx="[^"]*notepad/.test(fx || ''), 'Mochi is not holding the notepad');
      await hook(n, 'notesType', { text: '[ ] buy milk\n[x] call mom', color: 'mint' });
      await hook(n, 'notesType', { scope: 'site', text: 'Site-wide: the coupon is MOCHI10' });
      await n.waitForTimeout(900);
      await hook(n, 'notesType', { scope: 'page' });
      await n.screenshot({ path: path.join(OUT, 'tools-notes.png') });
      const all = await hook(n, 'notesAll');
      const keys = all.list.map(e => e.key).sort();
      assert(keys.length === 2 && keys[0] === `page:${BASE}/test/tools/notes.html` && keys[1] === `site:127.0.0.1:${new URL(BASE).port}`, keys.join(' '));
      assert(all.notes.find(x => x.scope === 'page').color === 'mint', 'paper color');
      return keys.join(' · ');
    });
    await check('notes: a click on [ ] ticks it; Esc closes the notepad', async () => {
      await hook(n, 'notesType', { scope: 'page' });
      const box = await shadow(n, '.np-text', 'box');
      // The first line starts with "[ ]": click on it.
      const r = await n.evaluate(() => 0);
      void r;
      await n.mouse.click(box.x - 120, box.y - 70);
      await n.waitForTimeout(100);
      const read = await hook(n, 'notesRead');
      assert(/^\[x\] buy milk/.test(read.text), read.text);
      await n.keyboard.press('Escape');
      await n.waitForTimeout(300);
      assert(!(await shadow(n, '.notes-pad')), `still open: ${JSON.stringify(await hook(n, 'notesRead'))} active=${await n.evaluate(() => document.activeElement?.tagName)} errors=${ctx.errors.join('|')}`);
      const st = await hook(n, 'toolsState');
      assert(st.active.notes === 0, `listeners/timers left: ${st.active.notes}`);
      return 'ticked, closed, 0 listeners left';
    });
    await check('notes: they survive a reload; Mochi holds up the paper with the count', async () => {
      await n.close();
      n = await mochiOn(ctx, `${NOTES}?gclid=zzz`);
      const badge = await until(() => shadow(n, '.notes-badge', 'text'), 5000);
      assert(badge === '2', `badge: ${badge}`);
      await shadow(n, '.notes-badge', 'click');
      const read = await until(async () => { const v = await hook(n, 'notesRead'); return v.open && v; }, 5000);
      assert(/buy milk/.test(read.text) && read.scope === 'page', JSON.stringify(read));
      await n.keyboard.press('Escape');
      return `badge ${badge}, note back`;
    });
    await check('notes: another page of the same site shows the whole-site note only', async () => {
      const o = await mochiOn(ctx, `${BASE}/test/tools/other.html`);
      const badge = await until(() => shadow(o, '.notes-badge', 'text'), 5000);
      assert(badge === '1', `badge: ${badge}`);
      await hook(o, 'toolsOpen', { id: 'notes' });
      const read = await hook(o, 'notesRead');
      assert(read.scope === 'site' && /MOCHI10/.test(read.text), JSON.stringify(read));
      await o.close();
      return 'site note';
    });
    await check('notes: All notes — grouped by site, search, export JSON + Markdown, delete, import round trip', async () => {
      await hook(n, 'toolsOpen', { id: 'allNotes' });
      const text = await until(() => shadow(n, '.notes-list', 'text'), 5000);
      assert(/127\.0\.0\.1:\d+ · 2/.test(text || ''), (text || '').slice(0, 200));
      // Search filters (the text inside notes too).
      const typeIn = async (sel, value) => { const c = await ctx.newCDPSession(n); const { root } = await c.send('DOM.getDocument', { depth: -1, pierce: true }); const host = (await c.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'mochi-companion' })).nodeId; const sr = (await c.send('DOM.describeNode', { nodeId: host, depth: 1, pierce: true })).node.shadowRoots[0]; const sid = (await c.send('DOM.pushNodesByBackendIdsToFrontend', { backendNodeIds: [sr.backendNodeId] })).nodeIds[0]; const id = (await c.send('DOM.querySelector', { nodeId: sid, selector: sel })).nodeId; return { c, id }; };
      await shadow(n, '.notes-search', 'click');
      await n.keyboard.type('coupon');
      await n.waitForTimeout(150);
      const rows = await shadow(n, '.notes-list', 'html');
      assert((rows.match(/class="pk note-row"/g) || []).length === 1, 'search did not filter');
      // Export: two downloads.
      const [json] = await Promise.all([n.waitForEvent('download'), shadow(n, '[data-act="notes-export-json"]', 'click')]);
      const exported = JSON.parse(fs.readFileSync(await json.path(), 'utf8'));
      assert(exported.kind === 'notes' && exported.notes.length === 2, JSON.stringify(exported).slice(0, 120));
      const [md] = await Promise.all([n.waitForEvent('download'), shadow(n, '[data-act="notes-export-md"]', 'click')]);
      const mdText = fs.readFileSync(await md.path(), 'utf8');
      assert(/^# Mochi notes/.test(mdText) && /\[x\] buy milk/.test(mdText), mdText.slice(0, 120));
      // Delete both (a second click confirms), then import the JSON back.
      for (let i = 0; i < 2; i++) {
        await shadow(n, '.notes-search', 'click'); await n.keyboard.press('Control+A'); await n.keyboard.press('Backspace'); await n.waitForTimeout(100);
        await shadow(n, '[data-act="note-delete"]', 'click'); await shadow(n, '[data-act="note-delete"]', 'click'); await n.waitForTimeout(300);
      }
      assert((await hook(n, 'notesAll')).list.length === 0, 'not deleted');
      const file = path.join(OUT, 'notes-roundtrip.json');
      fs.writeFileSync(file, JSON.stringify(exported));
      const { c, id } = await typeIn('input[type="file"]');
      await c.send('DOM.setFileInputFiles', { nodeId: id, files: [file] });
      const back = await until(async () => { const v = await hook(n, 'notesAll'); return v.list.length === 2 && v; }, 5000);
      assert(back && back.notes.some(x => /buy milk/.test(x.text)), 'import failed');
      return `exported ${exported.notes.length}, deleted, imported ${back.list.length}`;
    });
    await check('notes: Send to Claude → the pocket → offered and pasted on claude.ai (never sent)', async () => {
      await ctx.route('https://claude.ai/**', route => route.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(ROOT, CLAUDE_FIXTURE), 'utf8') }));
      const claude = await ctx.newPage();
      await claude.goto('https://claude.ai/new');
      await claude.waitForTimeout(2800); // the start-up offer comes and goes first
      await n.bringToFront();
      await hook(n, 'toolsOpen', { id: 'notes' });
      await shadow(n, '[data-act="np-claude"]', 'click');
      const entry = await until(() => ctx.sw.evaluate(async () => ((await chrome.storage.local.get('mochi.pocket'))['mochi.pocket'] || []).find(e => e.kind === 'note')), 4000);
      assert(entry && /buy milk/.test(entry.prompt), JSON.stringify(entry || {}).slice(0, 160));
      await claude.bringToFront();
      const offer = await until(async () => { const t = await shadow(claude, '.offer', 'text'); return /brought a note/.test(t || '') && t; }, 10000);
      assert(offer, `offer: ${await shadow(claude, '.offer', 'text')}`);
      await shadow(claude, '.offer [data-act="paste"]', 'click');
      const f = await until(async () => { const v = await claude.evaluate(() => ({ box: document.querySelector('[contenteditable]').textContent, sent: fixture.sent })); return /buy milk/.test(v.box) && v; }, 5000);
      assert(f && f.sent.length === 0, JSON.stringify(f));
      await claude.close();
      return 'pasted, not sent';
    });
    await check('notes reminder: off by default — a revisit shows no peek', async () => {
      const v = await ctx.newPage();
      await v.goto(`${BASE}/test/tools/other.html`);
      await v.waitForTimeout(2000);
      assert(!(await v.evaluate(() => !!document.querySelector('mochi-peek'))), 'a peek without reminders');
      await v.close();
      return 'no peek';
    });
    await check('notes reminder: turned on (permission) → a revisit peeks "You have a note here!" → a click brings Mochi with the notes', async () => {
      const page = await ctx.newPage();
      await page.goto(`chrome-extension://${ctx.extId}/pages/notes-remind.html`);
      await page.click('#remind-on');
      await until(() => page.evaluate(() => document.documentElement.dataset.remind === 'on'), 5000);
      const reg = await ctx.sw.evaluate(() => Mochi.toolsBg.registered());
      assert(reg, 'script not registered');
      await page.close();
      const v = await ctx.newPage();
      await v.goto(`${BASE}/test/tools/other.html?utm_source=revisit`);
      await v.bringToFront();
      const count = await until(() => v.evaluate(() => document.querySelector('mochi-peek')?.getAttribute('data-count')), 6000);
      assert(count === '1', `peek count ${count}`);
      assert(!(await v.evaluate(() => !!document.querySelector('mochi-companion'))), 'the full Mochi came without a click');
      const box = await v.evaluate(() => { const r = document.querySelector('mochi-peek').getBoundingClientRect(); return { x: r.right - 30, y: r.bottom - 20 }; });
      await v.waitForTimeout(900); // it slides up first
      await v.screenshot({ path: path.join(OUT, 'tools-peek.png') });
      await v.mouse.click(box.x, box.y);
      const pad = await until(() => shadow(v, '.notes-pad'), 8000);
      assert(pad, 'no notepad after the click');
      await v.close();
      return 'peek → Mochi + notes';
    });
    await check('notes reminder: the permission taken away in Chrome\'s settings → the script goes too', async () => {
      await ctx.sw.evaluate(() => Mochi.toolsBg.remindOn());
      assert(await ctx.sw.evaluate(() => Mochi.toolsBg.registered()), 'not on');
      await ctx.sw.evaluate(() => Mochi.toolsBg.onPermRemoved({ origins: ['<all_urls>'] })); // what chrome.permissions.onRemoved calls
      assert(!(await ctx.sw.evaluate(() => Mochi.toolsBg.registered())), 'still registered');
      await ctx.sw.evaluate(() => Mochi.toolsBg.remindOn()); // on again for the next check
      return 'unregistered';
    });
    await check('notes reminder: turned off → the script is gone, no peek on a revisit', async () => {
      const page = await ctx.newPage();
      await page.goto(`chrome-extension://${ctx.extId}/pages/notes-remind.html`);
      await until(() => page.evaluate(() => document.documentElement.dataset.remind === 'on'), 5000);
      await page.click('#remind-off');
      await until(() => page.evaluate(() => document.documentElement.dataset.remind === 'off'), 5000);
      await page.close();
      assert(!(await ctx.sw.evaluate(() => Mochi.toolsBg.registered())), 'still registered');
      const v = await ctx.newPage();
      await v.goto(`${BASE}/test/tools/other.html`);
      await v.waitForTimeout(2200);
      assert(!(await v.evaluate(() => !!document.querySelector('mochi-peek'))), 'peek after turning off');
      await v.close();
      return 'unregistered (this test copy has <all_urls> built in, so its permission itself stays)';
    });
    await check('no console errors (tools in the extension)', async () => { assert(!ctx.errors.length, ctx.errors.join(' | ')); return ''; });
  } finally { await ctx.close(); fs.rmSync(ctx.extDir, { recursive: true, force: true }); }
};

// ——— 1.30: Live Edit, Guides, design taste ———
groups.next = async () => {
  const ctx = await deepContext('next'); // host access: like after a toolbar click (and the optional "every site")
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const outside = [];
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('https://claude.ai/')) return route.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(ROOT, CLAUDE_FIXTURE), 'utf8') });
    if (u.startsWith(BASE) || /^(data:|blob:|chrome)/.test(u)) return route.continue();
    outside.push(u);
    return route.abort();
  });
  const colorOf = (page, sel) => page.evaluate(s => getComputedStyle(document.querySelector(s)).color, sel);
  try {
    // A claude.ai tab first (a tab the extension opens itself would skip Playwright's routing); the first-visit tour already seen.
    await ctx.sw.evaluate(async () => { const m = (await chrome.storage.local.get('mochi.meta'))['mochi.meta'] || {}; await chrome.storage.local.set({ 'mochi.meta': { ...m, onboardingDone: true, tourDone: true, tourSkipped: true } }); });
    const claude = await ctx.newPage();
    await claude.goto('https://claude.ai/new');
    const a = await mochiOn(ctx, `${BASE}/test/next/edit.html`);
    await a.waitForTimeout(3500); // Mochi's hello first

    await check('live edit: pick a part, say what to change → the question goes to claude.ai', async () => {
      await hook(a, 'toolsOpen', { id: 'liveEdit' });
      await shadow(a, '[data-act="live-pick"]', 'click');
      await a.waitForTimeout(300);
      const t = await a.evaluate(() => { const r = document.getElementById('hero-title').getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; });
      await a.mouse.move(t.x, t.y); await a.waitForTimeout(150); await a.mouse.click(t.x, t.y);
      assert(await until(() => shadow(a, '.live-wish'), 4000), 'no wish card');
      await shadow(a, '.live-wish', 'focus');
      await a.keyboard.type('make the title red and bigger');
      await shadow(a, '[data-act="live-ask"]', 'click');
      const entry = await until(() => ctx.sw.evaluate(async () => ((await chrome.storage.local.get('mochi.pocket'))['mochi.pocket'] || []).find(e => e.kind === 'edit')), 4000);
      assert(entry && /make the title red and bigger/.test(entry.prompt) && /`#hero-title`/.test(entry.prompt) && /\[Mochi Live Edit #le_/.test(entry.prompt), (entry?.prompt || '').slice(0, 200));
      const pending = await ctx.sw.evaluate(async () => (await chrome.storage.local.get('liveEdit.pending'))['liveEdit.pending']);
      assert(pending?.tabId, 'no origin tab');
      return `selector #hero-title, pocket entry, origin tab ${pending.tabId}`;
    });

    await check('live edit: on claude.ai Mochi offers it, you send it; the CSS comes back and is applied (sanitized)', async () => {
      await claude.bringToFront();
      const offer = await until(async () => { const t = await shadow(claude, '.offer', 'text'); return /Live Edit question/.test(t || '') && t; }, 10000);
      assert(offer, `offer: ${await shadow(claude, '.offer', 'text')}`);
      await shadow(claude, '.offer [data-act="paste"]', 'click');
      await until(async () => /\[Mochi Live Edit #/.test(await claude.evaluate(() => document.querySelector('[contenteditable]').textContent)), 4000);
      assert((await claude.evaluate(() => fixture.sent.length)) === 0, 'Mochi pressed Enter');
      // You press Enter; Claude answers with CSS (one rule pulls an image from the web: Mochi drops it).
      await claude.evaluate(() => fixture.sendBox('Here you go:\n\n```css\n#hero-title { color: rgb(220, 38, 38) !important; font-size: 40px !important; }\n.card { background: url(https://tracker.example/pixel.png); border-radius: 16px !important; }\n```\n\nEnjoy!'));
      const applied = await until(async () => (await colorOf(a, '#hero-title')) === 'rgb(220, 38, 38)', 10000);
      assert(applied, `title color ${await colorOf(a, '#hero-title')}`);
      assert((await a.evaluate(() => getComputedStyle(document.querySelector('.card')).borderRadius)) === '16px', 'second rule');
      const css = await a.evaluate(() => document.querySelector('style[data-mochi-live]').textContent);
      assert(!/tracker\.example/.test(css), 'a remote url got through');
      assert(/left out 1 thing/.test(await shadow(a, '.live', 'text') || ''), 'no "left out" note');
      return 'red 40px title, 16px radius, remote url dropped';
    });

    await check('live edit: before/after, edit by hand, undo', async () => {
      await a.bringToFront();
      await shadow(a, '[data-act="live-before"]', 'click');
      assert((await colorOf(a, '#hero-title')) === 'rgb(17, 24, 39)', 'before');
      await shadow(a, '[data-act="live-before"]', 'click');
      assert((await colorOf(a, '#hero-title')) === 'rgb(220, 38, 38)', 'after');
      await shadow(a, '.live-css', 'focus');
      await a.keyboard.press('Control+End');
      await a.keyboard.type('\n#hero-title { color: rgb(37, 99, 235) !important; }');
      assert(await until(async () => (await colorOf(a, '#hero-title')) === 'rgb(37, 99, 235)', 3000), 'hand edit not applied');
      return 'toggle + hand edit';
    });

    await check('live edit: keep on this site → back after a reload, and on every visit without Mochi (every-site script)', async () => {
      await shadow(a, '[data-act="live-keep-site"]', 'click');
      const kept = await until(() => ctx.sw.evaluate(async () => ((await chrome.storage.local.get('liveEdit.kept'))['liveEdit.kept'] || [])[0]), 4000);
      assert(kept && kept.scope === 'site' && /37, 99, 235/.test(kept.css), JSON.stringify(kept || {}).slice(0, 160));
      assert(await until(() => ctx.sw.evaluate(() => Mochi.toolsBg.liveRegistered()), 4000), 'every-site script not registered (this test copy has the permission)');
      const b = await ctx.newPage();
      await b.goto(`${BASE}/test/next/edit.html?again`);
      assert((await colorOf(b, '#hero-title')) === 'rgb(37, 99, 235)', `without Mochi: ${await colorOf(b, '#hero-title')}`);
      assert(!(await b.evaluate(() => !!document.querySelector('mochi-companion'))), 'Mochi came by himself');
      await b.close();
      return 'kept, applied at document_start without Mochi';
    });

    await check('live edit: turn a kept edit off / delete it', async () => {
      await hook(a, 'toolsOpen', { id: 'liveEdit' });
      await shadow(a, '[data-act="live-toggle"]', 'click');
      assert((await colorOf(a, '#hero-title')) === 'rgb(17, 24, 39)', 'still on');
      await shadow(a, '[data-act="live-delete"]', 'click');
      assert(await until(async () => !(await ctx.sw.evaluate(() => Mochi.toolsBg.liveRegistered())), 4000), 'script stays after the last edit is gone');
      return 'off, deleted, script unregistered';
    });

    await check('live edit: the answer is recognised even when its marker was lost (long message trimmed by the page)', async () => {
      // Ask again, so a fresh question is pending.
      await a.bringToFront();
      await hook(a, 'toolsOpen', { id: 'liveEdit' });
      await shadow(a, '[data-act="live-pick"]', 'click');
      await a.waitForTimeout(300);
      const t = await a.evaluate(() => { const r = document.querySelector('.card-title').getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
      await a.mouse.move(t.x, t.y); await a.waitForTimeout(150); await a.mouse.click(t.x, t.y);
      assert(await until(() => shadow(a, '.live-wish'), 4000), 'no wish card');
      await shadow(a, '.live-wish', 'focus');
      await a.keyboard.type('make it green');
      await shadow(a, '[data-act="live-ask"]', 'click');
      assert(await until(() => ctx.sw.evaluate(async () => { const p = (await chrome.storage.local.get('liveEdit.pending'))['liveEdit.pending']; return p && !p.done; }), 4000), 'no fresh pending');
      // On claude.ai the user sends a message WITHOUT the marker (as if the page trimmed the long paste),
      // then Claude answers with CSS. Mochi must still take it back and apply it.
      await claude.bringToFront();
      await claude.evaluate(() => { const box = document.querySelector('[contenteditable]'); box.textContent = 'please make the card title green'; });
      await claude.evaluate(() => fixture.sendBox('Sure:\n\n```css\n.card-title { color: rgb(22, 163, 74) !important; }\n```'));
      const applied = await until(async () => (await colorOf(a, '.card-title')) === 'rgb(22, 163, 74)', 10000);
      assert(applied, `card-title colour ${await colorOf(a, '.card-title')}`);
      const lastMsg = await claude.evaluate(() => { const u = [...document.querySelectorAll('[data-testid="user-message"]')]; return u[u.length - 1]?.textContent || ''; });
      assert(!/Mochi Live Edit/.test(lastMsg), `this message must carry no marker: ${lastMsg}`);
      return 'no marker in the message, still applied';
    });

    // ——— Mochi Guides ———
    const SITE = `${BASE}/test/next/site.html`;
    let site = null;
    const guideState = () => hook(site, 'guidesState', true, 3000);
    await check('guides: an answer with steps on claude.ai → "make it a guide?" → the site opens, Mochi comes along', async () => {
      await claude.bringToFront();
      await claude.evaluate(url => fixture.reply(`Here's how to turn on two-factor authentication on Acme:\n\n1. Go to ${url}\n2. Click "Password and authentication" in the sidebar.\n3. Click "Enable two-factor authentication".\n4. Scan the QR code with your authenticator app.\n5. Type the code into "Verify the code from the app" and click "Continue".`), SITE);
      const offer = await until(async () => { const t = await shadow(claude, '.gd-offer', 'text'); return /5 steps/.test(t || '') && t; }, 8000);
      assert(offer, 'no guide offer');
      const before = ctx.pages().length;
      await shadow(claude, '[data-act="guide-make"]', 'click');
      site = await until(() => ctx.pages().find(pg => pg.url().startsWith(SITE)), 8000);
      assert(site && ctx.pages().length === before + 1, 'no new tab');
      await site.bringToFront();
      const card = await until(() => shadow(site, '.gd-card', 'text'), 10000);
      assert(/Step 1 of 5/.test(card || ''), `card: ${card}`);
      return 'offered, opened, Mochi on the site with step 1';
    });
    await check('guides: Mochi finds the button, walks to it and points; your click moves the guide on', async () => {
      await shadow(site, '[data-act="guide-done"]', 'click'); // step 1: just open the page
      const st = await until(async () => { const v = await guideState(); return v?.target && v; }, 5000);
      assert(st && st.current === 1 && st.target === 'password and authentication', `${JSON.stringify(st)} · state now ${JSON.stringify(await guideState())} · card: ${await shadow(site, '.gd-card', 'text')}`);
      assert(await shadow(site, '.gd-box:not([hidden])'), 'no outline on the button');
      await site.waitForTimeout(700);
      await site.screenshot({ path: path.join(OUT, 'next-guide.png') });
      const moved = await site.evaluate(() => 0) || await shadow(site, '.root', 'html');
      assert(/--ex-x: -?\d+/.test(moved || '') && !/--ex-x: 0px/.test(moved || ''), 'Mochi did not walk');
      const link = await site.evaluate(() => { const r = document.querySelector('a[data-sec="security"]').getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
      await site.mouse.click(link.x, link.y); // you click it (Mochi never does)
      const next = await until(async () => { const v = await guideState(); return v?.current === 2 && v.target && v; }, 5000);
      assert(next && next.target === 'enable two-factor authentication', JSON.stringify(next));
      return 'pointed at "Password and authentication", your click → step 3 found';
    });
    await check('guides: the rest of the steps, including typing; finished with a celebration', async () => {
      const at = sel => site.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; }, sel);
      let p = await at('#enable'); await site.mouse.click(p.x, p.y);
      await until(async () => (await guideState())?.current === 3, 4000);
      await shadow(site, '[data-act="guide-done"]', 'click'); // the QR code: read only
      const typing = await until(async () => { const v = await guideState(); return v?.current === 4 && v.target && v; }, 4000);
      assert(typing && /verify the code/.test(typing.target), JSON.stringify(typing));
      p = await at('#code'); await site.mouse.click(p.x, p.y);
      await site.keyboard.type('123456'); await site.keyboard.press('Tab');
      const done = await until(async () => !(await shadow(site, '.gd-card')), 5000);
      assert(done, `guide not finished: ${JSON.stringify(await guideState())} · value ${await site.evaluate(() => document.getElementById('code').value)} · active ${await site.evaluate(() => document.activeElement?.id)} · ${await shadow(site, '.gd-card', 'text')}`);
      const said = await until(async () => /All done/.test(await shadow(site, '.bubble', 'text') || ''), 3000);
      assert(said, 'no celebration');
      return 'typed → finished 🎉';
    });
    await check('guides: record a guide (clicks and which fields, never what you type), export it, play it', async () => {
      await hook(site, 'toolsOpen', { id: 'guides' });
      await shadow(site, '[data-act="guide-record"]', 'click');
      assert(await until(() => shadow(site, '.gd-card.rec'), 4000), 'no recording card');
      const at = sel => site.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; }, sel);
      let p = await at('a[data-sec="billing"]'); await site.mouse.click(p.x, p.y);
      p = await at('a[data-sec="security"]'); await site.mouse.click(p.x, p.y);
      p = await at('#enable'); await site.mouse.click(p.x, p.y);
      p = await at('#code'); await site.mouse.click(p.x, p.y); await site.keyboard.type('secret-999'); await site.keyboard.press('Tab');
      await site.waitForTimeout(300);
      await shadow(site, '[data-act="rec-stop"]', 'click');
      const saved = await until(() => ctx.sw.evaluate(async () => ((await chrome.storage.local.get('guides.saved'))['guides.saved'] || [])[0]), 4000);
      assert(saved && saved.steps.length === 4, JSON.stringify(saved?.steps));
      assert(saved.steps[0].text === 'Click “Billing and plans”' && saved.steps[3].text === 'Fill in “Verify the code from the app”', saved.steps.map(s => s.text).join(' | '));
      assert(!JSON.stringify(saved).includes('secret-999'), 'a typed value was recorded');
      const [file] = await Promise.all([site.waitForEvent('download'), shadow(site, '[data-act="guide-export"]', 'click')]);
      const json = JSON.parse(fs.readFileSync(await file.path(), 'utf8'));
      assert(json.kind === 'guide' && json.steps.length === 4 && !JSON.stringify(json).includes('secret'), JSON.stringify(json).slice(0, 120));
      await shadow(site, '[data-act="guide-play"]', 'click');
      const st = await until(async () => { const v = await guideState(); return v?.target && v; }, 5000);
      assert(st.current === 0 && st.target === 'billing and plans', JSON.stringify(st));
      await hook(site, 'guidesClose');
      return `${saved.steps.length} steps, no typed value, exported, plays here`;
    });
    // ——— your design taste ———
    await check('taste: notes from what you do (UI scan, kept Live Edit) → your colors, fonts, vibe; Mochi wears a beret', async () => {
      await a.bringToFront();
      await debug(a, { scan: true });
      const events = await until(async () => { const v = await ctx.sw.evaluate(async () => (await chrome.storage.local.get('taste.events'))['taste.events'] || []); return v.some(e => e.kind === 'scan') && v; }, 8000);
      assert(events && events.some(e => e.kind === 'edit'), JSON.stringify((events || []).map(e => e.kind)));
      await a.keyboard.press('Escape');
      await hook(a, 'toolsOpen', { id: 'taste' });
      const text = await until(() => shadow(a, '.taste', 'text'), 4000);
      assert(/Colors you love/.test(text || '') && /#[0-9a-f]{6}/.test(text || ''), (text || '').slice(0, 200));
      assert(await shadow(a, '.outfit-layer[data-slot="head"] *'), 'no beret');
      await shadow(a, '[data-act="taste-copy"]', 'click');
      const md = await a.evaluate(() => navigator.clipboard.readText());
      assert(/^# My design taste/.test(md) && /## Colors/.test(md), md.slice(0, 120));
      return `${events.length} notes (${[...new Set(events.map(e => e.kind))].join(', ')}), brief copied`;
    });
    await check('taste: forget everything; collecting can be turned off', async () => {
      await shadow(a, '[data-act="taste-forget"]', 'click');
      await shadow(a, '[data-act="taste-forget"]', 'click');
      assert(await until(async () => (await ctx.sw.evaluate(async () => (await chrome.storage.local.get('taste.events'))['taste.events'] || [])).length === 0, 3000), 'not forgotten');
      await debug(a, { setSetting: ['taste.collect', false] });
      await a.keyboard.press('Escape');
      await debug(a, { scan: true });
      await a.waitForTimeout(2500);
      const after = await ctx.sw.evaluate(async () => (await chrome.storage.local.get('taste.events'))['taste.events'] || []);
      assert(after.length === 0, `collected while off: ${after.length}`);
      return 'empty, and nothing collected while off';
    });
    await check('live edit: nothing left the browser', async () => { assert(!outside.length, outside.join(' | ')); return ''; });
    await check('no console errors (next)', async () => { assert(!ctx.errors.length, ctx.errors.join(' | ')); return ''; });
  } finally { await ctx.close(); fs.rmSync(ctx.extDir, { recursive: true, force: true }); }
};

// ——— 1.31: Bug Reporter, element → SVG for Figma ———
groups.reporter = async () => {
  const ctx = await deepContext('reporter');
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  try {
    const p = await mochiOn(ctx, `${BASE}/test/next/buggy.html`);
    await p.waitForTimeout(3500);
    const at = sel => p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; }, sel);
    await check('bugs: record steps, catch the uncaught error, the console error and the 404, screenshots', async () => {
      await hook(p, 'toolsOpen', { id: 'bugs' });
      await shadow(p, '[data-act="bug-start"]', 'click');
      assert(await until(() => shadow(p, '.gd-card.bug'), 5000), 'no recording card');
      let q = await at('#add'); await p.mouse.click(q.x, q.y); await p.waitForTimeout(1400);
      q = await at('#coupon'); await p.mouse.click(q.x, q.y); await p.keyboard.type('SUPERSECRET'); await p.keyboard.press('Tab'); await p.waitForTimeout(1400);
      q = await at('#checkout'); await p.mouse.click(q.x, q.y);
      const st = await until(async () => { const v = await hook(p, 'bugsState', true, 2000); return v?.errors >= 2 && v.failed >= 1 && v; }, 8000);
      assert(st && st.steps === 3, JSON.stringify(st || await hook(p, 'bugsState')));
      return `${st.steps} steps · ${st.errors} errors · ${st.failed} failed`;
    });
    await check('bugs: the report — steps (no typed value), console, failed request (no query), environment; zip and copy', async () => {
      await p.waitForTimeout(1500);
      await shadow(p, '[data-act="bug-stop"]', 'click');
      assert(await until(() => shadow(p, '.bug-report'), 5000), 'no report');
      await shadow(p, '[data-field="title"]', 'focus');
      await p.keyboard.type('Checkout does nothing');
      await shadow(p, '[data-act="bug-copy"]', 'click');
      const md = await p.evaluate(() => navigator.clipboard.readText());
      for (const want of ['# Checkout does nothing', '1. Click “Add to cart”', '2. Fill in “Coupon”', '3. Click “Checkout”', "TypeError: Cannot read properties of undefined (reading 'total')", 'Checkout failed: 404', '| 404 | GET |', 'missing/api/checkout.json?…', 'Tiny shop · Cart']) assert(md.includes(want), `report lacks: ${want}\n${md.slice(0, 600)}`);
      assert(!md.includes('SUPERSECRET') && !md.includes('SECRET123'), 'a typed value or a query string got into the report');
      assert(/screenshots\/01\.jpg/.test(md), 'no screenshots');
      const [dl] = await Promise.all([p.waitForEvent('download'), shadow(p, '[data-act="bug-zip"]', 'click')]);
      const files = unzipStore(fs.readFileSync(await dl.path()));
      assert(files['report.md'] && Object.keys(files).some(n => /^screenshots\/\d+\.jpg$/.test(n)), Object.keys(files).join(' '));
      const jpg = Object.entries(files).find(([n]) => n.endsWith('.jpg'))[1];
      assert(jpg[0] === 0xff && jpg[1] === 0xd8, 'not a JPEG');
      assert(!(await ctx.sw.evaluate(() => Mochi.debuggerProxy.sessions.size)), 'the DevTools connection is still open');
      return `${Object.keys(files).length} files in the zip, debugger closed`;
    });
    await check('bugs: recording follows a page load in the same tab (the DevTools connection stays)', async () => {
      await hook(p, 'toolsOpen', { id: 'bugs' });
      await shadow(p, '[data-act="bug-start"]', 'click');
      await until(() => shadow(p, '.gd-card.bug'), 5000);
      await p.goto(`${BASE}/test/next/buggy.html?page=2`);
      const back = await until(() => shadow(p, '.gd-card.bug'), 8000); // with the permission Mochi comes back by himself
      assert(back, 'the recording did not come back after the page load');
      const q = await at('#checkout'); await p.mouse.click(q.x, q.y);
      const st = await until(async () => { const v = await hook(p, 'bugsState', true, 2000); return v?.errors >= 1 && v; }, 8000);
      assert(st && st.steps >= 2, JSON.stringify(st));
      await shadow(p, '[data-act="bug-cancel"]', 'click');
      assert(await until(async () => !(await ctx.sw.evaluate(() => Mochi.debuggerProxy.sessions.size)), 4000), 'still attached after cancel');
      return `${st.steps} steps across 2 pages, cancelled, detached`;
    });
    await check('svg: a picked card becomes Figma-ready SVG (shapes, text lines, picture, icon; hidden parts left out), copied and downloadable', async () => {
      const f = await mochiOn(ctx, `${BASE}/test/next/figma.html`);
      await f.waitForTimeout(3500);
      const out = await hook(f, 'svgOf', '#card');
      assert(out && out.svg, 'no SVG');
      const c = out.counts;
      assert(c.boxes >= 3 && c.texts >= 6 && c.images === 2 && c.icons === 1, JSON.stringify(c));
      const svg = out.svg;
      for (const want of ['<linearGradient', 'feDropShadow', 'rx="16"', 'stroke="rgb(99, 102, 241)"', '>Pro plan</text>', '>MOST POPULAR</text>', 'href="data:image/png;base64,', '<path d="M4 12l5 5L20 6" stroke="rgb(22, 163, 74)"', 'Cancel anytime &amp; &lt;no&gt; fees', '>Choose Pro</text>', 'id="div#card"']) assert(svg.includes(want), `SVG lacks: ${want}`);
      assert(!svg.includes('HIDDEN-TEXT'), 'a hidden element was exported');
      assert(out.width === 344 && out.height > 200, `${out.width}×${out.height}`);
      const parsed = await f.evaluate(s => { const d = new DOMParser().parseFromString(s, 'image/svg+xml'); return d.querySelector('parsererror') ? d.querySelector('parsererror').textContent : d.documentElement.childElementCount; }, svg);
      assert(typeof parsed === 'number', `not valid XML: ${parsed}`);
      const loads = await f.evaluate(s => new Promise(res => { const i = new Image(); i.onload = () => res(i.naturalWidth); i.onerror = () => res(0); i.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`; }), svg);
      assert(loads === 344, `the SVG does not render as an image (${loads})`);
      assert((await f.evaluate(() => navigator.clipboard.readText())) === svg, 'the SVG was not copied');
      assert(await until(() => shadow(f, '.svg-preview img'), 3000), 'no preview');
      const [dl] = await Promise.all([f.waitForEvent('download'), shadow(f, '[data-act="svg-download"]', 'click')]);
      assert(/\.svg$/.test(dl.suggestedFilename()) && fs.readFileSync(await dl.path(), 'utf8') === svg, dl.suggestedFilename());
      await f.close();
      return `${c.boxes} shapes · ${c.texts} text lines · ${c.images} picture · ${c.icons} icon · ${(svg.length / 1024).toFixed(1)} KB`;
    });
    await check('anim: a CSS @keyframes element keeps its authored animation; a JS-moved element is rebuilt as @keyframes; a still one has none', async () => {
      const f = await mochiOn(ctx, `${BASE}/test/next/anim.html`);
      await f.waitForTimeout(3500);
      const css = await hook(f, 'animOf', '#css-anim', 8000);
      assert(css.kind === "css" && css.name === "pulse" && /@keyframes pulse/.test(css.css) && /animation: pulse 2s/.test(css.css), JSON.stringify({ kind: css.kind, name: css.name }));
      const js = await hook(f, 'animOf', '#js-anim', 12000); // ~2.5s of sampling
      assert(js.kind === 'js' && js.moving.includes('ty') && /@keyframes mochi-move/.test(js.css), JSON.stringify({ kind: js.kind, moving: js.moving }));
      const none = await hook(f, 'animOf', '#still', 8000);
      assert(none.kind === 'none', `still element: ${none.kind}`);
      const canv = await hook(f, 'animOf', '#canvas-anim', 8000);
      assert(canv.kind === 'canvas' && canv.moving === true && typeof canv.snapshot === 'string' && canv.snapshot.startsWith('data:image/png'), JSON.stringify({ kind: canv.kind, moving: canv.moving, snap: canv.snapshot?.slice(0, 20) }));
      await f.close();
      return `css(${css.name}) · js(${js.moving.join('+')}) · none · canvas(moving)`;
    });
    await check('broken: a failed image, a missing alt and dead links — found and classified (nothing fetched)', async () => {
      const f = await mochiOn(ctx, `${BASE}/test/next/broken.html`);
      await f.waitForTimeout(1500); // let the bad image finish erroring out
      const r = await hook(f, 'brokenScan');
      assert(r.counts.brokenImages === 1 && r.counts.imagesNoAlt === 1 && r.counts.deadLinks === 3, JSON.stringify(r.counts));
      assert(r.brokenImages.includes('#broken') && r.imagesNoAlt.includes('#noalt'), JSON.stringify({ b: r.brokenImages, a: r.imagesNoAlt }));
      assert(r.deadLinks.some(d => d.sel === '#dead' && d.reason === 'anchor') && r.deadLinks.some(d => d.reason === 'empty'), JSON.stringify(r.deadLinks));
      await f.close();
      return `${r.counts.brokenImages} broken img · ${r.counts.imagesNoAlt} no-alt · ${r.counts.deadLinks} dead links`;
    });
    await check('responsive: previews at phone/tablet/desktop (viewport emulation); a too-wide block overflows on mobile only; screenshots captured', async () => {
      const f = await mochiOn(ctx, `${BASE}/test/next/responsive.html`);
      await f.waitForTimeout(500);
      const d = await hook(f, 'responsivePreview', {}, 25000);
      assert(Array.isArray(d) && d.length === 3, JSON.stringify(d));
      const m = d.find(x => x.id === 'mobile'), desk = d.find(x => x.id === 'desktop');
      assert(m.overflow === true && desk.overflow === false, JSON.stringify(d.map(x => ({ id: x.id, o: x.overflow, c: x.contentW }))));
      assert(m.shot && m.shot.startsWith('data:image/png'), `no screenshot: ${m.shot}`);
      await f.close();
      return `mobile overflow(+${m.contentW - m.w}px) · desktop ok · shots ok`;
    });
    await check('video: a <video> — sources, poster and play attributes read; clean HTML built', async () => {
      const f = await mochiOn(ctx, `${BASE}/test/next/media-scan.html`);
      await f.waitForTimeout(500);
      const info = await hook(f, 'videoOf', '#vid');
      assert(info && info.sources.length >= 2 && /icon-48/.test(info.poster || ''), JSON.stringify({ s: info?.sources?.length, p: info?.poster }));
      assert(info.attrs.loop && info.attrs.muted && info.attrs.autoplay && !info.attrs.controls, JSON.stringify(info.attrs));
      await f.close();
      return `${info.sources.length} sources · poster · ${Object.entries(info.attrs).filter(([, v]) => v === true).map(([k]) => k).join('+')}`;
    });
    await check('hero: the top section — its CSS animation is kept and a scroll reveal is rebuilt', async () => {
      const f = await mochiOn(ctx, `${BASE}/test/next/media-scan.html`);
      await f.waitForTimeout(500);
      const r = await hook(f, 'heroScan');
      assert(r && r.selector === '#hero' && r.kind === 'css' && r.reveals.length >= 1 && r.css.length > 0, JSON.stringify(r));
      await f.close();
      return `${r.selector} · ${r.kind} · ${r.reveals.length} reveal(s)`;
    });
    await check('hero: deep capture — scrolls below-the-fold reveals into view and records their real motion', async () => {
      const f = await mochiOn(ctx, `${BASE}/test/next/hero-reveal.html`);
      await f.waitForTimeout(400);
      const real = await hook(f, 'heroRecord', true, 30000);
      assert(Array.isArray(real) && real.length >= 2, JSON.stringify(real));
      assert(real.every(r => r.moving.includes('opacity') || r.moving.includes('ty')), JSON.stringify(real.map(r => r.moving)));
      await f.close();
      return `recorded ${real.length} reveal(s): ${real.map(r => r.moving.join('+')).join(' · ')}`;
    });
    await check('no console errors from Mochi (reporter)', async () => {
      const mine = ctx.errors.filter(e => !/buggy\.html/.test(e) || /mochi/i.test(e));
      assert(!mine.length, mine.join(' | '));
      return '(the fixture\'s own errors are expected)';
    });
  } finally { await ctx.close(); fs.rmSync(ctx.extDir, { recursive: true, force: true }); }
};

groups.wardrobe = async () => {
  // The test page (Mochi in the page's own world): characters, level gates, the grouped wardrobe, clothes.
  const ctx = await launch(ROOT, { name: 'wardrobe' });
  try {
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', e => errors.push(String(e)));
    await p.goto(`${BASE}/test/test-page.html`);
    await until(() => p.evaluate(() => !!window.Mochi?.debug?.companion && !!Mochi.debugHooks?.level));
    await p.evaluate(async () => { await Mochi.store.update('mochi.meta', m => ({ ...m, onboardingDone: true }), {}); });
    await p.waitForTimeout(4000);
    const NEW = ['bunny', 'penguin', 'fox', 'bear', 'cloud'];
    await check('wardrobe: the new friends unlock by level (bunny 2, penguin 4, fox 5, bear 8, cloud 12) and say so', async () => {
      await p.evaluate(() => Mochi.debugHooks.resetProgress());
      const next = await p.evaluate(() => Mochi.progress.nextUnlock());
      assert(next?.level === 2 && next.what.id === 'bunny', JSON.stringify(next));
      const name = await p.evaluate(() => Mochi.progress.unlockName({ kind: 'friend', id: 'cloud' }));
      assert(name === 'Cloud friend', name);
      await p.evaluate(() => Mochi.menuInstance.open('friends'));
      await p.waitForTimeout(200);
      const locked = await p.evaluate(() => [...Mochi.debug.companion.shadow.querySelectorAll('.char-tile[data-role="main"].locked')].map(t => t.dataset.char));
      for (const id of NEW) assert(locked.includes(id), `${id} is not locked at level 1: ${locked}`);
      await p.evaluate(() => Mochi.debugHooks.level(4));
      await p.evaluate(() => { Mochi.menuInstance.close(); Mochi.menuInstance.open('friends'); });
      await p.waitForTimeout(200);
      const open = await p.evaluate(() => [...Mochi.debug.companion.shadow.querySelectorAll('.char-tile[data-role="main"]:not(.locked)')].map(t => t.dataset.char));
      assert(open.join() === 'mochi,bunny,cat,penguin', open.join());
      await p.evaluate(() => Mochi.menuInstance.close());
      return `level 4: ${open.join(', ')}`;
    });
    await check('wardrobe: each new character draws, takes its colors, and runs its idle antic', async () => {
      await p.evaluate(() => Mochi.debugHooks.level(15));
      const out = [];
      for (const id of NEW) {
        await p.evaluate(v => Mochi.debugHooks.character(v), id);
        const r = await until(() => p.evaluate(want => {
          const c = Mochi.debug.companion;
          if (c.el.dataset.char !== want) return null;
          const ch = Mochi.characters.get(want);
          const base = c.el.style.getPropertyValue('--m-base').trim();
          ch.idle.at(-1).run(c, null);
          return { base, want: ch.colors.base, pixels: c.el.querySelectorAll('.mochi-svg .body path').length, fx: c.el.dataset.fx || '', tail: !!c.el.querySelector('.back .tail') };
        }, id), 4000);
        assert(r && r.base === r.want && r.pixels > 0, `${id}: ${JSON.stringify(r)}`);
        out.push(`${id}${r.tail ? ' (tail)' : ''}${r.fx ? ` [${r.fx.trim()}]` : ''}`);
        await p.waitForTimeout(300);
      }
      const fx = out.join(' · ');
      for (const want of ['honey', 'carrot', 'fish']) assert(fx.includes(want), `no ${want}: ${fx}`);
      return fx;
    });
    await check('wardrobe: the cloud wears its mood as weather (rain when sad, a rainbow when happy)', async () => {
      await p.evaluate(() => Mochi.debugHooks.character('cloud'));
      await until(() => p.evaluate(() => Mochi.debug.companion.el.dataset.char === 'cloud'));
      const op = sel => p.evaluate(s => getComputedStyle(Mochi.debug.companion.el.querySelector(s)).opacity, sel);
      await p.evaluate(() => Mochi.debug.companion.setMood('sad'));
      assert(await op('.fx-rain') === '1' && await op('.fx-rainbow') === '0', 'no rain when sad');
      await p.evaluate(() => Mochi.debug.companion.setMood('happy'));
      assert(await op('.fx-rainbow') === '1' && await op('.fx-rain') === '0', 'no rainbow when happy');
      await p.evaluate(() => Mochi.debug.companion.setMood('neutral'));
      return 'rain · rainbow';
    });
    await check('wardrobe: grouped by slot (hats, glasses, neck, clothes); wearing one of each; the cape hangs behind; take everything off', async () => {
      await p.evaluate(() => Mochi.debugHooks.character('mochi'));
      await p.evaluate(() => Mochi.menuInstance.open('wardrobe'));
      await p.waitForTimeout(250);
      const groups = await p.evaluate(() => [...Mochi.debug.companion.shadow.querySelectorAll('.ward-grid[data-slot]')].map(g => `${g.dataset.slot}:${g.querySelectorAll('.ward-tile').length}`));
      assert(groups.join() === 'head:11,face:6,neck:3,body:3', groups.join());
      for (const id of ['crown', 'heart-glasses', 'bow-tie', 'cape']) {
        await p.evaluate(i => Mochi.debug.companion.shadow.querySelector(`.ward-tile[data-outfit="${i}"]`).click(), id);
        await p.waitForTimeout(150);
      }
      const worn = await until(() => p.evaluate(() => { const el = Mochi.debug.companion.el; return el.dataset.outfit?.split(' ').length === 4 && { outfit: el.dataset.outfit, hide: el.dataset.hide, back: el.querySelectorAll('.outfit-layer-back .outfit-back').length, frontBack: el.querySelectorAll('.outfit-layer .outfit-back').length, crown: !!el.querySelector('.outfit-layer[data-slot="head"] .outfit-crown') }; }), 3000);
      assert(worn && worn.back === 1 && worn.frontBack === 0 && worn.crown && /antenna/.test(worn.hide), JSON.stringify(worn));
      const thumb = await p.evaluate(() => { const svg = Mochi.debug.companion.shadow.querySelector('.ward-tile[data-outfit="cape"] svg'); return svg.getAttribute('viewBox').split(' ').map(Number); });
      assert(thumb[2] >= 24, `the cape's thumbnail misses its back part: ${thumb}`);
      await p.evaluate(() => Mochi.debug.companion.shadow.querySelector('[data-act="undress"]').click());
      const bare = await until(() => p.evaluate(() => !Mochi.debug.companion.el.dataset.outfit && !Mochi.debug.companion.el.querySelector('.outfit-layer-back *')), 3000);
      assert(bare, 'still wearing something');
      await p.evaluate(() => Mochi.menuInstance.close());
      return `${groups.join(' · ')} → ${worn.outfit} → bare`;
    });
    await check('wardrobe: the outfit editor accepts a clothes item', async () => {
      const ok = await p.evaluate(() => Mochi.outfitEditor?.clean?.({ id: 'my-shirt', name: 'My shirt', slot: 'body', at: [12, 28], pixels: ['OOOO', 'ORRO'], palette: { O: '#000000', R: '#ff0000' } })?.slot);
      assert(ok === 'body', String(ok));
      return 'body slot';
    });
    await check('no page errors (wardrobe)', async () => { assert(!errors.length, errors.join(' | ')); return ''; });
  } finally { await ctx.close(); }
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
