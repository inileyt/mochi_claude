/*
 * Mochi — saved state. One storage module for everything.
 *
 *   await Mochi.store.get(key, fallback)
 *   await Mochi.store.set(key, value, { lazy })   lazy: sync later (XP), local now
 *   await Mochi.store.update(key, fn, fallback)   read → fn(value) → write
 *   Mochi.store.watch(key, fn)                    fn(newValue) when another tab
 *                                                 or another computer changes it
 *   await Mochi.store.ready                       migration + first sync merge done
 *
 * Where things go:
 *   - SYNC_KEYS follow your Chrome profile to your other computers
 *     (chrome.storage.sync): settings (color, name, outfit, language, enabled
 *     sites…), level/XP/streak, unlocked items, installDate, onboarding, the
 *     game's best score. Every one also has a copy in chrome.storage.local, so
 *     nothing is lost offline, and if you're not signed in to Chrome, sync
 *     simply behaves like local.
 *   - Everything else stays on this computer (chrome.storage.local): big
 *     things like scans, bookmarks, the prompt library, custom outfits.
 *
 * Sync has small limits (~100 KB in total, 8 KB per item, ~120 writes a
 * minute), so writes to it are batched and delayed; XP is "lazy" and goes
 * every few minutes, and when the tab is hidden or closed. If sync says
 * QUOTA, that key quietly stays local.
 *
 * When another computer's values arrive, they are merged, not just copied:
 * the highest XP / level / streak, all unlocked items from both, and the
 * newest value of each setting (settings remember when each one changed).
 *
 * Settings live under one key and are loaded once at start, so features can
 * read them synchronously:
 *   Mochi.settings.get('sound.on') · await Mochi.settings.set('sound.on', true) · Mochi.settings.onChange(fn)
 *
 * Storage keys (see README → Privacy):
 *   mochi.settings  (sync)   everything in the Settings menu
 *   mochi.progress  (sync)   level, XP, streak
 *   mochi.meta      (sync)   installDate, onboarding, unlocked items, celebrations
 *   game.best       (sync)   the mini-game's best score
 *   mochi.v1        (local)  position on this screen, tucked
 *   mochi.pocket, library.prompts, bookmarks.list, outfits.custom, … (local)
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  const SCHEMA = 2;
  const SYNC_KEYS = new Set(['mochi.settings', 'mochi.progress', 'mochi.meta', 'game.best']);
  const LAZY_MS = 3 * 60 * 1000;   // XP and the like
  const SOON_MS = 1500;            // everything else on the sync side
  const ITEM_MAX = 8000;           // a little under chrome.storage.sync.QUOTA_BYTES_PER_ITEM (8192)

  const memory = new Map();
  let todayOverride = null; // tests move "today" with Mochi.store.setToday()
  const ext = () => globalThis.chrome?.storage?.local ? chrome.storage : null;
  const hasSync = () => !!globalThis.chrome?.storage?.sync;
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const bytes = (key, value) => new TextEncoder().encode(key + JSON.stringify(value ?? null)).length;
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  let quietNote = false;
  const note = msg => { if (!quietNote) { quietNote = true; try { console.debug(`[Mochi] ${msg}`); } catch (_) { /* no console */ } } };

  // ——— merging values from two computers ———
  const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const setPath = (obj, path, value) => {
    const keys = path.split('.');
    let o = obj;
    for (const k of keys.slice(0, -1)) o = o[k] = (isObj(o[k]) ? o[k] : {});
    o[keys.at(-1)] = value;
  };
  const union = (a, b) => [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])];
  const laterDay = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
  const earlierDay = (a, b) => (!a ? b : !b ? a : a < b ? a : b);

  const mergers = {
    /** Each setting: the value that changed most recently (settings.__ts[path] = when). */
    'mochi.settings'(local, remote) {
      if (!isObj(remote)) return local;
      if (!isObj(local)) return clone(remote);
      const out = clone(local);
      const lts = local.__ts || {}, rts = remote.__ts || {};
      out.__ts = { ...lts };
      for (const [p, t] of Object.entries(rts)) {
        if (!(p in lts) || t > lts[p]) { setPath(out, p, clone(getPath(remote, p))); out.__ts[p] = t; }
      }
      // Values the other computer has but this one never set (e.g. before timestamps existed).
      for (const [k, v] of Object.entries(remote)) if (k !== '__ts' && !(k in out)) out[k] = clone(v);
      return out;
    },
    /** Progress: the highest XP (level follows) and the longer streak; the per-hour caps stay per computer. */
    'mochi.progress'(local, remote) {
      if (!isObj(remote)) return local;
      if (!isObj(local)) return clone(remote);
      const out = clone(local);
      out.xp = Math.max(local.xp || 0, remote.xp || 0);
      const ls = local.streak || {}, rs = remote.streak || {};
      const better = (rs.count || 0) > (ls.count || 0) || ((rs.count || 0) === (ls.count || 0) && laterDay(ls.last, rs.last) === rs.last && rs.last !== ls.last) ? rs : ls;
      out.streak = { ...better, best: Math.max(ls.best || 0, rs.best || 0, better.count || 0), last: laterDay(ls.last, rs.last) };
      return out;
    },
    /** Meta: the first install date, onboarding done anywhere = done, all unlocked items and celebrations. */
    'mochi.meta'(local, remote) {
      if (!isObj(remote)) return local;
      if (!isObj(local)) return clone(remote);
      const out = { ...clone(remote), ...clone(local) };
      const li = local.installDate, ri = remote.installDate;
      // A real install date beats one made up during migration; otherwise the earlier one.
      if (li && ri && local.installMigrated !== remote.installMigrated) {
        const real = local.installMigrated ? remote : local;
        out.installDate = real.installDate; out.installMigrated = false;
      } else {
        out.installDate = earlierDay(li, ri);
        out.installMigrated = out.installDate === li ? !!local.installMigrated : !!remote.installMigrated;
      }
      out.onboardingDone = !!(local.onboardingDone || remote.onboardingDone);
      out.tourSkipped = !!(local.tourSkipped || remote.tourSkipped);
      out.unlocked = union(local.unlocked, remote.unlocked);
      out.celebrated = union(local.celebrated, remote.celebrated);
      out.lastCelebrated = laterDay(local.lastCelebrated, remote.lastCelebrated);
      out.whatsNewSeen = [local.whatsNewSeen, remote.whatsNewSeen].filter(Boolean).sort(compareVersions).pop() || undefined;
      return out;
    },
    'game.best': (local, remote) => Math.max(Number(local) || 0, Number(remote) || 0),
  };
  function compareVersions(a, b) {
    const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    return 0;
  }
  const merge = (key, local, remote) => (remote === undefined ? local : local === undefined ? clone(remote) : (mergers[key] || ((_, r) => r))(local, remote));

  // ——— the two areas ———
  async function readLocal(key) {
    const s = ext();
    if (s) { try { const out = await s.local.get(key); if (out[key] !== undefined) return out[key]; } catch (_) { /* memory below */ } }
    return memory.has(key) ? clone(memory.get(key)) : undefined;
  }
  async function writeLocal(key, value) {
    memory.set(key, clone(value));
    const s = ext();
    if (s) { try { await s.local.set({ [key]: value }); } catch (_) { /* the memory copy stays */ } }
  }

  // Sync writes wait a moment and go together (one write for several keys).
  const pending = new Set();
  const localOnly = new Set(); // keys sync refused (too big, quota): they stay local
  let soonTimer = null, lazyTimer = null;
  function schedule(key, lazy) {
    if (!SYNC_KEYS.has(key) || !hasSync() || localOnly.has(key)) return;
    pending.add(key);
    if (lazy) { if (!lazyTimer) lazyTimer = setTimeout(() => { lazyTimer = null; flush(); }, LAZY_MS); }
    else { clearTimeout(soonTimer); soonTimer = setTimeout(() => { soonTimer = null; flush(); }, SOON_MS); }
  }
  /** Sends everything waiting to chrome.storage.sync now (merging with what's there). */
  async function flush() {
    if (!pending.size || !hasSync()) return;
    clearTimeout(soonTimer); soonTimer = null; clearTimeout(lazyTimer); lazyTimer = null;
    const keys = [...pending];
    pending.clear();
    let remote = {};
    try { remote = await chrome.storage.sync.get(keys); } catch (_) { remote = {}; }
    const batch = {};
    for (const key of keys) {
      const local = await readLocal(key);
      const value = merge(key, local, remote[key]);
      if (!same(value, local)) await writeLocal(key, value);
      if (same(value, remote[key])) continue;
      if (bytes(key, value) > ITEM_MAX) { localOnly.add(key); note(`"${key}" is too big for Chrome sync; it stays on this computer.`); continue; }
      batch[key] = value;
    }
    if (!Object.keys(batch).length) return;
    try {
      await chrome.storage.sync.set(batch);
    } catch (err) {
      // QUOTA_BYTES, MAX_WRITE_OPERATIONS…: keep everything local; try single keys once.
      note(`Chrome sync said "${err?.message || err}"; keeping these on this computer.`);
      for (const [key, value] of Object.entries(batch)) {
        try { await chrome.storage.sync.set({ [key]: value }); } catch (_) { localOnly.add(key); }
      }
    }
  }
  // XP and friends get sent when the page goes away or is hidden.
  if (typeof document !== 'undefined' && typeof addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    addEventListener('pagehide', () => { flush(); });
  }

  // ——— public API ———
  async function get(key, fallback) {
    await ready;
    const v = await readLocal(key);
    return v === undefined ? clone(fallback) : v;
  }
  async function set(key, value, { lazy = false } = {}) {
    await writeLocal(key, value);
    schedule(key, lazy);
  }
  async function update(key, fn, fallback, opts) {
    const next = fn(await get(key, fallback));
    await set(key, next, opts);
    return next;
  }

  const watchers = new Map();
  function watch(key, fn) {
    if (!watchers.has(key)) watchers.set(key, []);
    watchers.get(key).push(fn);
  }
  try {
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area === 'local') {
        for (const [key, change] of Object.entries(changes)) {
          memory.set(key, clone(change.newValue));
          for (const fn of watchers.get(key) || []) { try { fn(change.newValue); } catch (_) { /* one bad listener */ } }
        }
      } else if (area === 'sync') {
        // Another computer (or this one a moment ago): merge into the local copy;
        // the local change then reaches every tab's watchers.
        for (const [key, change] of Object.entries(changes)) {
          if (!SYNC_KEYS.has(key) || change.newValue === undefined) continue;
          const local = await readLocal(key);
          const merged = merge(key, local, change.newValue);
          if (!same(merged, local)) await writeLocal(key, merged);
          if (!same(merged, change.newValue)) schedule(key, false); // ours had something newer
        }
      }
    });
  } catch (_) { /* no extension storage: nothing to watch */ }

  // ——— migration and the first merge with sync ———
  async function start() {
    const schema = await readLocal('mochi.schema');
    if (!schema || schema.version < SCHEMA) {
      // From 1.x (everything in local): the old values stay where they are;
      // the sync keys get pushed up by the merge below. Someone who used Mochi
      // before install dates existed gets today as a stand-in, marked as such
      // (no pretend anniversary on it).
      const hadData = (await readLocal('mochi.progress')) !== undefined || (await readLocal('mochi.settings')) !== undefined;
      const meta = (await readLocal('mochi.meta')) || {};
      if (!meta.installDate) {
        meta.installDate = today();
        meta.installMigrated = hadData;
        await writeLocal('mochi.meta', meta);
      }
      await writeLocal('mochi.schema', { version: SCHEMA, migratedAt: new Date().toISOString(), from: schema?.version || 1 });
    }
    if (!hasSync()) return;
    let remote = {};
    try { remote = await chrome.storage.sync.get([...SYNC_KEYS]); } catch (_) { return; }
    for (const key of SYNC_KEYS) {
      const local = await readLocal(key);
      const merged = merge(key, local, remote[key]);
      if (merged === undefined) continue;
      if (!same(merged, local)) await writeLocal(key, merged);
      if (!same(merged, remote[key])) schedule(key, false);
    }
  }
  const ready = start().catch(() => {});

  // ——— settings ———
  const SETTINGS_KEY = 'mochi.settings';
  const DEFAULTS = {
    v: 1,
    lang: 'auto',
    idleAntics: true,
  };

  const deepMerge = (base, extra) => {
    const out = clone(base);
    for (const [k, v] of Object.entries(extra || {})) {
      out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v;
    }
    return out;
  };

  const settings = {
    defaults: DEFAULTS,
    values: clone(DEFAULTS),
    listeners: [],
    /** Features add their own defaults before load(): Mochi.settings.define({ sound: { on: false } }). */
    define(extra) {
      this.defaults = deepMerge(this.defaults, extra);
      this.values = deepMerge(this.defaults, this.values);
    },
    async load() {
      this.values = deepMerge(this.defaults, await get(SETTINGS_KEY, {}));
      watch(SETTINGS_KEY, next => {
        const before = this.values;
        this.values = deepMerge(this.defaults, next || {});
        for (const path of changedPaths(before, this.values)) this.emit(path);
      });
      return this.values;
    },
    get(path) { return getPath(this.values, path); },
    async set(path, value) {
      setPath(this.values, path, value);
      this.values.__ts = { ...(this.values.__ts || {}), [path]: Date.now() }; // for merging with other computers
      await set(SETTINGS_KEY, this.values);
      this.emit(path);
    },
    onChange(fn) { this.listeners.push(fn); },
    emit(path) {
      if (path.startsWith('__ts')) return;
      for (const fn of this.listeners) { try { fn(path, this.get(path)); } catch (_) { /* one bad listener */ } }
    },
  };

  function changedPaths(a, b, prefix = '') {
    const out = [];
    for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
      const path = prefix ? `${prefix}.${k}` : k;
      const x = a?.[k], y = b?.[k];
      if (isObj(x) && isObj(y)) out.push(...changedPaths(x, y, path));
      else if (!same(x, y)) out.push(path);
    }
    return out;
  }

  /** Today in the user's local time, "2026-11-21". Tests can move it with Mochi.store.setToday(). */
  function today() {
    if (todayOverride) return todayOverride;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  Mochi.store = {
    get, set, update, watch, flush, today, ready, merge, mergers,
    setToday: d => { todayOverride = d || null; },
    areaOf: key => (SYNC_KEYS.has(key) && !localOnly.has(key) ? 'sync' : 'local'),
    SYNC_KEYS, localOnly, compareVersions,
  };
  Mochi.settings = settings;
})();
