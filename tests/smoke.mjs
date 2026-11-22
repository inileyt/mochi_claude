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
    await check('welcome: 4 steps with Back / Next / Skip', async () => {
      const visible = () => w.evaluate(() => document.querySelector('.step:not([hidden])').dataset.step);
      const seen = [await visible()];
      assert(await w.isHidden('#back'), 'Back shown on step 1');
      await w.click('#next'); seen.push(await visible());
      await w.click('#back'); seen.push(await visible());
      await w.click('#next'); await w.click('#next'); seen.push(await visible());
      assert(await w.$('#sites-list .site-row[data-site="chatgpt"]'), 'no site list on step 3');
      await w.click('#back'); await w.click('#back'); await w.click('#skip'); seen.push(await visible());
      assert(seen.join() === '1,2,1,3,4', seen.join());
      assert(await w.isHidden('#next') && await w.isHidden('#skip'), 'Next/Skip still shown on the last step');
      assert((await w.getAttribute('#open-claude', 'href')).startsWith('https://claude.ai/'), 'no claude.ai link');
      return seen.join(' → ');
    });
    await check('welcome: color and name are saved (and go to sync)', async () => {
      await w.click('#back'); await w.click('#back');
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
      const menuHas = async () => { await p.evaluate(() => Mochi.menuInstance.open('tools')); await p.waitForTimeout(200); const has = await shadowHas('.menu-item[data-id="birthday-card"]'); await p.evaluate(() => Mochi.menuInstance.close()); return has; };
      assert(await menuHas(), 'no "Birthday card" in Tools on the birthday');
      const dl = p.waitForEvent('download', { timeout: 8000 });
      await p.evaluate(() => { Mochi.menuInstance.open('tools'); });
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
/** A copy of the extension that may visit test pages (host access) and, unless told otherwise, already holds "debugger" (Chrome's prompt can't be answered headlessly). */
async function deepContext(name, { permission = true } = {}) {
  const ext = extensionCopy(name, m => ({ ...m, host_permissions: ['<all_urls>'], permissions: permission ? [...m.permissions, 'debugger'] : m.permissions }));
  const ctx = await launch(ext, { name });
  ctx.extDir = ext;
  return ctx;
}
/** Open a page and bring Mochi in with the toolbar button (as a person would). */
async function mochiOn(ctx, url) {
  const p = await ctx.newPage();
  await p.goto(url);
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
      assert(r.detach.detached, JSON.stringify(r.detach));
      // (chrome.debugger.getTargets() would also count Playwright's own connection: ask the proxy.)
      const still = await ctx.sw.evaluate(() => Mochi.debuggerProxy.sessions.size);
      assert(still === 0, `${still} sessions still attached`);
      await p.close();
      return 'attach → DOM.getDocument ✓ → Runtime.evaluate ✗ → detach';
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
    await check('deep: menu → explainer; "my own site" is off by default and resets every time', async () => {
      const p = await mochiOn(ctx, `${BASE}/tests/fixtures/plain.html?intro`);
      const openIntro = async () => {
        await shadow(p, '.character', 'click');
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
    await check('deep: without the permission, "Allow and scan" opens Mochi\'s permission window', async () => {
      const p = await mochiOn(noPerm, `${BASE}/tests/fixtures/plain.html?perm`);
      await hook(p, 'deepIntro');
      assert(await until(() => shadow(p, '[data-act="deep-start"]'), 4000), 'no explainer');
      assert(/Allow and scan/.test(await shadow(p, '[data-act="deep-start"]', 'text')), 'button is not "Allow and scan"');
      const win = noPerm.waitForEvent('page', { timeout: 6000 });
      await shadow(p, '[data-act="deep-start"]', 'click');
      const w = await win;
      await w.waitForLoadState();
      assert(w.url().includes('/pages/deep-permission.html?tab='), w.url());
      await w.waitForFunction(() => document.getElementById('allow')?.textContent.trim().length > 0);
      const text = await w.textContent('main');
      assert(/debugging this browser/.test(text) && /Allow and scan/.test(text), 'permission window text');
      await w.close();
      return w.url().replace(/^.*\/pages\//, 'pages/');
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
