/*
 * Tests the storage module (src/store.js) with a fake chrome.storage that has
 * a local and a sync area: merging from another computer, quota fallback,
 * lazy writes, migration from 1.x.
 *   node test/store.test.js
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const FILE = path.join(__dirname, '../src/store.js');

/** A fake chrome.storage: two areas, change events, a sync quota of 8192 bytes per item. */
function fakeChrome({ local = {}, sync = {}, syncFails = null } = {}) {
  const listeners = [];
  const area = (name, data) => ({
    data,
    writes: 0,
    async get(keys) {
      const list = keys == null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter(k => k in data).map(k => [k, JSON.parse(JSON.stringify(data[k]))]));
    },
    async set(items) {
      this.writes++;
      if (name === 'sync') {
        if (syncFails) throw new Error(syncFails);
        for (const [k, v] of Object.entries(items)) if (new TextEncoder().encode(k + JSON.stringify(v)).length > 8192) throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
      }
      const changes = {};
      for (const [k, v] of Object.entries(items)) { changes[k] = { oldValue: data[k], newValue: JSON.parse(JSON.stringify(v)) }; data[k] = JSON.parse(JSON.stringify(v)); }
      setTimeout(() => listeners.forEach(fn => fn(changes, name)), 0);
    },
  });
  const storage = { local: area('local', local), sync: area('sync', sync), onChanged: { addListener: fn => listeners.push(fn) } };
  /** Another computer writes to sync. */
  storage.remote = items => storage.sync.set(items);
  return { storage };
}
function load(chrome) {
  delete require.cache[require.resolve(FILE)];
  globalThis.chrome = chrome;
  globalThis.Mochi = {};
  require(FILE);
  return globalThis.Mochi;
}
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

