// Records the README's tool GIFs (docs/gifs/*.gif): node dev/record-gifs.mjs
// Plays each tool on the local fixture pages with a copy of the extension, saves PNG frames,
// then dev/frames-to-gif.py joins them (Python 3 + Pillow). Dev only, not in the extension zip.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let chromium;
for (const from of [path.join(ROOT, 'dev', 'package.json'), path.join(ROOT, 'tests', 'smoke.mjs')]) { try { ({ chromium } = createRequire(from)('playwright')); break; } catch (_) { /* next */ } }
const OUT = path.join(ROOT, 'tests', '.out', 'gifs');
fs.rmSync(OUT, { recursive: true, force: true });
const WANT = process.argv.slice(2);
const want = name => !WANT.length || WANT.includes(name);

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2' }[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-gif-'));
for (const item of ['manifest.json', 'src', 'icons', 'pages', 'options.html', 'welcome.html']) fs.cpSync(path.join(ROOT, item), path.join(ext, item), { recursive: true });
const mf = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
mf.host_permissions = ['<all_urls>'];
fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(mf));
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-gifp-')), { channel: 'chromium', headless: true, viewport: { width: 960, height: 600 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
await new Promise(r => setTimeout(r, 1500));
for (const p of ctx.pages()) if (p.url().includes('welcome')) await p.close();

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function mochiOn(url) {
  const p = await ctx.newPage();
  await p.goto(url);
  await p.bringToFront();
  await sw.evaluate(async u => { const tab = (await chrome.tabs.query({})).find(t => t.url === u); return toggleIn(tab); }, p.url());
  await sleep(4000); // Mochi's hello comes and goes
  return p;
}
async function hook(p, key, value = true) {
  const attr = `data-mochi-result-${key.toLowerCase()}`;
  await p.evaluate(a => document.documentElement.removeAttribute(a), attr);
  await p.evaluate(d => document.dispatchEvent(new CustomEvent('mochi:debug', { detail: d })), { [key]: value });
  for (let i = 0; i < 100; i++) { const v = await p.getAttribute('html', attr); if (v) return JSON.parse(v); await sleep(100); }
  return null;
}
async function shadowBox(p, selector) {
  const c = await ctx.newCDPSession(p);
  const { root } = await c.send('DOM.getDocument', { depth: -1, pierce: true });
  const host = (await c.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'mochi-companion' })).nodeId;
  const sr = (await c.send('DOM.describeNode', { nodeId: host, depth: 1, pierce: true })).node.shadowRoots[0];
  const sid = (await c.send('DOM.pushNodesByBackendIdsToFrontend', { backendNodeIds: [sr.backendNodeId] })).nodeIds[0];
  const id = (await c.send('DOM.querySelector', { nodeId: sid, selector })).nodeId;
  if (!id) return null;
  const { model } = await c.send('DOM.getBoxModel', { nodeId: id });
  await c.detach();
  return { x: (model.border[0] + model.border[4]) / 2, y: (model.border[1] + model.border[5]) / 2 };
}
let n = 0;
const frame = async (p, name, hold = 1) => { const dir = path.join(OUT, name); fs.mkdirSync(dir, { recursive: true }); for (let i = 0; i < hold; i++) await p.screenshot({ path: path.join(dir, `${String(n++).padStart(3, '0')}.png`) }); };

// ——— notes ———
let p = null;
if (want('notes')) {
n = 0;
p = await mochiOn(`${BASE}/test/tools/notes.html?utm_source=readme`);
await frame(p, 'notes', 2);
await hook(p, 'toolsOpen', { id: 'notes' });
await sleep(500); await frame(p, 'notes', 2);
const lines = ['[ ] compare prices', '\n[ ] read the reviews', '\n[x] check the size chart'];
let text = '';
for (const l of lines) { for (const part of l.match(/.{1,6}/gs)) { text += part; await hook(p, 'notesType', { text }); await frame(p, 'notes'); } }
await hook(p, 'notesType', { color: 'mint' }); await sleep(200); await frame(p, 'notes', 2);
const box = await shadowBox(p, '.np-text');
await p.mouse.click(box.x - 120, box.y - 70); await sleep(300); await frame(p, 'notes', 3);
await p.keyboard.press('Escape'); await sleep(900);
await p.reload(); await sw.evaluate(async u => { const tab = (await chrome.tabs.query({})).find(t => t.url === u); return toggleIn(tab); }, p.url()); await sleep(4200);
await frame(p, 'notes', 4);
await p.close();
}

