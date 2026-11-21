/*
 * Mochi — saved state. A thin layer over chrome.storage.local (in your
 * browser only), with an in-memory fallback for the local test page.
 *
 *   await Mochi.store.get(key, fallback)
 *   await Mochi.store.set(key, value)
 *   await Mochi.store.update(key, fn, fallback)   read → fn(value) → write
 *   Mochi.store.watch(key, fn)                    fn(newValue) when another tab changes it
 *
 * Settings live under one key and are loaded once at start, so features can
 * read them synchronously:
 *
 *   Mochi.settings.get('sound.on')
 *   await Mochi.settings.set('sound.on', true)
 *   Mochi.settings.onChange((path, value) => …)
 *
 * Storage keys (see README → Privacy):
 *   mochi.v1              position, tucked
 *   mochi.pocket          saved scans and picks
 *   mochi.settings        everything in the Settings menu
 *   mochi.progress        level, XP, streak, …
 *   (more keys are listed where each feature defines them)
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  const memory = new Map();
  const hasStore = () => !!globalThis.chrome?.storage?.local;
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  async function get(key, fallback) {
    if (hasStore()) {
      try {
        const out = await chrome.storage.local.get(key);
        if (out[key] !== undefined) return out[key];
        return clone(fallback);
      } catch (_) { /* fall through to memory */ }
    }
    return memory.has(key) ? clone(memory.get(key)) : clone(fallback);
  }

  async function set(key, value) {
    memory.set(key, clone(value));
    if (!hasStore()) return;
    try { await chrome.storage.local.set({ [key]: value }); } catch (_) { /* memory copy stays */ }
  }

  async function update(key, fn, fallback) {
    const next = fn(await get(key, fallback));
    await set(key, next);
    return next;
  }

  const watchers = new Map();
  function watch(key, fn) {
    if (!watchers.has(key)) watchers.set(key, []);
    watchers.get(key).push(fn);
  }
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (const [key, change] of Object.entries(changes)) {
        memory.set(key, clone(change.newValue));
        for (const fn of watchers.get(key) || []) { try { fn(change.newValue); } catch (_) { /* one bad listener */ } }
      }
    });
  } catch (_) { /* no extension storage: nothing to watch */ }

  // ——— settings ———
  const SETTINGS_KEY = 'mochi.settings';
  const DEFAULTS = {
    v: 1,
    lang: 'auto',
    idleAntics: true,
  };

  const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const setPath = (obj, path, value) => {
    const keys = path.split('.');
    let o = obj;
    for (const k of keys.slice(0, -1)) o = o[k] = (o[k] && typeof o[k] === 'object' ? o[k] : {});
    o[keys.at(-1)] = value;
  };
  const deepMerge = (base, extra) => {
    const out = clone(base);
    for (const [k, v] of Object.entries(extra || {})) {
      out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k], v) : v;
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
      await set(SETTINGS_KEY, this.values);
      this.emit(path);
    },
    onChange(fn) { this.listeners.push(fn); },
    emit(path) {
      for (const fn of this.listeners) { try { fn(path, this.get(path)); } catch (_) { /* one bad listener */ } }
    },
  };

  function changedPaths(a, b, prefix = '') {
    const out = [];
    for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
      const path = prefix ? `${prefix}.${k}` : k;
      const x = a?.[k], y = b?.[k];
      if (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x)) out.push(...changedPaths(x, y, path));
      else if (JSON.stringify(x) !== JSON.stringify(y)) out.push(path);
    }
    return out;
  }

  /** Today in the user's local time, "2026-11-21". Tests can move it with Mochi.store.setToday(). */
  let todayOverride = null;
  const today = () => {
    if (todayOverride) return todayOverride;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  Mochi.store = { get, set, update, watch, today, setToday: d => { todayOverride = d || null; } };
  Mochi.settings = settings;
})();
