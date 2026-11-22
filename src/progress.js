/*
 * Mochi — levels, XP and the daily streak. All counted locally
 * (chrome.storage.local key "mochi.progress"); nothing leaves the browser.
 *
 * Tune it in CONFIG below: how much XP each thing gives, the hourly cap
 * (so clicking Mochi 500 times doesn't level it up), the level curve, and
 * what each level unlocks.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const KEY = 'mochi.progress';

  const CONFIG = {
    // XP per event. "capped" sources share the hourly cap; daily ones don't.
    xp: {
      turn: { xp: 10, capped: true },   // a claude.ai conversation turn (Claude finished a reply)
      pet: { xp: 2, capped: true },     // clicking Mochi → Play, poking it
      scan: { xp: 8, capped: true },    // Scan this UI
      pick: { xp: 5, capped: true },    // Pick an element
      star: { xp: 1, capped: true },    // a star caught in the mini-game
      day: { xp: 15, capped: false },   // the first visit of a day
      streak: { xp: 5, capped: false, max: 50 }, // per streak day, on top of "day" (5 × days, at most 50)
    },
    hourCap: 120,
    /** Total XP needed to reach a level: 0, 40, 120, 240, 400, 600, … */
    levelXp: level => 20 * level * (level - 1),
    maxLevel: 99,
    // What each level unlocks (outfits unlock by their own "unlock.level").
    unlocks: {
      3: [{ kind: 'friend', id: 'cat' }],
      4: [{ kind: 'idle', id: 'yawn' }],
      5: [{ kind: 'idle', id: 'juggle' }],
      6: [{ kind: 'friend', id: 'robot' }],
      7: [{ kind: 'idle', id: 'read' }],
      10: [{ kind: 'friend', id: 'ghost' }],
    },
  };

  const EMPTY = { xp: 0, hour: { key: '', n: 0 }, streak: { count: 0, best: 0, last: null }, pets: { day: '', n: 0 } };
  let state = JSON.parse(JSON.stringify(EMPTY));
  const listeners = [];
  const changed = () => { for (const fn of listeners) { try { fn(state); } catch (_) { /* skip */ } } };

  const levelOf = xp => {
    let level = 1;
    while (level < CONFIG.maxLevel && xp >= CONFIG.levelXp(level + 1)) level++;
    return level;
  };
  const level = () => levelOf(state.xp);
  const hourKey = () => { const d = new Date(); return `${Mochi.store.today()}T${String(d.getHours()).padStart(2, '0')}`; };
  const save = () => Mochi.store.set(KEY, state, { lazy: true }); // XP reaches other computers every few minutes

  /** Adds XP for a source in CONFIG.xp; returns { gained, from, to }. */
  async function add(source, times = 1) {
    const rule = CONFIG.xp[source];
    if (!rule || Mochi.settings.get('progress') === false) return { gained: 0, from: level(), to: level() };
    let gained = rule.xp * times;
    if (rule.max) gained = Math.min(gained, rule.max);
    if (rule.capped) {
      const key = hourKey();
      if (state.hour.key !== key) state.hour = { key, n: 0 };
      gained = Math.max(0, Math.min(gained, CONFIG.hourCap - state.hour.n));
      state.hour.n += gained;
    }
    const from = level();
    state.xp += gained;
    const to = level();
    await save();
    changed();
    if (to > from) bus?.emit('levelUp', to, from);
    return { gained, from, to };
  }

  /** What unlocks at exactly this level: outfits, friends, idle antics. */
  function unlocksAt(lv) {
    const out = [...(CONFIG.unlocks[lv] || [])];
    for (const o of Mochi.outfits?.OUTFITS || []) if ((o.unlock?.level ?? 1) === lv && !o.season && !o.unlock?.friendship) out.push({ kind: 'outfit', id: o.id });
    return out;
  }
  function nextUnlock() {
    for (let lv = level() + 1; lv <= CONFIG.maxLevel; lv++) { const u = unlocksAt(lv); if (u.length) return { level: lv, what: u[0] }; }
    return null;
  }
  const unlockName = u => (u.kind === 'outfit' ? Mochi.t(Mochi.outfits.byId(u.id)?.name || u.id) : Mochi.t(`${u.kind}.${u.id}`));
  const isIdleUnlocked = id => Object.entries(CONFIG.unlocks).some(([lv, list]) => Number(lv) <= level() && list.some(u => u.kind === 'idle' && u.id === id));

  // ——— the daily visit and streak ———
  const dayBefore = day => {
    const d = new Date(`${day}T12:00:00`);
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  /** Counts today's visit once. Returns { kind: 'first'|'next'|'missed'|'same', count }. */
  async function visit() {
    const day = Mochi.store.today();
    const s = state.streak;
    if (s.last === day) return { kind: 'same', count: s.count };
    let kind;
    if (!s.last) { s.count = 1; kind = 'first'; }
    else if (s.last === dayBefore(day)) { s.count += 1; kind = 'next'; }
    else if (s.last > day) { s.count = Math.max(1, s.count); kind = 'same'; } // the clock went backwards: keep it
    else { s.count = 1; kind = 'missed'; }
    s.last = day;
    s.best = Math.max(s.best || 0, s.count);
    await save();
    await add('day');
    if (s.count > 1) await add('streak', s.count);
    changed();
    return { kind, count: s.count };
  }

  let bus = null;

  // ——— share card: a PNG for social media ———
  async function shareCard(companion) {
    const W = 1200, H = 630;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    // The colors Mochi (and the friend) wear right now, read from their sprites.
    const colorsOf = c => {
      const cs = getComputedStyle(c.el);
      const role = name => cs.getPropertyValue(`--m-${name}`).trim();
      return { outline: role('outline'), shade: role('shade'), base: role('base'), light: role('light'), highlight: role('highlight'), accent: role('accent'), accentLight: role('accent-light'), ink: role('ink') };
    };
    const picture = async (c, size, outfitsOn) => {
      const colors = colorsOf(c);
      const outfits = outfitsOn ? (Mochi.outfits?.wearing() || []).map(o => ({ slot: o.slot, markup: Mochi.outfits.markup(o).replace(/var\(--m-([a-z-]+)\)/g, (m, r) => colors[r.replace(/-([a-z])/g, (_, x) => x.toUpperCase())] || m), hide: o.hide || [] })) : [];
      const im = new Image();
      im.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(Mochi.art.staticSvg({ mood: 'happy', outfits, colors, size, parts: c.character?.parts }))}`;
      await im.decode();
      return { img: im, colors };
    };
    const { img, colors } = await picture(companion, 400, true);
    const buddy = Mochi.friends?.buddy;
    const friendPic = buddy?.character ? await picture(buddy, 200, false) : null;

    // Background: cream with a pixel border and a soft checker.
    g.fillStyle = '#fff6e6'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffe9cf';
    for (let y = 0; y < H; y += 30) for (let x = (y / 30) % 2 ? 30 : 0; x < W; x += 60) g.fillRect(x, y, 30, 30);
    g.fillStyle = colors.outline || '#55230d';
    g.fillRect(0, 0, W, 12); g.fillRect(0, H - 12, W, 12); g.fillRect(0, 0, 12, H); g.fillRect(W - 12, 0, 12, H);
    // Mochi, big and crisp.
    g.drawImage(img, 70, 95, 440, 440);
    if (friendPic) g.drawImage(friendPic.img, 20, 335, 200, 200);
    // Text.
    const font = (size, weight = 800) => `${weight} ${size}px ui-monospace, "SFMono-Regular", Menlo, Consolas, "Courier New", monospace`;
    g.fillStyle = '#2b1208';
    g.font = font(84); g.fillText('Mochi', 560, 190);
    // The level in Mochi's color, with a pixel shadow in its outline color so light themes stay readable.
    g.font = font(60);
    g.fillStyle = colors.outline || '#55230d'; g.fillText(Mochi.t('share.level', { level: level() }), 564, 284);
    g.fillStyle = colors.base || '#ef8140'; g.fillText(Mochi.t('share.level', { level: level() }), 560, 280);
    // XP bar.
    const lv = level(), from = CONFIG.levelXp(lv), to = CONFIG.levelXp(lv + 1);
    const frac = Math.max(0, Math.min(1, (state.xp - from) / Math.max(1, to - from)));
    g.fillStyle = '#2b1208'; g.fillRect(560, 305, 560, 40);
    g.fillStyle = '#fff6e6'; g.fillRect(566, 311, 548, 28);
    g.fillStyle = colors.accent || '#f7b23b'; g.fillRect(566, 311, Math.round(548 * frac), 28);
    g.fillStyle = '#2b1208';
    g.font = font(40, 700); g.fillText(Mochi.t('share.streak', { n: state.streak.count || 1 }), 560, 410);
    g.font = font(28, 600); g.fillStyle = '#6b4a33'; g.fillText(Mochi.t('share.tagline'), 560, 462);
    // The color theme: a little row of its pixels and its name.
    g.fillStyle = colors.outline || '#55230d'; g.fillRect(556, 480, 6 * 26 + 4, 30);
    ['outline', 'shade', 'base', 'light', 'highlight', 'accent'].forEach((r, i) => { g.fillStyle = colors[r] || '#000'; g.fillRect(560 + i * 26, 484, 22, 22); });
    g.font = font(24, 700); g.fillStyle = '#6b4a33';
    g.fillText(Mochi.colorName ? Mochi.colorName(companion.character?.id || 'mochi') : '', 560 + 6 * 26 + 12, 503);
    g.font = font(30, 800); g.fillStyle = '#2b1208'; g.fillText('github.com/inileyt/mochi_claude', 560, 560);

    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `mochi-level-${level()}.png`; a.style.display = 'none';
    companion.shadow.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
    return blob;
  }

  Mochi.settings.define({ progress: true });
  Mochi.progress = { CONFIG, level, xp: () => state.xp, state: () => state, add, visit, unlocksAt, nextUnlock, unlockName, isIdleUnlocked, onChange: fn => listeners.push(fn), shareCard };

  // Idle antics unlocked by level.
  Mochi.idleExtras = Mochi.idleExtras || [];
  Mochi.idleExtras.push(
    { when: () => isIdleUnlocked('yawn'), run: c => { c.play('yawn'); c.flashFace({ eyes: 'closed', mouth: 'o' }, 1600); c.say(Mochi.t('idle.yawnSay'), 1500); } },
    { when: () => isIdleUnlocked('juggle'), run: c => { c.play('juggle'); c.flashFx('juggle', 2000); c.flashFace({ eyes: 'open', mouth: 'smile' }, 2000); } },
    { when: () => isIdleUnlocked('read'), run: c => { c.play('read'); c.flashFx('book', 4000); c.flashFace({ eyes: 'open', mouth: 'small-o' }, 4000); } },
  );

  // ——— the stat card (Mochi section of the menu) ———
  Mochi.menu.addView('mochi', ctx => {
    if (Mochi.settings.get('progress') === false) return null;
    const { h } = Mochi.ui;
    const lv = level(), from = CONFIG.levelXp(lv), to = CONFIG.levelXp(lv + 1);
    const pct = Math.round(Math.max(0, Math.min(1, (state.xp - from) / Math.max(1, to - from))) * 100);
    const next = nextUnlock();
    return h('div', { class: 'stat-card', 'data-level': lv },
      h('div', { class: 'stat-top' },
        h('b', { class: 'stat-level', text: Mochi.t('stats.level', { level: lv }) }),
        h('span', { class: 'stat-streak', title: Mochi.t('stats.best', { n: state.streak.best || 0 }), text: Mochi.t('stats.streak', { n: state.streak.count || 0 }) })),
      h('div', { class: 'xp-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, 'aria-label': Mochi.t('stats.xp') },
        h('i', { style: { width: `${pct}%` } })),
      h('div', { class: 'stat-sub' },
        h('span', { text: `${state.xp - from} / ${to - from} XP` }),
        next ? h('span', { text: Mochi.t('stats.next', { level: next.level, what: unlockName(next.what) }) }) : null),
      h('button', { class: 'px-btn', type: 'button', 'data-act': 'share-card', onclick: async () => {
        ctx.menu.close();
        await shareCard(ctx.companion);
        ctx.engine.react({ mood: 'happy', action: 'hop', say: Mochi.t('stats.shared') });
      } }, Mochi.t('stats.share')));
  });
  Mochi.menu.addSetting({ path: 'progress', type: 'toggle', label: 'settings.progress' });

  Mochi.features = Mochi.features || [];
  Mochi.features.push({
    id: 'progress',
    async init(ctx) {
      bus = ctx;
      state = { ...JSON.parse(JSON.stringify(EMPTY)), ...(await Mochi.store.get(KEY, EMPTY)) };
      ctx.emit('outfitsChanged'); // outfits unlocked by level can be worn now
      // The level is known only now (features started a moment ago with level 1): characters and
      // friends unlocked by level (the cat at 3…) are put back on.
      ctx.emit('levelChanged', level());
      Mochi.store.watch(KEY, next => { if (next) { const was = level(); state = { ...state, ...next }; changed(); ctx.menu.refresh(); if (level() !== was) ctx.emit('levelChanged', level()); } });
      listeners.push(() => ctx.menu.refresh());

      if (ctx.isChat) ctx.on('responseEnd', () => add('turn'));
      ctx.on('poke', () => add('pet'));
      ctx.on('scanned', () => add('scan'));
      ctx.on('picked', () => add('pick'));
      ctx.on('gameStar', n => add('star', n || 1));

      const cheerLevel = (to, tries = 0) => {
        // Mochi is comforting you after a sad message: the cheer waits until it has calmed down.
        if (ctx.companion.mood === 'sad' && ctx.engine.phase === 'reacting' && tries < 12) { setTimeout(() => cheerLevel(to, tries + 1), 2500); return; }
        const unlocked = unlocksAt(to);
        ctx.engine.react({ mood: 'excited', action: 'celebrate', fx: 'sparkles', say: Mochi.t('level.up', { level: to }), sayMs: 2400, hold: 5000 });
        if (unlocked.length) setTimeout(() => ctx.companion.say(Mochi.t('level.unlocked', { what: unlocked.map(unlockName).join(', ') }), 3200), 2600);
      };
      ctx.on('levelUp', to => cheerLevel(to));

      // The first visit of a day: a greeting (after the hello wave).
      const greet = async () => {
        if (Mochi.settings.get('progress') === false) return;
        const before = level();
        const v = await visit();
        if (v.kind === 'same') return;
        // The day's XP can level Mochi up: let "Level N!" show first.
        if (level() > before) await new Promise(r => setTimeout(r, 5200));
        if (v.kind === 'missed') {
          ctx.engine.react({ mood: 'sad', say: Mochi.t('streak.missed'), hold: 2200 });
          setTimeout(() => ctx.engine.react({ mood: 'happy', action: 'hop', say: Mochi.t('streak.again'), hold: 3000 }), 2400);
        } else if (v.kind === 'first') {
          ctx.engine.react({ mood: 'happy', action: 'wave', say: Mochi.t('streak.first'), hold: 3000 });
        } else {
          ctx.engine.react({ mood: 'happy', action: 'hop', fx: 'sparkles-soft', say: Mochi.t('streak.day', { n: v.count }), hold: 3500 });
        }
      };
      setTimeout(greet, 2600);
      ctx.on('dayChanged', () => setTimeout(greet, 200));

      Mochi.debugHooks.level = async (value) => {
        const target = Math.max(1, Math.min(CONFIG.maxLevel, Number(value) || 1));
        const before = level();
        state.xp = CONFIG.levelXp(target);
        await save(); changed();
        if (target > before) ctx.emit('levelUp', target, before);
        ctx.emit('levelChanged', target);
        ctx.emit('outfitsChanged');
      };
      Mochi.debugHooks.addXp = async value => {
        const from = level();
        state.xp += Number(value) || 0;
        await save(); changed();
        if (level() > from) ctx.emit('levelUp', level(), from);
      };
      Mochi.debugHooks.resetProgress = async () => { state = JSON.parse(JSON.stringify(EMPTY)); await save(); changed(); ctx.emit('levelChanged', 1); ctx.emit('outfitsChanged'); };
      Mochi.debugHooks.xpFor = value => add(value);
      Mochi.debugHooks.shareCard = () => shareCard(ctx.companion);
    },
  });
})();