let passed = 0;
const step = async (name, fn) => {
  try { await fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { console.error(`FAIL ${name}\n     ${e.stack || e}`); process.exitCode = 1; }
};

(async () => {
  await step('fresh install: schema written, installDate today, not migrated', async () => {
    const c = fakeChrome();
    const M = load(c);
    await M.store.ready;
    assert.equal(c.storage.local.data['mochi.schema'].version, 2);
    assert.equal(c.storage.local.data['mochi.meta'].installDate, M.store.today());
    assert.equal(c.storage.local.data['mochi.meta'].installMigrated, false);
  });

  await step('migration from 1.x: old values stay, go to sync, installDate marked as migrated', async () => {
    const c = fakeChrome({ local: { 'mochi.settings': { lang: 'ru', colors: { mochi: 'mint' } }, 'mochi.progress': { xp: 300, streak: { count: 4, best: 6, last: '2026-11-20' } }, 'mochi.pocket': [{ big: true }] } });
    const M = load(c);
    await M.store.ready;
    assert.equal(c.storage.local.data['mochi.settings'].lang, 'ru', 'local kept');
    assert.equal(c.storage.local.data['mochi.meta'].installMigrated, true);
    await M.store.flush();
    assert.equal(c.storage.sync.data['mochi.settings'].colors.mochi, 'mint');
    assert.equal(c.storage.sync.data['mochi.progress'].xp, 300);
    assert.ok(!('mochi.pocket' in c.storage.sync.data), 'big local data stays local');
  });

  await step('settings: newest value per setting wins, both ways', async () => {
    const c = fakeChrome();
    const M = load(c);
    M.settings.define({ sound: { on: false }, colors: {} });
    await M.settings.load();
    await M.settings.set('sound.on', true);
    await M.store.flush();
    // Another computer changes the color later, and has an older sound value.
    const theirs = { ...c.storage.sync.data['mochi.settings'], colors: { mochi: 'night' }, sound: { on: false }, __ts: { 'colors.mochi': Date.now() + 5000, 'sound.on': 1 } };
    await c.storage.remote({ 'mochi.settings': theirs });
    await tick(50);
    const local = c.storage.local.data['mochi.settings'];
    assert.equal(local.colors.mochi, 'night', 'their newer color');
    assert.equal(local.sound.on, true, 'my newer sound');
    assert.equal(M.settings.get('colors.mochi'), 'night', 'settings in memory follow');
  });

  await step('progress: highest XP and streak from either computer', async () => {
    const c = fakeChrome({ local: { 'mochi.schema': { version: 2 }, 'mochi.progress': { xp: 500, streak: { count: 2, best: 9, last: '2026-11-21' }, hour: { key: 'a', n: 3 } } } });
    const M = load(c);
    await M.store.ready;
    await c.storage.remote({ 'mochi.progress': { xp: 420, streak: { count: 5, best: 5, last: '2026-11-22' }, hour: { key: 'b', n: 99 } } });
    await tick(50);
    const p = c.storage.local.data['mochi.progress'];
    assert.equal(p.xp, 500); assert.equal(p.streak.count, 5); assert.equal(p.streak.best, 9); assert.equal(p.streak.last, '2026-11-22');
    assert.equal(p.hour.n, 3, 'the hourly cap stays per computer');
  });

  await step('meta: union of unlocked items, onboarding done anywhere, real install date beats a migrated one', async () => {
    const c = fakeChrome({ local: { 'mochi.schema': { version: 2 }, 'mochi.meta': { installDate: '2026-11-22', installMigrated: true, unlocked: ['a'], onboardingDone: false } } });
    const M = load(c);
    await M.store.ready;
    await c.storage.remote({ 'mochi.meta': { installDate: '2025-03-01', installMigrated: false, unlocked: ['b'], onboardingDone: true, whatsNewSeen: '1.26.0' } });
    await tick(50);
    const m = c.storage.local.data['mochi.meta'];
    assert.deepEqual(m.unlocked.sort(), ['a', 'b']); assert.equal(m.onboardingDone, true);
    assert.equal(m.installDate, '2025-03-01'); assert.equal(m.installMigrated, false); assert.equal(m.whatsNewSeen, '1.26.0');
  });

  await step('watchers hear changes that came from another computer', async () => {
    const c = fakeChrome({ local: { 'mochi.schema': { version: 2 } } });
    const M = load(c);
    await M.store.ready;
    let heard = null;
    M.store.watch('game.best', v => { heard = v; });
    await c.storage.remote({ 'game.best': 42 });
    await tick(80);
    assert.equal(heard, 42);
  });

  await step('lazy writes wait; flush sends them; other writes are batched', async () => {
    const c = fakeChrome({ local: { 'mochi.schema': { version: 2 } } });
    const M = load(c);
    await M.store.ready;
    const before = c.storage.sync.writes;
    for (let i = 0; i < 30; i++) await M.store.set('mochi.progress', { xp: i }, { lazy: true });
    await tick(30);
    assert.equal(c.storage.sync.writes, before, 'no sync write yet');
    assert.equal(c.storage.local.data['mochi.progress'].xp, 29, 'local has it now');
    await M.store.flush();
    assert.equal(c.storage.sync.writes, before + 1, 'one write for 30 changes');
    assert.equal(c.storage.sync.data['mochi.progress'].xp, 29);
  });

  await step('too big for sync, or quota errors: stays local, no crash', async () => {
    const c = fakeChrome({ local: { 'mochi.schema': { version: 2 } } });
    const M = load(c);
    await M.store.ready;
    await M.store.set('mochi.meta', { unlocked: Array.from({ length: 2000 }, (_, i) => `item-${i}`) });
    await M.store.flush();
    assert.ok(!c.storage.sync.data['mochi.meta'], 'not sent');
    assert.equal(M.store.areaOf('mochi.meta'), 'local');
    assert.equal((await M.store.get('mochi.meta')).unlocked.length, 2000, 'still readable');
    const d = fakeChrome({ local: { 'mochi.schema': { version: 2 } }, syncFails: 'QUOTA_BYTES quota exceeded' });
    const N = load(d);
    await N.store.ready;
    await N.store.set('game.best', 7);
    await N.store.flush();
    assert.equal(await N.store.get('game.best'), 7);
    assert.equal(N.store.areaOf('game.best'), 'local');
  });

  await step('no chrome.storage at all (the test page): memory works', async () => {
    const M = load(undefined);
    await M.store.ready;
    await M.store.set('x', { a: 1 });
    assert.deepEqual(await M.store.get('x'), { a: 1 });
  });

  console.log(`${passed} passed`);
  process.exit(process.exitCode || 0);
})();
