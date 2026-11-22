/*
 * Mochi — online friends: the network part (Firebase, through its REST API).
 *
 * This is the only file in Mochi that talks to the internet, and only after
 * you turn on Online friends in Settings. It runs in the extension's
 * background worker (src/background.js); pages ask it through messages.
 * No Firebase SDK and no remote code: plain fetch() to Firebase's REST API.
 *
 * What goes to the server (Firebase, owned by whoever set up this build):
 *   - an anonymous account (no email, no Google name: just a random id)
 *   - your Mochi code, the name you pick, Mochi's look and level
 *   - friend requests, friendships, the shared friendship XP
 *   - the messages you write to friends
 * Nothing from your Claude chats, ever. "Delete my online data" removes it all.
 *
 * Data shape and access rules: online/firestore.rules.
 */
(() => {
  const G = globalThis;
  const Mochi = (G.Mochi = G.Mochi || {});

  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const LEVELS = [0, 20, 60, 120, 200, 300, 420, 560, 720, 900, 1100, 1320];

  /** Friendship level from shared XP (1…12). */
  const friendLevel = xp => { let lv = 1; LEVELS.forEach((need, i) => { if (xp >= need) lv = i + 1; }); return lv; };
  const pairId = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const newCode = () => {
    const pick = () => CODE_CHARS[crypto.getRandomValues(new Uint32Array(1))[0] % CODE_CHARS.length];
    const four = () => Array.from({ length: 4 }, pick).join('');
    return `MOCHI-${four()}-${four()}`;
  };
  const cleanCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^MOCHI/, '').replace(/^(.{4})(.{4}).*$/, 'MOCHI-$1-$2');

  // ——— Firestore values ⇄ plain JS ———
  function enc(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (v instanceof Date) return { timestampValue: v.toISOString() };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
    return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
  }
  function dec(v) {
    if (!v) return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('timestampValue' in v) return v.timestampValue;
    if ('nullValue' in v) return null;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
    if ('mapValue' in v) return decFields(v.mapValue.fields || {});
    return null;
  }
  const decFields = f => Object.fromEntries(Object.entries(f || {}).map(([k, x]) => [k, dec(x)]));
  const fieldsOf = obj => Object.fromEntries(Object.entries(obj).map(([k, x]) => [k, enc(x)]));
  const docOut = d => (d ? { id: d.name.split('/').pop(), path: d.name.split('/documents/')[1], ...decFields(d.fields) } : null);

  class OnlineError extends Error {
    constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
  }

  /**
   * One online connection. `storage` keeps the session ({ get(key), set(key, value) }).
   * config: { apiKey, projectId, authUrl, tokenUrl, firestoreUrl }.
   */
  class OnlineApi {
    constructor(config, storage) {
      this.cfg = {
        authUrl: 'https://identitytoolkit.googleapis.com',
        tokenUrl: 'https://securetoken.googleapis.com',
        firestoreUrl: 'https://firestore.googleapis.com',
        ...config,
      };
      this.storage = storage;
      this.session = null;
    }

    get configured() { return !!(this.cfg.apiKey && this.cfg.projectId); }
    get root() { return `projects/${this.cfg.projectId}/databases/(default)/documents`; }
    get docs() { return `${this.cfg.firestoreUrl}/v1/${this.root}`; }

    // ——— account (anonymous) ———
    async signIn() {
      if (!this.configured) throw new OnlineError(0, 'not-configured');
      if (!this.session) this.session = (await this.storage.get('online.session')) || null;
      if (this.session && this.session.expiresAt > Date.now() + 60000) return this.session;
      if (this.session?.refreshToken) {
        try { return await this.refresh(); } catch (_) { /* start over below */ }
      }
      const r = await this.post(`${this.cfg.authUrl}/v1/accounts:signUp?key=${this.cfg.apiKey}`, { returnSecureToken: true }, false);
      return this.keep({ uid: r.localId, idToken: r.idToken, refreshToken: r.refreshToken, expiresIn: r.expiresIn });
    }
    async refresh() {
      const res = await fetch(`${this.cfg.tokenUrl}/v1/token?key=${this.cfg.apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(this.session.refreshToken)}`,
      });
      const r = await res.json();
      if (!res.ok) throw new OnlineError(res.status, r.error?.message || 'refresh-failed');
      return this.keep({ uid: r.user_id, idToken: r.id_token, refreshToken: r.refresh_token, expiresIn: r.expires_in });
    }
    async keep({ uid, idToken, refreshToken, expiresIn }) {
      this.session = { uid, idToken, refreshToken, expiresAt: Date.now() + Number(expiresIn || 3600) * 1000 };
      await this.storage.set('online.session', this.session);
      return this.session;
    }
    get uid() { return this.session?.uid; }

    // ——— HTTP ———
    async post(url, body, auth = true) { return this.call('POST', url, body, auth); }
    async call(method, url, body, auth = true, retry = true) {
      const headers = { 'Content-Type': 'application/json' };
      if (auth) headers.Authorization = `Bearer ${(await this.signIn()).idToken}`;
      const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (res.status === 401 && auth && retry) { this.session.expiresAt = 0; return this.call(method, url, body, auth, false); }
      if (!res.ok) {
        const e = Array.isArray(data) ? data[0]?.error : data.error;
        throw new OnlineError(res.status, e?.status || e?.message || `http-${res.status}`, e?.message);
      }
      return data;
    }
    async get(path) {
      try { return docOut(await this.call('GET', `${this.docs}/${path}`)); } catch (e) { if (e.status === 404) return null; throw e; }
    }
    async remove(path) {
      try { await this.call('DELETE', `${this.docs}/${path}`); } catch (e) { if (e.status !== 404) throw e; }
    }
    /** Writes, all or nothing: [{ path, data, mask?, mustNotExist?, increment?: { field: n }, serverTime?: [field] }] */
    async commit(writes) {
      const body = {
        writes: writes.map(w => (w.delete ? { delete: `${this.root}/${w.delete}` } : {
          update: { name: `${this.root}/${w.path}`, fields: fieldsOf(w.data || {}) },
          ...(w.mask ? { updateMask: { fieldPaths: w.mask } } : {}),
          ...(w.mustNotExist ? { currentDocument: { exists: false } } : {}),
          ...((w.increment || w.serverTime) ? { updateTransforms: [
            ...Object.entries(w.increment || {}).map(([f, n]) => ({ fieldPath: f, increment: { integerValue: String(n) } })),
            ...(w.serverTime || []).map(f => ({ fieldPath: f, setToServerValue: 'REQUEST_TIME' })),
          ] } : {}),
        })),
      };
      return this.post(`${this.cfg.firestoreUrl}/v1/${this.root}:commit`, body);
    }
    async query(parent, collection, where, { orderBy, desc = false, limit = 50 } = {}) {
      const filters = where.map(([field, op, value]) => ({ fieldFilter: { field: { fieldPath: field }, op, value: enc(value) } }));
      const structuredQuery = {
        from: [{ collectionId: collection }],
        ...(filters.length ? { where: filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } } } : {}),
        ...(orderBy ? { orderBy: [{ field: { fieldPath: orderBy }, direction: desc ? 'DESCENDING' : 'ASCENDING' }] } : {}),
        limit,
      };
      const url = `${this.docs}${parent ? `/${parent}` : ''}:runQuery`;
      const rows = await this.post(url, { structuredQuery });
      return rows.filter(r => r.document).map(r => docOut(r.document));
    }

    // ——— my card ———
    /** Creates or updates my card ({ name, look, level }); gives me a code the first time. */
    async saveProfile({ name, look, level }) {
      await this.signIn();
      let profile = await this.get(`users/${this.uid}`);
      let code = profile?.code;
      for (let i = 0; !code && i < 5; i++) {
        const c = newCode();
        try { await this.commit([{ path: `codes/${c}`, data: { uid: this.uid }, mustNotExist: true }]); code = c; } catch (e) { if (e.status !== 409 && !/ALREADY_EXISTS|FAILED_PRECONDITION/.test(e.code)) throw e; }
      }
      const data = { code, name: String(name || 'Mochi').slice(0, 24) || 'Mochi', look, level: Math.max(1, Math.min(999, level | 0 || 1)) };
      await this.commit([{ path: `users/${this.uid}`, data, serverTime: ['at'] }]);
      return { uid: this.uid, ...data };
    }
    async profile(uid) { return this.get(`users/${uid}`); }

    // ——— requests ———
    /** Sends a friend request to a code. → { status: 'sent' | 'accepted' | 'self' | 'not-found' | 'already-friends' | 'pending' } */
    async request(codeText, { name, look }) {
      await this.signIn();
      const code = cleanCode(codeText);
      if (!/^MOCHI-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) return { status: 'not-found' };
      const entry = await this.get(`codes/${code}`);
      if (!entry) return { status: 'not-found' };
      const to = entry.uid;
      if (to === this.uid) return { status: 'self' };
      if (await this.get(`friendships/${pairId(this.uid, to)}`)) return { status: 'already-friends' };
      // They already asked me: accepting is the friendliest answer.
      const theirs = await this.get(`requests/${to}_${this.uid}`);
      if (theirs) { await this.accept({ from: to }); return { status: 'accepted', uid: to }; }
      try {
        await this.commit([{ path: `requests/${this.uid}_${to}`, data: { from: this.uid, to, name: String(name || 'Mochi').slice(0, 24), look }, mustNotExist: true, serverTime: ['at'] }]);
      } catch (e) {
        if (/ALREADY_EXISTS|FAILED_PRECONDITION/.test(e.code) || e.status === 409) return { status: 'pending' };
        if (e.status === 403) return { status: 'not-found' }; // blocked looks the same as unknown
        throw e;
      }
      return { status: 'sent', uid: to };
    }
    async incoming() { await this.signIn(); return this.query('', 'requests', [['to', 'EQUAL', this.uid]], { limit: 30 }); }
    async outgoing() { await this.signIn(); return this.query('', 'requests', [['from', 'EQUAL', this.uid]], { limit: 30 }); }
    async accept({ from }) {
      await this.signIn();
      const [a, b] = [this.uid, from].sort();
      await this.commit([{ path: `friendships/${a}_${b}`, data: { members: [a, b], xp: 0, seen: {}, bonusDay: '' }, mustNotExist: true, serverTime: ['at'] }]);
      await this.remove(`requests/${from}_${this.uid}`);
      return pairId(a, b);
    }
    async decline({ from }) { await this.signIn(); await this.remove(`requests/${from}_${this.uid}`); }
    async cancel({ to }) { await this.signIn(); await this.remove(`requests/${this.uid}_${to}`); }

    // ——— friends and messages ———
    async friendships() {
      await this.signIn();
      const list = await this.query('', 'friendships', [['members', 'ARRAY_CONTAINS', this.uid]], { limit: 50 });
      return list.map(f => ({ ...f, other: f.members.find(m => m !== this.uid), level: friendLevel(f.xp || 0) }));
    }
    async messages(fid, limit = 40) {
      const list = await this.query(`friendships/${fid}`, 'messages', [], { orderBy: 'at', desc: true, limit });
      return list.reverse();
    }
    /** Sends a message (or a sticker) and adds a little shared XP. */
    async send(fid, text, kind = 'text') {
      await this.signIn();
      const clean = String(text || '').trim().slice(0, 500);
      if (!clean) return null;
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      await this.commit([
        { path: `friendships/${fid}/messages/${id}`, data: { from: this.uid, text: clean, kind }, mustNotExist: true, serverTime: ['at'] },
        { path: `friendships/${fid}`, data: { last: { from: this.uid, kind, text: clean.slice(0, 80) } }, mask: ['last'], increment: { xp: kind === 'sticker' ? 1 : 2 }, serverTime: ['last.at'] },
      ]);
      return id;
    }
    /** Once a day: "I was here". If my friend was here today too, we both get a bonus. */
    async checkIn(f) {
      const day = today();
      const seen = { ...(f.seen || {}) };
      if (seen[this.uid] === day && (f.bonusDay === day || seen[f.other] !== day)) return false;
      seen[this.uid] = day;
      const bonus = seen[f.other] === day && f.bonusDay !== day;
      await this.commit([{ path: `friendships/${f.id}`, data: { seen, ...(bonus ? { bonusDay: day } : {}) }, mask: bonus ? ['seen', 'bonusDay'] : ['seen'], ...(bonus ? { increment: { xp: 10 } } : {}) }]);
      return bonus;
    }
    async clearMessages(fid) {
      for (let round = 0; round < 20; round++) {
        const list = await this.query(`friendships/${fid}`, 'messages', [], { limit: 200 });
        if (!list.length) return;
        await this.commit(list.map(m => ({ delete: `friendships/${fid}/messages/${m.id}` })));
      }
    }
    async unfriend(fid) { await this.signIn(); await this.clearMessages(fid); await this.remove(`friendships/${fid}`); }
    async block(uid) {
      await this.signIn();
      await this.commit([{ path: `blocks/${this.uid}_${uid}`, data: { who: uid, by: this.uid }, serverTime: ['at'] }]);
      const fid = pairId(this.uid, uid);
      if (await this.get(`friendships/${fid}`)) await this.unfriend(fid);
      await this.remove(`requests/${uid}_${this.uid}`);
    }

    /** Everything about me on the server: friendships and their messages, requests, my code and card, the account. */
    async deleteEverything() {
      await this.signIn();
      for (const f of await this.friendships()) await this.unfriend(f.id);
      for (const r of [...await this.incoming(), ...await this.outgoing()]) await this.remove(`requests/${r.id}`);
      for (const b of await this.query('', 'blocks', [['by', 'EQUAL', this.uid]], { limit: 200 })) await this.remove(`blocks/${b.id}`);
      const me = await this.get(`users/${this.uid}`);
      if (me?.code) await this.remove(`codes/${me.code}`);
      await this.remove(`users/${this.uid}`);
      try { await this.post(`${this.cfg.authUrl}/v1/accounts:delete?key=${this.cfg.apiKey}`, { idToken: this.session.idToken }, false); } catch (_) { /* the data is gone already */ }
      this.session = null;
      await this.storage.set('online.session', null);
    }

    /** One round trip for the UI: who I am, requests, friends (with their cards). */
    async snapshot() {
      await this.signIn();
      const [me, incoming, outgoing, friends] = await Promise.all([this.get(`users/${this.uid}`), this.incoming(), this.outgoing(), this.friendships()]);
      const cards = await Promise.all(friends.map(f => this.profile(f.other).catch(() => null)));
      return { uid: this.uid, me, incoming, outgoing, friends: friends.map((f, i) => ({ ...f, card: cards[i] })) };
    }
  }

  Mochi.OnlineApi = OnlineApi;
  Mochi.online = Object.assign(Mochi.online || {}, { friendLevel, LEVELS, pairId, cleanCode, newCode, enc, dec });
})();