// ——— color picker ———
if (want('picker')) {
n = 0;
p = await mochiOn(`${BASE}/test/image-scan/index.html`);
await p.evaluate(() => { window.__picks = ['#ef476f', '#ffd166']; });
await sw.evaluate(async u => {
  const tab = (await chrome.tabs.query({})).find(t => t.url === u);
  // EyeDropper stand-in in Mochi's world: it "picks" the next color after a short pause.
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { const picks = ['#ef476f', '#073b4c']; globalThis.EyeDropper = class { open() { return new Promise(r => setTimeout(() => r({ sRGBHex: picks.shift() }), 900)); } }; } });
}, p.url());
await frame(p, 'picker', 2);
await hook(p, 'toolsOpen', { id: 'picker' });
for (let i = 0; i < 4; i++) { await sleep(250); await frame(p, 'picker'); }
await sleep(400); await frame(p, 'picker', 4);
const second = await shadowBox(p, '[data-act="pc-second"]');
await p.mouse.click(second.x, second.y);
for (let i = 0; i < 4; i++) { await sleep(250); await frame(p, 'picker'); }
await sleep(500); await frame(p, 'picker', 5);
await p.close();
}

// ——— font inspector ———
if (want('fonts')) {
n = 0;
p = await mochiOn(`${BASE}/test/tools/fonts.html`);
await frame(p, 'fonts', 2);
await sw.evaluate(async u => { const tab = (await chrome.tabs.query({})).find(t => t.url === u); await Mochi.toolsBg.onCommand('font-inspector', tab); }, p.url());
await sleep(600); await frame(p, 'fonts', 2);
for (const sel of ['#osw', '#lora', '#local', '#ghost', '#spaced']) {
  const b = await p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + 60, y: r.top + r.height / 2 }; }, sel);
  await p.mouse.move(b.x, b.y, { steps: 4 }); await sleep(250); await frame(p, 'fonts', 3);
}
const o = await p.evaluate(() => { const r = document.getElementById('osw').getBoundingClientRect(); return { x: r.left + 60, y: r.top + r.height / 2 }; });
await p.mouse.move(o.x, o.y, { steps: 4 }); await p.mouse.click(o.x, o.y); await sleep(300); await frame(p, 'fonts', 5);
await p.close();
}

const tabOf = async page => sw.evaluate(async u => (await chrome.tabs.query({})).find(t => t.url === u)?.id, page.url());
async function typeInShadow(page, selector, text) {
  const c = await ctx.newCDPSession(page);
  const { root } = await c.send('DOM.getDocument', { depth: -1, pierce: true });
  const host = (await c.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'mochi-companion' })).nodeId;
  const sr = (await c.send('DOM.describeNode', { nodeId: host, depth: 1, pierce: true })).node.shadowRoots[0];
  const sid = (await c.send('DOM.pushNodesByBackendIdsToFrontend', { backendNodeIds: [sr.backendNodeId] })).nodeIds[0];
  const id = (await c.send('DOM.querySelector', { nodeId: sid, selector })).nodeId;
  await c.send('DOM.focus', { nodeId: id });
  await c.detach();
  for (const ch of text) { await page.keyboard.type(ch); }
}

// ——— Live Edit (Claude's answer is played back from storage, as Mochi on claude.ai would hand it over) ———
if (want('live')) {
  n = 0;
  p = await mochiOn(`${BASE}/test/next/edit.html`);
  await frame(p, 'live', 2);
  await hook(p, 'toolsOpen', { id: 'liveEdit' }); await sleep(300); await frame(p, 'live', 2);
  let b = await shadowBox(p, '[data-act="live-pick"]'); await p.mouse.click(b.x, b.y); await sleep(300);
  const t = await p.evaluate(() => { const r = document.getElementById('hero-title').getBoundingClientRect(); return { x: r.left + 60, y: r.top + r.height / 2 }; });
  await p.mouse.move(t.x, t.y, { steps: 4 }); await sleep(200); await frame(p, 'live', 2);
  await p.mouse.click(t.x, t.y); await sleep(300);
  await typeInShadow(p, '.live-wish', 'make the title big, orange and friendly');
  await frame(p, 'live', 3);
  b = await shadowBox(p, '[data-act="live-ask"]'); await p.mouse.click(b.x, b.y); await sleep(600); await frame(p, 'live', 2);
  const pending = await sw.evaluate(async () => (await chrome.storage.local.get('liveEdit.pending'))['liveEdit.pending']);
  await sw.evaluate(async pend => chrome.storage.local.set({ 'liveEdit.result': { id: pend.id, css: '#hero-title { color: #ea580c !important; font-size: 44px !important; letter-spacing: -0.02em; }\n#hero { background: #fff7ed !important; border-radius: 0 0 24px 24px; }', session: pend, at: Date.now(), applied: false } }), pending);
  for (let i = 0; i < 6; i++) { await sleep(250); await frame(p, 'live'); }
  b = await shadowBox(p, '[data-act="live-before"]'); await p.mouse.click(b.x, b.y); await sleep(200); await frame(p, 'live', 3);
  await p.mouse.click(b.x, b.y); await sleep(200); await frame(p, 'live', 4);
  await p.close();
}

