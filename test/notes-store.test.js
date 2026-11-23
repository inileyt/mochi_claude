/* Site notes storage: save, index, remove, empty = removed, export/import round trip, sync index.
 *   node test/notes-store.test.js */
const assert = require('node:assert/strict');
globalThis.Mochi = {};
require('../src/store.js'); // without chrome.storage: an in-memory store
const U = require('../src/tools/note-url.js');
const N = require('../src/tools/notes-store.js');

(async () => {
  const url = 'https://www.shop.example/item/9?utm_source=x#reviews';
  const n = U.normalize(url);
  const page = `page:${n.page}`, site = `site:${n.site}`;
  await N.save({ key: page, url: n.page, host: n.site, title: 'Item 9', text: '[ ] compare prices\n[x] read reviews', color: 'mint' });
  await N.save({ key: site, scope: 'site', host: n.site, title: 'shop.example', text: 'Coupon: MOCHI10' });
  assert.equal((await N.get(page)).text, '[ ] compare prices\n[x] read reviews');
  assert.equal((await N.get(U.keyOf('https://shop.example/item/9/'))).color, 'mint', 'the same page without tracking params');
  const list = await N.list();
  assert.equal(list.length, 2);
  assert.equal(list.find(e => e.key === site).scope, 'site');
  assert.equal(list.find(e => e.key === page).len, 35);

  // Saving empty removes it.
  await N.save({ key: site, text: '   ' });
  assert.equal(await N.get(site), null);
  assert.equal((await N.list()).length, 1);

  // Export → wipe → import: the same notes back; an older copy doesn't overwrite a newer note.
  await N.save({ key: site, scope: 'site', host: n.site, text: 'Coupon: MOCHI10' });
  const json = N.toJson(await N.all());
  const md = N.toMarkdown(await N.all());
  assert.match(md, /^# Mochi notes\n\n## shop\.example\n/);
  assert.match(md, /### shop\.example \(whole site\)/);
  assert.match(md, /\[x\] read reviews/);
  for (const e of await N.list()) await N.remove(e.key);
  assert.equal((await N.list()).length, 0);
  const res = await N.importJson(json);
  assert.deepEqual(res, { added: 2, updated: 0, skipped: 0 });
  assert.equal((await N.get(page)).title, 'Item 9');
  assert.deepEqual(await N.importJson(json), { added: 0, updated: 0, skipped: 2 }, 'importing again changes nothing');
  await assert.rejects(N.importJson('nope'), /not-json/);
  await assert.rejects(N.importJson('{"x":1}'), /not-notes/);
  assert.equal((await N.importJson(JSON.stringify([{ key: 'evil:x', text: 'a' }, { key: 'page:https://a.b/', text: 7 }]))).skipped, 2);

  // The synced index: titles only, no text.
  await new Promise(r => setTimeout(r, 20));
  const sync = await Mochi.store.get('notes.sync');
  assert.ok(sync[page] && sync[page].title === 'Item 9' && !('text' in sync[page]), JSON.stringify(sync[page]));
  assert.ok(!JSON.stringify(sync).includes('compare prices'), 'note text in the sync index');
  // Merging two computers' indexes: the newer entry wins.
  const merge = Mochi.store.mergers?.['notes.sync'];
  if (merge) {
    const m = merge({ a: { title: 'old', updated: 1 } }, { a: { title: 'new', updated: 2 }, b: { title: 'b', updated: 3 } });
    assert.equal(m.a.title, 'new'); assert.ok(m.b);
  }
  // A full storage: save() says 'quota', and the note that was there stays as it was.
  const box = new Map();
  globalThis.chrome = { storage: { local: {
    get: async k => (box.has(k) ? { [k]: box.get(k) } : {}),
    set: async obj => { for (const [k, v] of Object.entries(obj)) { if (JSON.stringify(v).length > 2000) throw new Error('QUOTA_BYTES quota exceeded'); box.set(k, v); } },
    remove: async k => { box.delete(k); },
  } } };
  const q = 'page:https://big.example/';
  await N.save({ key: q, text: 'small note' });
  await assert.rejects(N.save({ key: q, text: 'x'.repeat(5000) }), err => err.code === 'quota');
  assert.equal((await N.get(q)).text, 'small note', 'the saved note survived');
  delete globalThis.chrome;
  console.log('ok   notes store: index, page/site, empty = removed, JSON/Markdown export, import round trip, sync index without text');
})().catch(err => { console.error(err); process.exit(1); });
