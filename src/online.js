/*
 * Mochi — online friends (the part you see). Off by default.
 *
 *   Menu → Friends → Online friends
 *   - Turn on (after reading what is shared) and pick a name for friends.
 *   - Your Mochi code (MOCHI-XXXX-XXXX): give it to a friend, or type theirs
 *     → they get a friend request → Accept.
 *   - Friends: chat (and stickers from friendship level 2). When a friend
 *     writes, their Mochi visits your screen, in their colors and outfit, and
 *     says the message. Using Mochi on the same day and writing to each other
 *     grows a shared friendship level; level 5 unlocks a matching scarf.
 *   - Block, unfriend, turn off, or delete all your online data.
 *
 * The network part is src/online-api.js, in the extension's background
 * worker: this file only asks it. Nothing happens online until you turn it on.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const STICKERS = ['👋', '❤️', '⭐', '😂', '🎉', '🙌'];
  const POLL_MS = 45000;
  const CHAT_POLL_MS = 5000;
  const LOCAL = 'online.local';

  Mochi.settings.define({ online: { on: false, name: '' } });

  // ——— talking to the network part ———
  const inExtension = !!globalThis.chrome?.runtime?.id;
  let direct = null; // the test page has no background worker: same API, in the page
  function call(method, ...args) {
    if (inExtension) {
      return new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage({ type: 'mochi-online', method, args }, res => {
            const err = chrome.runtime.lastError;
            if (err || !res) return reject(Object.assign(new Error(err?.message || 'no answer'), { code: 'no-background' }));
            if (res.ok) resolve(res.result); else reject(Object.assign(new Error(res.error.code), res.error));
          });
        } catch (e) { reject(e); }
      });
    }
    if (method === 'status') return Promise.resolve({ configured: !!(Mochi.onlineConfig?.apiKey && Mochi.onlineConfig?.projectId) });
    if (!Mochi.OnlineApi) return Promise.reject(Object.assign(new Error('not-configured'), { code: 'not-configured' }));
    direct = direct || new Mochi.OnlineApi(Mochi.onlineConfig, { get: k => Mochi.store.get(k), set: (k, v) => Mochi.store.set(k, v) });
    return direct[method](...args);
  }

  const today = () => Mochi.store.today();
  const hearts = lv => '♥'.repeat(Math.min(5, lv)) + (lv > 5 ? '+' : '');

  // How many outfit ids a look may carry: 4 (head, face, neck, clothes) since 1.32. A server whose
  // rules weren't updated yet allows 3: then clothes are left out (learned from the first refusal).
  let lookMax = 4;
  /** What my Mochi looks like, for friends: character, color theme, outfits (built-in ones only). */
  function myLook(companion) {
    const character = companion.character?.id || 'mochi';
    const color = Mochi.settings.get(`colors.${character}`) || (character === 'mochi' ? 'orange' : 'classic');
    const outfit = (Mochi.outfits?.wearing() || []).filter(o => !o.custom).map(o => o.id).slice(0, lookMax);
    return { character, color, outfit, golden: companion.root.classList.contains('golden') };
  }
  const themeOf = look => (look?.golden ? Mochi.eggs?.GOLD : look?.color && look.color !== 'classic' ? Mochi.colorThemes?.[look.color] : null) || null;
  const outfitsOf = look => (look?.outfit || []).map(id => Mochi.outfits?.byId(id)).filter(o => o && !o.custom);

  /** A small picture of someone's Mochi from their look (an <img>, so nothing leaks into the page). */
  function lookThumb(look, size = 40) {
    const char = Mochi.characters.get(look?.character) || Mochi.characters.get('mochi');
    const colors = { ...Mochi.art.ROLE_DEFAULTS, ...char.colors, ...(themeOf(look) || {}) };
    const outfits = outfitsOf(look).map(o => ({ slot: o.slot, hide: o.hide || [], markup: Mochi.outfits.markup(o).replace(/var\(--m-([a-z-]+)\)/g, (m, r) => colors[r.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] || m) }));
    const img = document.createElement('img');
    img.alt = '';
    img.width = img.height = size;
    img.className = 'ol-thumb';
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(Mochi.art.staticSvg({ mood: 'happy', parts: char.parts, colors, outfits, size, withShadow: false }))}`;
    return img;
  }

  Mochi.features = Mochi.features || [];
  Mochi.features.push({
    id: 'online',
    init(ctx) {
      const { companion, panel } = ctx;
      const { h, copyText } = Mochi.ui;
      const t = Mochi.t;
      const S = Mochi.settings;
      const state = { configured: false, snap: null, error: null, consenting: false, sure: null };
      let local = { lastRead: {}, notified: {}, seenRequests: [], levels: {}, checked: {}, best: 0, ready: false };
      let pollTimer = null, chatTimer = null, chatVis = null, visiting = false;

      const on = () => S.get('online.on') === true && state.configured;
      const name = () => (S.get('online.name') || '').trim() || 'Mochi';
      const saveLocal = () => Mochi.store.set(LOCAL, local);
      const refreshMenu = () => Mochi.menuInstance?.refresh?.();
      // Typing in Mochi's own fields shouldn't reach the page's keyboard shortcuts.
      const quiet = el => { for (const type of ['keydown', 'keyup', 'keypress', 'input']) el.addEventListener(type, ev => ev.stopPropagation()); return el; };
      Mochi.onlineBestFriendship = () => local.best || 0;

      // ——— a friend's Mochi visits ———
      function visit(card, text, level = 1) {
        const from = card?.name || 'Mochi';
        if (!card || visiting || document.hidden || companion.isHidden || companion.isTucked || !Mochi.Buddy) {
          companion.say(`💌 ${from}: ${text}`.slice(0, 140), 4000);
          return;
        }
        visiting = true;
        companion.bubble.classList.remove('show'); // the guest does the talking
        const own = Mochi.friends?.buddy;
        if (own) own.wrap.hidden = true;
        const guest = new Mochi.Buddy(companion).mountBeside();
        guest.wrap.classList.add('guest');
        guest.setCharacter(Mochi.characters.get(card.look?.character) || Mochi.characters.get('mochi'));
        guest.applyColors(themeOf(card.look));
        guest.setOutfit(outfitsOf(card.look).map(o => ({ slot: o.slot, markup: Mochi.outfits.markup(o), hide: o.hide || [] })));
        companion.root.classList.add('has-friend');
        guest.setMood('happy');
        guest.play('wave');
        guest.say(`${from}: ${text}`.slice(0, 140), 5200);
        companion.lookAtElement?.(guest.el, 2200);
        Mochi.sound?.play('pop');
        if (level >= 3) setTimeout(() => { guest.play('celebrate'); companion.play('celebrate'); }, 2200);
        setTimeout(() => {
          guest.play('hop');
          setTimeout(() => {
            guest.remove();
            if (own) own.wrap.hidden = false; else companion.root.classList.remove('has-friend');
            visiting = false;
          }, 500);
        }, 7000);
        ctx.emit('onlineVisit', card);
      }

      // ——— keeping up with the server ———
      async function syncProfile(snap) {
        const level = Mochi.progress?.level?.() || 1;
        const look = myLook(companion);
        const me = snap?.me;
        if (me && me.name === name() && me.level === level && JSON.stringify(me.look) === JSON.stringify(look)) return me;
        try {
          return await call('saveProfile', { name: name(), look, level });
        } catch (e) {
          // Older rules on the server (≤ 3 outfits): send the look without clothes from now on.
          if (e?.status !== 403 || look.outfit.length <= 3 || lookMax === 3) throw e;
          lookMax = 3;
          return call('saveProfile', { name: name(), look: myLook(companion), level });
        }
      }

      async function refresh({ quietly = false } = {}) {
        if (!on()) return;
        try {
          let snap = await call('snapshot');
          if (!snap.me || snap.me.name !== name()) { await syncProfile(snap); snap = await call('snapshot'); } else syncProfile(snap).catch(() => {});
          state.snap = snap;
          state.error = null;
          if (!quietly) announce(snap);
          // Once a day per friend: "I was here" (both here today → a bonus).
          for (const f of snap.friends) {
            if (local.checked[f.id] === today()) continue;
            local.checked[f.id] = today();
            call('checkIn', f).then(bonus => { if (bonus) companion.say(t('online.bonusSay', { name: f.card?.name || 'Mochi' }), 3200); }).catch(() => {});
          }
          const best = Math.max(0, ...snap.friends.map(f => f.level));
          if (best >= 5 && (local.best || 0) < 5) setTimeout(() => companion.say(t('online.scarfSay'), 3000), 1200);
          if (best !== local.best) { local.best = best; Mochi.outfits?.apply(companion); }
          saveLocal();
        } catch (e) {
          state.error = e.code || String(e);
        }
        refreshMenu();
      }

      function announce(snap) {
        // The first time: just remember what's there (no fanfare for old news).
        if (!local.ready) {
          local.seenRequests = snap.incoming.map(r => r.id);
          for (const f of snap.friends) { local.levels[f.id] = f.level; if (f.last?.at) local.notified[f.id] = f.last.at; }
          local.ready = true;
          return;
        }
        for (const r of snap.incoming) {
          if (local.seenRequests.includes(r.id)) continue;
          local.seenRequests = [...local.seenRequests, r.id].slice(-50);
          companion.play('hop');
          companion.say(t('online.requestSay', { name: r.name }), 4000);
        }
        for (const f of snap.friends) {
          const who = f.card?.name || 'Mochi';
          if (!(f.id in local.levels)) {
            local.levels[f.id] = f.level;
            companion.play('celebrate');
            companion.say(t('online.newFriendSay', { name: who }), 3200);
          } else if (f.level > local.levels[f.id]) {
            local.levels[f.id] = f.level;
            companion.play('celebrate');
            companion.flashFx('sparkles', 1800);
            companion.say(t('online.levelUpSay', { level: f.level, name: who }), 3400);
          }
          const last = f.last;
          if (last?.at && last.from !== snap.uid && local.notified[f.id] !== last.at && !(chatOpenFor === f.id)) {
            local.notified[f.id] = last.at;
            visit(f.card, last.kind === 'sticker' ? last.text : last.text, f.level);
          }
        }
      }

      function startPolling() {
        clearInterval(pollTimer);
        if (!on()) return;
        pollTimer = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
        // A moment after Mochi's hello, so the news isn't talked over.
        setTimeout(() => refresh({ quietly: false }), Math.max(0, 3200 - performance.now()));
      }

      // ——— the chat (in Mochi's sheet) ———
      let chatOpenFor = null;
      async function openChat(f) {
        chatOpenFor = f.id;
        const who = f.card?.name || 'Mochi';
        const list = h('div', { class: 'ol-chat', role: 'log', 'aria-live': 'polite' });
        const input = quiet(h('input', { class: 'lib-input', type: 'text', maxlength: '500', placeholder: t('online.say'), 'aria-label': t('online.say'), 'data-field': 'message' }));
        const sendNow = async (text, kind = 'text') => {
          if (!String(text).trim()) return;
          try { await call('send', f.id, text, kind); input.value = ''; idle = 0; await poll(); Mochi.sound?.play('pop'); } catch (_) { companion.say(t('online.error'), 2400); }
        };
        input.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); sendNow(input.value); } });
        const stickers = f.level >= 2
          ? h('div', { class: 'ol-stickers' }, ...STICKERS.map(s => h('button', { class: 'px-btn ol-sticker', type: 'button', 'data-sticker': s, onclick: () => sendNow(s, 'sticker') }, s)))
          : h('p', { class: 'note', text: t('online.stickersLocked') });
        const confirmBtn = (id, label, run) => h('button', {
          class: 'px-btn danger', type: 'button', 'data-act': id,
          onclick: async ev => {
            if (state.sure !== id) { state.sure = id; ev.currentTarget.textContent = t('online.sure'); return; }
            state.sure = null; panel.close(); await run(); await refresh({ quietly: true });
          },
        }, label);
        // Incremental chat: the opening page once, then each tick reads only the friendship doc (1 read) and
        // fetches new messages only when `last.at` moved — so a quiet chat costs ~1 read per poll, not 40.
        let msgs = [], seen = new Set(), lastAt = null, lastLastAt = null, idle = 0;
        const render = () => {
          const uid = state.snap?.uid;
          list.replaceChildren(...(msgs.length ? msgs.map(m => h('div', { class: `ol-msg ${m.from === uid ? 'me' : 'them'}${m.kind === 'sticker' ? ' sticker' : ''}` },
            h('span', { class: 'ol-text', text: m.text }))) : [h('p', { class: 'note', text: t('online.empty') })]));
          list.scrollTop = list.scrollHeight;
        };
        const addNew = fresh => {
          let added = 0;
          for (const m of fresh) { if (m.id && seen.has(m.id)) continue; if (m.id) seen.add(m.id); msgs.push(m); added++; if (m.at && (!lastAt || m.at > lastAt)) lastAt = m.at; }
          if (added) { render(); const newest = msgs.at(-1); if (newest?.at) { local.lastRead[f.id] = newest.at; local.notified[f.id] = f.last?.at || local.notified[f.id]; saveLocal(); } }
          return added;
        };
        async function load() { // the opening page: the most recent messages, once
          try { msgs = []; seen = new Set(); lastAt = null; addNew(await call('chatSince', f.id, null, 30)); lastLastAt = f.last?.at || null; if (!msgs.length) render(); }
          catch (_) { render(); }
        }
        async function poll() { // a cheap tick: friendship doc first, messages only if it changed
          try {
            const meta = await call('friendshipMeta', f.id);
            const at = meta?.last?.at || null;
            if (at && at !== lastLastAt) { lastLastAt = at; idle = addNew(await call('chatSince', f.id, lastAt, 40)) ? 0 : idle + 1; }
            else idle++;
          } catch (_) { idle++; }
        }
        panel.open(t('online.chatWith', { name: who }), `${hearts(f.level)} ${t('online.level', { level: f.level })}`,
          h('div', { class: 'ol-chatbox' }, list, stickers, h('div', { class: 'row ol-form' }, input, h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'send', onclick: () => sendNow(input.value) }, t('online.send')))),
          h('div', { class: 'row' }, confirmBtn('unfriend', t('online.unfriend'), () => call('unfriend', f.id)), confirmBtn('block', t('online.block'), () => call('block', f.other))));
        panel.view = `chat:${f.id}`;
        await load();
        input.focus();
        // Adaptive backoff: 5 s while there's talk, easing to 15 s then 30 s when idle; nothing while the tab is hidden.
        const closed = () => panel.view !== `chat:${f.id}` || panel.sheet.hidden;
        const delay = () => (idle >= 6 ? 30000 : idle >= 3 ? CHAT_POLL_MS * 3 : CHAT_POLL_MS);
        function schedule() {
          clearTimeout(chatTimer);
          if (document.hidden) return; // paused while the tab is in the background; visibilitychange resumes it
          chatTimer = setTimeout(async () => {
            if (closed()) { stopChat(); return; }
            await poll();
            schedule();
          }, delay());
        }
        function stopChat() { clearTimeout(chatTimer); if (chatVis) { document.removeEventListener('visibilitychange', chatVis); chatVis = null; } chatOpenFor = null; }
        if (chatVis) document.removeEventListener('visibilitychange', chatVis);
        chatVis = () => {
          if (closed()) { stopChat(); return; }
          if (document.hidden) { clearTimeout(chatTimer); return; }
          idle = 0; poll().then(schedule);
        };
        document.addEventListener('visibilitychange', chatVis);
        schedule();
      }

      // ——— Menu → Friends → Online friends ———
      Mochi.menu.addView('friends', () => {
        const box = h('div', { class: 'online' }, h('h4', { class: 'app-sub', text: t('online.title') }));
        if (!state.configured) { box.append(h('p', { class: 'note', text: t('online.notSetUp') })); return box; }
        if (!on()) {
          if (!state.consenting) {
            box.append(h('p', { class: 'note ol-pitch', text: t('online.pitch') }),
              h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'online-start', onclick: () => { state.consenting = true; refreshMenu(); } }, t('online.turnOn')));
            return box;
          }
          const nameIn = quiet(h('input', { class: 'lib-input', type: 'text', maxlength: '24', placeholder: t('online.namePh'), 'aria-label': t('online.namePh'), 'data-field': 'online-name' }));
          nameIn.value = S.get('online.name') || '';
          box.append(h('p', { class: 'note ol-consent', text: t('online.consent') }), nameIn,
            h('div', { class: 'row' },
              h('button', {
                class: 'px-btn primary', type: 'button', 'data-act': 'online-agree',
                onclick: async () => {
                  await S.set('online.name', nameIn.value.trim().slice(0, 24) || 'Mochi');
                  state.consenting = false;
                  await S.set('online.on', true);
                },
              }, t('online.agree')),
              h('button', { class: 'px-btn', type: 'button', onclick: () => { state.consenting = false; refreshMenu(); } }, t('library.cancel'))));
          return box;
        }
        const snap = state.snap;
        if (state.error) box.append(h('p', { class: 'note ol-error', text: t('online.error') }));
        if (!snap) { box.append(h('p', { class: 'note', text: t('online.loading') })); return box; }
        // my code
        box.append(h('div', { class: 'ol-code-row' },
          h('span', { class: 'ol-label', text: t('online.myCode') }),
          h('b', { class: 'ol-code', 'data-field': 'my-code', text: snap.me?.code || '…' }),
          h('button', { class: 'px-btn', type: 'button', 'data-act': 'copy-code', onclick: async () => { if (snap.me?.code && await copyText(snap.me.code, companion.shadow)) ctx.actions.copied(snap.me.code); } }, t('online.copyCode'))));
        // add a friend
        const codeIn = quiet(h('input', { class: 'lib-input', type: 'text', maxlength: '20', placeholder: 'MOCHI-XXXX-XXXX', 'aria-label': t('online.add'), 'data-field': 'friend-code' }));
        const add = async () => {
          if (!codeIn.value.trim()) return;
          try {
            const res = await call('request', codeIn.value, { name: name(), look: myLook(companion) });
            const key = { sent: 'online.sent', accepted: 'online.becameFriends', self: 'online.self', 'not-found': 'online.notFound', 'already-friends': 'online.already', pending: 'online.pending' }[res.status] || 'online.error';
            companion.say(t(key), 2600);
            if (res.status === 'sent' || res.status === 'accepted') { codeIn.value = ''; companion.play('hop'); }
          } catch (_) { companion.say(t('online.error'), 2600); }
          refresh({ quietly: true });
        };
        codeIn.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); add(); } });
        box.append(h('div', { class: 'row ol-add' }, codeIn, h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'add-friend', onclick: add }, t('online.add'))));
        // requests
        if (snap.incoming.length) {
          box.append(h('h4', { class: 'app-sub', text: t('online.requests') }),
            ...snap.incoming.map(r => h('div', { class: 'ol-person ol-request', 'data-from': r.from },
              lookThumb(r.look), h('b', { class: 'ol-name', text: r.name }),
              h('div', { class: 'ol-actions' },
                h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'accept', onclick: async () => { await call('accept', r).catch(() => companion.say(t('online.error'), 2400)); companion.play('celebrate'); companion.say(t('online.newFriendSay', { name: r.name }), 3000); refresh({ quietly: true }); } }, t('online.accept')),
                h('button', { class: 'px-btn', type: 'button', 'data-act': 'decline', onclick: async () => { await call('decline', r).catch(() => {}); refresh({ quietly: true }); } }, t('online.decline')),
                h('button', { class: 'px-btn danger', type: 'button', 'data-act': 'block-request', 'aria-label': t('online.block'), onclick: async () => { await call('block', r.from).catch(() => {}); refresh({ quietly: true }); } }, '⊘')))));
        }
        if (snap.outgoing.length) box.append(h('p', { class: 'note', text: t('online.waiting', { n: snap.outgoing.length }) }));
        // friends
        box.append(h('h4', { class: 'app-sub', text: t('online.friends') }));
        if (!snap.friends.length) box.append(h('p', { class: 'note', text: t('online.noFriends') }));
        for (const f of snap.friends) {
          const unread = f.last?.at && f.last.from !== snap.uid && (!local.lastRead[f.id] || f.last.at > local.lastRead[f.id]);
          box.append(h('div', { class: 'ol-person', 'data-friend': f.other },
            f.card ? lookThumb(f.card.look) : h('span', { class: 'ol-thumb', text: '?' }),
            h('div', { class: 'ol-who' }, h('b', { class: 'ol-name', text: f.card?.name || 'Mochi' }), h('span', { class: 'ol-hearts', title: t('online.level', { level: f.level }), text: `${hearts(f.level)} ${t('online.level', { level: f.level })}` })),
            unread ? h('i', { class: 'ol-dot', 'aria-label': '•' }) : null,
            h('button', { class: 'px-btn', type: 'button', 'data-act': 'chat', onclick: () => { Mochi.menuInstance?.close?.(); openChat(f); } }, t('online.chat'))));
        }
        // turn off / delete
        box.append(h('div', { class: 'row ol-foot' },
          h('button', { class: 'px-btn', type: 'button', 'data-act': 'online-off', onclick: () => S.set('online.on', false) }, t('online.turnOff')),
          h('button', {
            class: 'px-btn danger', type: 'button', 'data-act': 'online-delete',
            onclick: async ev => {
              if (state.sure !== 'delete-all') { state.sure = 'delete-all'; ev.currentTarget.textContent = t('online.sure'); return; }
              state.sure = null;
              try { await call('deleteEverything'); } catch (_) { companion.say(t('online.error'), 2600); return; }
              local = { lastRead: {}, notified: {}, seenRequests: [], levels: {}, checked: {}, best: 0, ready: false };
              await saveLocal();
              state.snap = null;
              await S.set('online.on', false);
              Mochi.outfits?.apply(companion);
              companion.say(t('online.deleted'), 2800);
            },
          }, t('online.deleteAll'))));
        return box;
      });
      Mochi.menu.addSetting({ type: 'action', id: 'online-open', label: 'settings.online', when: () => state.configured, run: () => setTimeout(() => Mochi.menuInstance?.open('friends'), 50) });

      // ——— start ———
      Mochi.store.get(LOCAL, null).then(saved => { if (saved) local = { ...local, ...saved }; });
      call('status').then(s => { state.configured = !!s?.configured; if (on()) startPolling(); refreshMenu(); }).catch(() => {});
      S.onChange(path => {
        if (path === 'online.on' || path === 'online') { if (on()) startPolling(); else { clearInterval(pollTimer); state.snap = null; } refreshMenu(); }
        if (path === 'online.name' && on()) refresh({ quietly: true });
      });
      ctx.on('visibility', hidden => { if (!hidden && on()) refresh(); });

      Mochi.debugHooks.online = async value => {
        if (value === 'refresh') return refresh();
        if (value?.config) { Mochi.onlineConfig = value.config; direct = null; const s = await call('status'); state.configured = !!s.configured; if (on()) startPolling(); refreshMenu(); }
      };
      Mochi.onlineUI = { state, refresh, visit, openChat, call, myLook, get local() { return local; } };
    },
  });
})();
