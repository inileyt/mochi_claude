/* Online: incremental chat + profile cache keep Firestore reads low.   node test/online.test.js */
const assert = require('node:assert/strict');
globalThis.Mochi = {};
require('../src/online-api.js');
const { OnlineApi } = globalThis.Mochi;

const ROOT = 'projects/p/databases/(default)/documents';

/** An OnlineApi whose network is faked: GET serves a doc map, runQuery serves a messages list (honouring an `at >` filter). */
function makeApi({ docs = {}, messages = [] } = {}) {
  const api = new OnlineApi({ apiKey: 'k', projectId: 'p' }, { get: async () => null, set: async () => {} });
  api.session = { uid: 'me', idToken: 't', expiresAt: Date.now() + 1e9 }; // skip the network sign-in
  api.calls = [];
  api.call = async (method, url, body) => {
    api.calls.push({ method, url, body });
    if (method === 'GET') {
      const path = url.split('/documents/')[1];
      const fields = docs[path];
      if (!fields) { const e = new Error('404'); e.status = 404; throw e; }
      return { name: `${ROOT}/${path}`, fields };
    }
    // POST → runQuery on a messages subcollection
    const parent = url.split('/documents/')[1].replace(/:runQuery$/, '');
    const sq = body.structuredQuery;
    let rows = messages.slice();
    const filt = sq.where?.fieldFilter;
    if (filt && filt.field.fieldPath === 'at' && filt.op === 'GREATER_THAN') {
      const since = filt.value.timestampValue;
      rows = rows.filter(m => m.at > since);
    }
    rows.sort((a, b) => (a.at < b.at ? -1 : 1));
    if (sq.orderBy?.[0]?.direction === 'DESCENDING') rows.reverse();
    if (sq.limit) rows = rows.slice(0, sq.limit);
    return rows.map(m => ({ document: { name: `${ROOT}/${parent}/messages/${m.id}`, fields: { from: { stringValue: m.from }, text: { stringValue: m.text }, at: { timestampValue: m.at } } } }));
  };
  return api;
}

const MSGS = [
  { id: 'm1', from: 'me', text: 'hi', at: '2026-11-26T10:00:00.000000Z' },
  { id: 'm2', from: 'you', text: 'hey', at: '2026-11-26T10:01:00.000000Z' },
  { id: 'm3', from: 'you', text: 'what up', at: '2026-11-26T10:02:00.000000Z' },
];

(async () => {
  // friendshipMeta is a single-document read (1), and surfaces last.at for the cheap change-check.
  {
    const api = makeApi({ docs: { 'friendships/F': { xp: { integerValue: '60' }, last: { mapValue: { fields: { from: { stringValue: 'you' }, at: { timestampValue: MSGS[2].at } } } } } } });
    const meta = await api.friendshipMeta('F');
    assert.equal(meta.last.at, MSGS[2].at, 'friendshipMeta returns last.at');
    assert.equal(meta.level, 3, 'level from xp');
    assert.equal(api.reads(), 1, 'friendshipMeta costs exactly one read');
    assert.equal(api.reads(), 0, 'reads() resets');
  }

  // The opening page (no sinceAt) reads the recent messages, ascending.
  {
    const api = makeApi({ messages: MSGS });
    const page = await api.chatSince('F', null, 30);
    assert.deepEqual(page.map(m => m.id), ['m1', 'm2', 'm3'], 'opening page is ascending');
    assert.equal(api.reads(), 3, 'opening page reads = message count');
  }

  // Incremental: with a sinceAt, the query carries an `at >` filter and returns only newer messages.
  {
    const api = makeApi({ messages: MSGS });
    const fresh = await api.chatSince('F', MSGS[0].at, 40);
    const q = api.calls.at(-1).body.structuredQuery;
    assert.equal(q.where.fieldFilter.field.fieldPath, 'at');
    assert.equal(q.where.fieldFilter.op, 'GREATER_THAN', 'chatSince filters at > sinceAt');
    assert.deepEqual(fresh.map(m => m.id), ['m2', 'm3'], 'only messages after sinceAt');
    assert.equal(api.reads(), 2, 'incremental read = only the new messages');
  }

  // A quiet chat: one friendshipMeta per tick (1 read) and no message fetch — ~40× cheaper than re-reading 40 docs.
  {
    const api = makeApi({ docs: { 'friendships/F': { last: { mapValue: { fields: { at: { timestampValue: MSGS[2].at } } } } } } });
    await api.friendshipMeta('F'); await api.friendshipMeta('F'); await api.friendshipMeta('F');
    assert.equal(api.reads(), 3, 'three quiet ticks = three reads total (one each)');
  }

  // Profile cards are cached ~10 min: a second read of the same friend costs nothing.
  {
    const api = makeApi({ docs: { 'users/u1': { name: { stringValue: 'Pal' } } } });
    const a = await api.profile('u1');
    const b = await api.profile('u1');
    assert.equal(a.name, 'Pal');
    assert.equal(b.name, 'Pal');
    assert.equal(api.calls.filter(c => c.method === 'GET' && /users\/u1$/.test(c.url)).length, 1, 'profile fetched once');
    assert.equal(api.reads(), 1, 'cache hit adds no read');
    api.forgetProfile('u1');
    await api.profile('u1');
    assert.equal(api.reads(), 1, 'forgetProfile forces a fresh read');
  }

  console.log('ok   online: incremental chat reads + profile cache');
})().catch(e => { console.error(e); process.exit(1); });
