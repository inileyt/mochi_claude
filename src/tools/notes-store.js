/*
 * Mochi — site notes, storage. Everything stays in this browser.
 *
 *   chrome.storage.local
 *     notes.item.<id>  one note: { key, scope, url, host, title, text, color, created, updated }
 *     notes.index      { key → { id, scope, url, host, title, len, color, created, updated } }  (the badge reads this)
 *   chrome.storage.sync (through Mochi.store, small)
 *     notes.sync       { key → { host, title, updated, deleted? } }: which notes exist on your other computers,
 *                      titles only — the notes themselves never sync. Newest 60, deletions kept 30 days.
 *
 *   await N.get(key) · await N.save({ key, scope, url, host, title, text, color }) · await N.remove(key)
 *   await N.list() → index entries, newest first · await N.all() → full notes
 *   N.toJson(notes) · N.toMarkdown(notes) · await N.importJson(text) → { added, updated, skipped }
 * A full storage (quota) → save() throws an Error with code 'quota'; nothing already saved is lost.
 * A note saved empty is removed.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const INDEX = 'notes.index';
  const SYNC = 'notes.sync';
  const SYNC_MAX = 60;
  const TOMB_MS = 30 * 24 * 3600 * 1000;

  /** FNV-1a: a short, stable id for a key. */
  const idOf = key => { let h = 0x811c9dc5; for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); };

  // Where the notes go: chrome.storage.local (errors visible: the quota), or Mochi.store (local test pages, Node tests).
  const backend = {
    get: async key => (globalThis.chrome?.storage?.local ? (await chrome.storage.local.get(key))[key] : Mochi.store.get(key)),
    set: async (key, value) => {
      if (!globalThis.chrome?.storage?.local) return Mochi.store.set(key, value);
      try { await chrome.storage.local.set({ [key]: value }); } catch (err) {
        throw Object.assign(new Error('quota'), { code: /quota/i.test(String(err?.message)) ? 'quota' : 'storage', cause: err });
      }
    },
    remove: async key => (globalThis.chrome?.storage?.local ? chrome.storage.local.remove(key) : Mochi.store.set(key, undefined)),
  };

  const index = async () => (await Mochi.store.get(INDEX, {})) || {};
  const now = () => Date.now();

  async function get(key) {
    const entry = (await index())[key];
    return entry ? (await backend.get(`notes.item.${entry.id}`)) || null : null;
  }

  async function syncIndex(key, entry) {
    try {
      await Mochi.store.update(SYNC, cur => {
        const out = { ...(cur || {}) };
        out[key] = entry ? { host: entry.host, title: String(entry.title || '').slice(0, 60), updated: entry.updated } : { deleted: true, updated: now() };
        return trimSync(out);
      }, {});
    } catch (_) { /* sync is a bonus */ }
  }
  function trimSync(all) {
    const cut = now() - TOMB_MS;
    const entries = Object.entries(all).filter(([, v]) => !(v.deleted && v.updated < cut)).sort((a, b) => b[1].updated - a[1].updated).slice(0, SYNC_MAX);
    return Object.fromEntries(entries);
  }

  async function save(note) {
    if (!note?.key) throw new Error('no-key');
    const text = String(note.text ?? '');
    if (!text.trim()) { await remove(note.key); return null; }
    const idx = await index();
    const old = idx[note.key];
    const id = old?.id || idOf(note.key);
    const full = {
      key: note.key, scope: note.scope || (note.key.startsWith('site:') ? 'site' : 'page'), url: note.url || '', host: note.host || '',
      title: String(note.title || '').slice(0, 160), text, color: note.color || old?.color || 'butter',
      created: old?.created || note.created || now(), updated: note.updated || now(),
    };
    await backend.set(`notes.item.${id}`, full); // the big one first: if it doesn't fit, the index stays right
    idx[note.key] = { id, scope: full.scope, url: full.url, host: full.host, title: full.title, len: text.length, color: full.color, created: full.created, updated: full.updated };
    await Mochi.store.set(INDEX, idx);
    syncIndex(note.key, idx[note.key]);
    return full;
  }

  async function remove(key) {
    const idx = await index();
    const entry = idx[key];
    if (!entry) return false;
    await backend.remove(`notes.item.${entry.id}`);
    delete idx[key];
    await Mochi.store.set(INDEX, idx);
    syncIndex(key, null);
    return true;
  }

  const list = async () => Object.entries(await index()).map(([key, v]) => ({ key, ...v })).sort((a, b) => b.updated - a.updated);
  async function all() {
    const out = [];
    for (const e of await list()) { const n = await backend.get(`notes.item.${e.id}`); if (n) out.push(n); }
    return out;
  }
  /** Notes your other computers have (titles only), that this one doesn't. */
  async function elsewhere() {
    const mine = await index();
    return Object.entries((await Mochi.store.get(SYNC, {})) || {}).filter(([k, v]) => !v.deleted && !mine[k]).map(([key, v]) => ({ key, ...v }));
  }

  // ——— export / import ———
  const toJson = notes => JSON.stringify({ app: 'mochi', kind: 'notes', version: 1, exported: new Date().toISOString(), notes }, null, 2);
  function toMarkdown(notes) {
    const bySite = {};
    for (const n of notes) (bySite[n.host || '—'] = bySite[n.host || '—'] || []).push(n);
    const lines = ['# Mochi notes', ''];
    for (const [host, ns] of Object.entries(bySite).sort()) {
      lines.push(`## ${host}`, '');
      for (const n of ns) {
        lines.push(`### ${n.scope === 'site' ? `${host} (whole site)` : n.title || n.url}`, '', n.scope === 'site' ? '' : `<${n.url}>`, `*${new Date(n.updated).toISOString().slice(0, 16).replace('T', ' ')}*`, '', n.text.trim(), '');
      }
    }
    return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').trim() + '\n';
  }
  async function importJson(text) {
    let data;
    try { data = JSON.parse(text); } catch (_) { throw Object.assign(new Error('not-json'), { code: 'bad-file' }); }
    const notes = Array.isArray(data) ? data : data?.notes;
    if (!Array.isArray(notes)) throw Object.assign(new Error('not-notes'), { code: 'bad-file' });
    const idx = await index();
    const res = { added: 0, updated: 0, skipped: 0 };
    for (const n of notes) {
      if (!n || typeof n.key !== 'string' || !/^(page|site):/.test(n.key) || typeof n.text !== 'string') { res.skipped++; continue; }
      const old = idx[n.key];
      if (old && old.updated >= (n.updated || 0)) { res.skipped++; continue; }
      await save({ ...n, updated: n.updated || now() });
      res[old ? 'updated' : 'added']++;
    }
    return res;
  }

  Mochi.notesStore = { get, save, remove, list, all, elsewhere, toJson, toMarkdown, importJson, idOf, trimSync, backend };
  if (typeof module !== 'undefined') module.exports = Mochi.notesStore;
})();