// ——— a guide on a site ———
if (want('guide')) {
  n = 0;
  p = await mochiOn(`${BASE}/test/next/site.html`);
  const tabId = await tabOf(p);
  await sw.evaluate(async id => chrome.storage.local.set({ 'guides.active': { title: 'Turn on two-factor authentication', host: '127.0.0.1', startUrl: null, current: 0, tabId: id, steps: [
    { text: 'Click "Password and authentication" in the sidebar.', targets: ['Password and authentication'], action: 'click' },
    { text: 'Click "Enable two-factor authentication".', targets: ['Enable two-factor authentication'], action: 'click' },
    { text: 'Type the code into "Verify the code from the app".', targets: ['Verify the code from the app'], action: 'type' },
  ] } }), tabId);
  await hook(p, 'toolsOpen', { id: 'guides', resume: true });
  for (let i = 0; i < 6; i++) { await sleep(250); await frame(p, 'guide'); }
  const at = sel => p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; }, sel);
  let q = await at('a[data-sec="security"]'); await p.mouse.move(q.x, q.y, { steps: 5 }); await frame(p, 'guide'); await p.mouse.click(q.x, q.y);
  for (let i = 0; i < 6; i++) { await sleep(250); await frame(p, 'guide'); }
  q = await at('#enable'); await p.mouse.move(q.x, q.y, { steps: 5 }); await frame(p, 'guide'); await p.mouse.click(q.x, q.y);
  for (let i = 0; i < 6; i++) { await sleep(250); await frame(p, 'guide'); }
  q = await at('#code'); await p.mouse.click(q.x, q.y); await p.keyboard.type('123456'); await p.keyboard.press('Tab');
  for (let i = 0; i < 6; i++) { await sleep(250); await frame(p, 'guide'); }
  await p.close();
}

// ——— your design taste ———
if (want('taste')) {
  n = 0;
  const now = Date.now(), day = 864e5;
  await sw.evaluate(async t => chrome.storage.local.set({ 'taste.events': [
    { kind: 'scan', at: t - 864e5, colors: [{ hex: '#ff6b35', role: 'accent' }, { hex: '#1a1a2e', role: 'background' }, { hex: '#f7f7f2', role: 'text' }], fonts: ['Inter'], vibe: ['Playful', 'Bold'], radius: 14, spacing: 8, theme: 'dark' },
    { kind: 'scan', at: t - 1728e5, colors: [{ hex: '#ff6a36', role: 'accent' }, { hex: '#2ec4b6', role: 'secondary' }], fonts: ['Inter', 'Space Mono'], vibe: ['playful'], radius: 16, spacing: 8, theme: 'dark' },
    { kind: 'image', at: t - 2592e5, colors: [{ hex: '#ffd166', role: 'dominant' }, { hex: '#ef476f', role: 'accent' }], fonts: ['Oswald'] },
    { kind: 'color', at: t - 864e5, colors: ['#2ec4b6'] }, { kind: 'font', at: t - 864e5, fonts: ['Space Mono'] },
  ] }), now);
  p = await mochiOn(`${BASE}/test/next/edit.html`);
  await frame(p, 'taste', 2);
  await hook(p, 'toolsOpen', { id: 'taste' });
  for (let i = 0; i < 8; i++) { await sleep(250); await frame(p, 'taste'); }
  await p.close();
}

await ctx.close();
server.close();
fs.rmSync(ext, { recursive: true, force: true });
for (const name of ['notes', 'picker', 'fonts', 'live', 'guide', 'taste'].filter(want)) execFileSync('python3', [path.join(ROOT, 'dev', 'frames-to-gif.py'), path.join(OUT, name), path.join(ROOT, 'docs', 'gifs', `${name}.gif`)], { stdio: 'inherit' });
