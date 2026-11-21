/*
 * Tests for the prompt library: search, save, import and export.
 *   node test/library.test.js
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const mem = new Map();
globalThis.Mochi = {
  store: {
    async get(k, fb) { return mem.has(k) ? structuredClone(mem.get(k)) : fb; },
    async set(k, v) { mem.set(k, structuredClone(v)); },
    async update(k, fn, fb) { const v = fn(await this.get(k, fb)); await this.set(k, v); return v; },
  },
  menu: { addItem() {} },
  features: [],
};
require(path.join(__dirname, '../src/library.js'));
const L = globalThis.Mochi.library;

let passed = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log(`ok   ${name}`); }, err => { console.error(`FAIL ${name}\n${err.message}`); process.exitCode = 1; });

(async () => {
  await ok('save cleans name and tags', async () => {
    const p = await L.save({ text: 'Review this code for bugs and missing edge cases', tags: '#Code, review  #code' });
    assert.equal(p.name, 'Review this code for bugs');
    assert.deepEqual(p.tags, ['code', 'review']);
  });
  await ok('empty prompts are not saved', async () => assert.equal(await L.save({ text: '   ' }), null));
  await ok('search by words, #tag and Cyrillic', async () => {
    await L.save({ name: 'Краткое резюме', tags: ['ru'], text: 'Сделай краткое резюме.' });
    const all = await L.list();
    assert.deepEqual(L.search(all, '#cod').map(p => p.tags[0]), ['code']);
    assert.deepEqual(L.search(all, 'РЕЗЮМЕ').map(p => p.name), ['Краткое резюме']);
    assert.equal(L.search(all, 'bugs edge').length, 1);
    assert.equal(L.search(all, 'nothing-here').length, 0);
    assert.equal(L.search(all, '').length, 2);
  });
  await ok('export → import skips duplicates', async () => {
    const json = L.exportJson(await L.list());
    assert.equal(JSON.parse(json).mochi, 'prompt-library');
    assert.deepEqual(await L.importJson(json), { added: 0 });
    mem.clear();
    assert.deepEqual(await L.importJson(json), { added: 2 });
    assert.equal((await L.list()).length, 2);
  });
  await ok('import accepts a plain array and rejects junk', async () => {
    assert.deepEqual(await L.importJson('[{"name":"A","text":"Plain array prompt"},{"text":5},null]'), { added: 1 });
    assert.equal((await L.importJson('not json')).error, 'json');
    assert.equal((await L.importJson('{"hello":1}')).error, 'format');
  });
  console.log(`${passed} passed`);
})();
