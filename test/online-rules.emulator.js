/*
 * Tests the online client and the Firestore rules against the Firebase
 * emulators (needs firebase-tools and Java):
 *   cd online && npx firebase emulators:exec --project demo-mochi "node ../test/online-rules.emulator.js"
 */
const assert = require('node:assert/strict');
const path = require('node:path');
globalThis.Mochi = {};
require(path.join(__dirname, '../src/online-api.js'));
const { OnlineApi } = globalThis.Mochi;

const cfg = { apiKey: 'demo-key', projectId: 'demo-mochi', authUrl: 'http://127.0.0.1:9099/identitytoolkit.googleapis.com', tokenUrl: 'http://127.0.0.1:9099/securetoken.googleapis.com', firestoreUrl: 'http://127.0.0.1:8080' };
const memory = () => { const m = new Map(); return { get: async k => m.get(k), set: async (k, v) => m.set(k, v) }; };
const look = { character: 'mochi', color: 'mint', outfit: ['bow'] };

let passed = 0;
const step = async (name, fn) => {
  try { await fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { console.error(`FAIL ${name}\n     ${e.stack || e}`); process.exitCode = 1; }
};
const denied = async (promise, what) => {
  try { await promise; } catch (e) { assert.ok(e.status === 403 || /PERMISSION_DENIED/.test(e.code), `${what}: expected denied, got ${e.status} ${e.code}`); return; }
  assert.fail(`${what}: should have been denied`);
};

(async () => {
  const anna = new OnlineApi(cfg, memory()), ben = new OnlineApi(cfg, memory()), eve = new OnlineApi(cfg, memory());
  let A, B, E, fid;
  await step('three anonymous accounts get cards and codes', async () => {
    A = await anna.saveProfile({ name: 'Anna', look, level: 3 });
    B = await ben.saveProfile({ name: 'Ben', look: { character: 'cat', color: 'night', outfit: [] }, level: 7 });
    E = await eve.saveProfile({ name: 'Eve', look, level: 1 });
    for (const p of [A, B, E]) assert.match(p.code, /^MOCHI-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.notEqual(A.code, B.code);
    const again = await anna.saveProfile({ name: 'Anna R.', look, level: 4 });
    assert.equal(again.code, A.code, 'the code stays the same');
  });
  await step('a code with odd spacing still finds the friend; my own code is "self"', async () => {
    assert.equal((await anna.request(A.code, { name: 'Anna', look })).status, 'self');
    assert.equal((await anna.request('mochi zzzz-zzzz', { name: 'Anna', look })).status, 'not-found');
    const r = await anna.request(B.code.toLowerCase().replace(/-/g, ' '), { name: 'Anna', look });
    assert.equal(r.status, 'sent');
    assert.equal((await anna.request(B.code, { name: 'Anna', look })).status, 'pending');
  });
  await step('Ben sees the request; Eve cannot see it', async () => {
    const inbox = await ben.incoming();
    assert.equal(inbox.length, 1); assert.equal(inbox[0].name, 'Anna'); assert.equal(inbox[0].from, A.uid);
    assert.equal((await eve.incoming()).length, 0);
    await denied(eve.get(`requests/${A.uid}_${B.uid}`), 'Eve reads the request');
  });
  await step('nobody can fake a request or a friendship', async () => {
    await denied(eve.commit([{ path: `requests/${A.uid}_${B.uid}x`, data: { from: A.uid, to: B.uid, name: 'Anna', look } }]), 'request sent in Anna\'s name');
    const [x, y] = [E.uid, B.uid].sort();
    await denied(eve.commit([{ path: `friendships/${x}_${y}`, data: { members: [x, y], xp: 0, seen: {}, bonusDay: '' } }]), 'friendship without a request');
  });
  await step('Ben accepts: a friendship for the two of them', async () => {
    fid = await ben.accept({ from: A.uid });
    assert.equal((await ben.incoming()).length, 0, 'the request is gone');
    const fa = await anna.friendships(), fb = await ben.friendships();
    assert.equal(fa.length, 1); assert.equal(fb.length, 1); assert.equal(fa[0].id, fid);
    assert.equal(fa[0].other, B.uid); assert.equal(fb[0].other, A.uid);
    assert.equal((await eve.friendships()).length, 0);
    await denied(eve.get(`friendships/${fid}`), 'Eve reads the friendship');
  });
  await step('messages: friends read and write, Eve can do neither', async () => {
    await anna.send(fid, 'Hi Ben! 👋');
    await ben.send(fid, '⭐', 'sticker');
    await ben.send(fid, 'Hi Anna!');
    const msgs = await anna.messages(fid);
    assert.deepEqual(msgs.map(m => m.text), ['Hi Ben! 👋', '⭐', 'Hi Anna!']);
    assert.equal(msgs[0].from, A.uid);
    await denied(eve.messages(fid), 'Eve reads messages');
    await denied(eve.commit([{ path: `friendships/${fid}/messages/zzz`, data: { from: E.uid, text: 'spam', kind: 'text' } }]), 'Eve writes a message');
    await denied(anna.commit([{ path: `friendships/${fid}/messages/fake`, data: { from: B.uid, text: 'fake', kind: 'text' } }]), 'Anna writes as Ben');
    await denied(anna.commit([{ path: `friendships/${fid}/messages/long`, data: { from: A.uid, text: 'x'.repeat(501), kind: 'text' } }]), 'a 501-character message');
  });
  await step('shared XP: messages add a little, cheating is refused', async () => {
    const f = (await anna.friendships())[0];
    assert.equal(f.xp, 5, '2 + 1 + 2');
    assert.equal(f.last.text, 'Hi Anna!');
    await denied(anna.commit([{ path: `friendships/${fid}`, data: { xp: 9999 }, mask: ['xp'] }]), 'jump to 9999 XP');
    await denied(anna.commit([{ path: `friendships/${fid}`, data: { xp: 0 }, mask: ['xp'] }]), 'lower the XP');
  });
  await step('both here today: one +10 bonus, only once', async () => {
    let f = (await anna.friendships())[0];
    assert.equal(await anna.checkIn(f), false, 'Anna alone: no bonus');
    f = (await ben.friendships())[0];
    assert.equal(await ben.checkIn(f), true, 'Ben too: bonus');
    f = (await anna.friendships())[0];
    assert.equal(f.xp, 15);
    assert.equal(await anna.checkIn(f), false, 'no second bonus today');
    assert.equal((await anna.friendships())[0].xp, 15);
  });
  await step('snapshot: my card, requests and friends with their cards', async () => {
    const s = await anna.snapshot();
    assert.equal(s.me.name, 'Anna R.'); assert.equal(s.friends[0].card.name, 'Ben'); assert.equal(s.friends[0].card.look.character, 'cat');
    assert.equal(s.friends[0].level, 1);
  });
  await step('block: Eve blocked by Ben cannot ask again; unfriending clears messages', async () => {
    assert.equal((await eve.request(B.code, { name: 'Eve', look })).status, 'sent');
    await ben.block(E.uid);
    assert.equal((await ben.incoming()).length, 0, 'her request is gone');
    await eve.cancel({ to: B.uid });
    assert.equal((await eve.request(B.code, { name: 'Eve', look })).status, 'not-found', 'blocked looks like unknown');
  });
  await step('delete everything: Anna\'s data is gone, Ben keeps his own', async () => {
    await anna.deleteEverything();
    assert.equal((await ben.friendships()).length, 0);
    assert.equal(await ben.get(`codes/${A.code}`), null);
    assert.equal(await ben.get(`users/${A.uid}`), null);
    assert.ok(await ben.get(`users/${B.uid}`));
  });
  console.log(`\n${passed} passed${process.exitCode ? ', some failed' : ''}`);
})();
