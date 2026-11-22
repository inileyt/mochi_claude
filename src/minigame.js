/*
 * Mochi — "Catch the stars", a tiny game for while Claude thinks.
 *
 * When an answer takes a while, Mochi asks "Play while you wait?". Say yes
 * and a small pixel window opens above Mochi: move with the mouse (or ← →
 * once you've clicked the game) and catch falling stars for 30 seconds. Gold
 * stars are worth 3. Your best score is kept; each star gives a little XP
 * (at most XP_PER_ROUND a round, and the hourly XP cap still applies).
 *
 * Light on purpose: it draws with requestAnimationFrame only while a round
 * is running, and it never moves keyboard focus (the chat box keeps it).
 * Also in the menu: Mochi → Catch stars. Settings → "Play while you wait?".
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  const W = 120, H = 90; // the game's pixels (drawn 2× on screen)
  const ROUND_MS = 30000;
  const CATCH_TOP = H - 4 - 18; // the catcher is drawn 2× (20 × 18)
  const XP_PER_ROUND = 15;
  const OFFER_AFTER = { thinking: 5000, writing: 3500 }; // ms of waiting before Mochi asks

  // A little Mochi to catch with: 10 × 9 pixels, colored by role.
  const CATCHER = [
    '....a.....',
    '....o.....',
    '.oooooooo.',
    'oHLBBBBBBo',
    'oLBkBBkBBo',
    'oBBBBBBBBo',
    'oBBBmmBBDo',
    'oDBBBBBDDo',
    '.oooooooo.',
  ];
  const STAR = ['..#..', '.###.', '#####', '.#.#.'];
  const GOLD = ['...#...', '..###..', '.#####.', '#######', '.#####.', '..#.#..'];

  Mochi.settings.define({ game: { offer: true } });
  Mochi.menu.addSetting({ path: 'game.offer', type: 'toggle', label: 'settings.gameOffer', when: ctx => ctx.isChat });
  Mochi.menu.addItem({ section: 'mochi', id: 'game', icon: '★', label: 'menu.game', run: ctx => Mochi.game?.open() });

  Mochi.features = Mochi.features || [];
  Mochi.features.push({
    id: 'minigame',
    init(ctx) {
      const { companion, panel } = ctx;
      const { h } = Mochi.ui;
      let box = null, canvas = null, g = null, scoreEl = null, noteEl = null;
      let raf = 0, last = 0, game = null, best = 0;
      let offerEl = null, offerTimer = null, offeredThisAnswer = false, declinedAt = 0;

      Mochi.store.get('game.best', 0).then(v => { best = Number(v) || 0; });

      // ——— drawing ———
      let pal = null;
      function palette() {
        const el = getComputedStyle(companion.el), host = getComputedStyle(companion.host);
        const v = (cs, n) => cs.getPropertyValue(n).trim();
        return {
          o: v(el, '--m-outline'), B: v(el, '--m-base'), L: v(el, '--m-light'), H: v(el, '--m-highlight'), D: v(el, '--m-shade'),
          a: v(el, '--m-accent'), k: v(el, '--m-ink'), m: v(el, '--m-ink'),
          bg: v(host, '--ui-bg') || '#fff6e6', ink: v(host, '--ui-ink') || '#2b1208', line: v(host, '--ui-line') || '#55230d', soft: v(host, '--soft-bg') || '#ffe9cf',
        };
      }
      function sprite(rows, x, y, colors, scale = 1) {
        rows.forEach((row, dy) => [...row].forEach((ch, dx) => {
          const c = colors[ch];
          if (c) { g.fillStyle = c; g.fillRect(Math.round(x) + dx * scale, Math.round(y) + dy * scale, scale, scale); }
        }));
      }
      function draw() {
        g.fillStyle = pal.bg; g.fillRect(0, 0, W, H);
        // a few still background dots, like far-away stars
        g.fillStyle = pal.soft;
        for (const [x, y] of [[9, 12], [31, 6], [52, 20], [77, 9], [101, 17], [113, 40], [18, 44], [64, 38], [90, 55]]) g.fillRect(x, y, 2, 2);
        g.fillStyle = pal.line; g.fillRect(0, H - 4, W, 1);
        for (const s of game.stars) sprite(s.gold ? GOLD : STAR, s.x, s.y, { '#': s.gold ? '#ffd23f' : pal.a });
        for (const p of game.pops) { g.fillStyle = p.gold ? '#ffd23f' : pal.ink; g.font = '7px monospace'; g.fillText(p.gold ? '+3' : '+1', p.x, p.y); }
        sprite(CATCHER, game.x - 10, CATCH_TOP, pal, 2);
      }

      // ——— the game ———
      function newRound() {
        game = { stars: [], pops: [], x: W / 2, target: W / 2, keys: 0, left: ROUND_MS, spawn: 0, score: 0, xp: 0, over: false };
        pal = palette();
        noteEl.textContent = Mochi.t('game.howto');
        box.querySelector('[data-act="again"]').hidden = true;
        updateScore();
        start();
      }
      function updateScore() {
        scoreEl.textContent = Mochi.t('game.score', { score: game?.score || 0, best, time: Math.ceil((game?.left || 0) / 1000) });
      }
      function step(now) {
        const dt = Math.min(50, now - (last || now));
        last = now;
        if (!game || game.over) { raf = 0; return; }
        game.left -= dt;
        // Spawn faster as the round goes on.
        game.spawn -= dt;
        if (game.spawn <= 0) {
          const gold = Math.random() < 0.12;
          game.stars.push({ x: 2 + Math.random() * (W - 10), y: -6, vy: (0.018 + Math.random() * 0.012) * (1 + (ROUND_MS - game.left) / ROUND_MS), gold });
          game.spawn = 650 - 300 * (1 - game.left / ROUND_MS);
        }
        if (game.keys) game.target = Math.max(10, Math.min(W - 10, game.target + game.keys * dt * 0.09));
        game.x += (game.target - game.x) * Math.min(1, dt * 0.02);
        const top = CATCH_TOP + 2;
        for (const s of game.stars) {
          s.y += s.vy * dt;
          const w = s.gold ? 7 : 5;
          if (!s.done && s.y + 4 >= top && s.y <= top + 4 && s.x + w > game.x - 10 && s.x < game.x + 10) {
            s.done = true;
            game.score += s.gold ? 3 : 1;
            game.pops.push({ x: s.x, y: top - 2, t: 600, gold: s.gold });
            if (game.xp < XP_PER_ROUND) { game.xp++; ctx.emit('gameStar', 1); }
            Mochi.sound?.play('pop');
            updateScore();
          }
        }
        game.stars = game.stars.filter(s => !s.done && s.y + 4 < H - 4); // missed ones vanish at the ground
        for (const p of game.pops) { p.t -= dt; p.y -= dt * 0.02; }
        game.pops = game.pops.filter(p => p.t > 0);
        if (Math.ceil(game.left / 1000) !== Math.ceil((game.left + dt) / 1000)) updateScore();
        draw();
        if (game.left <= 0) { finish(); return; }
        raf = requestAnimationFrame(step);
      }
      function start() { cancelAnimationFrame(raf); last = 0; raf = requestAnimationFrame(step); }
      function stop() { cancelAnimationFrame(raf); raf = 0; }
      async function finish() {
        stop();
        game.over = true;
        game.left = 0;
        const record = game.score > best;
        if (record) { best = game.score; await Mochi.store.set('game.best', best); }
        updateScore();
        noteEl.textContent = record ? Mochi.t('game.record', { score: game.score }) : Mochi.t('game.over', { score: game.score });
        box.querySelector('[data-act="again"]').hidden = false;
        companion.play(record ? 'celebrate' : 'hop');
        if (record) companion.flashFx('sparkles', 1500);
        ctx.emit('gameOver', game.score);
      }

      function open() {
        hideOffer();
        Mochi.menuInstance?.close?.();
        if (box) { if (game?.over) newRound(); return; }
        canvas = h('canvas', { class: 'game-canvas', width: W, height: H, tabindex: '0', 'aria-label': Mochi.t('game.title') });
        g = canvas.getContext('2d');
        scoreEl = h('span', { class: 'game-score' });
        noteEl = h('p', { class: 'game-note' });
        box = h('div', { class: 'game', role: 'dialog', 'aria-label': Mochi.t('game.title') },
          h('div', { class: 'game-head' },
            h('b', { text: Mochi.t('game.title') }),
            h('button', { class: 'px-btn icon', type: 'button', 'data-act': 'close-game', 'aria-label': Mochi.t('settings.close'), onclick: close }, '×')),
          scoreEl, canvas, noteEl,
          h('div', { class: 'row' }, h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'again', hidden: true, onclick: newRound }, Mochi.t('game.again'))));
        // Mouse or touch: Mochi follows the pointer across the game.
        canvas.addEventListener('pointermove', ev => {
          if (!game) return;
          const r = canvas.getBoundingClientRect();
          game.target = Math.max(10, Math.min(W - 10, ((ev.clientX - r.left) / r.width) * W));
        });
        // Keys only once you've clicked the game yourself (it never takes focus on its own).
        canvas.addEventListener('keydown', ev => {
          if (!game) return;
          if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') { ev.preventDefault(); ev.stopPropagation(); game.keys = ev.key === 'ArrowLeft' ? -1 : 1; }
          if (ev.key === 'Escape') { ev.stopPropagation(); close(); }
        });
        canvas.addEventListener('keyup', ev => { if (game && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) game.keys = 0; });
        // Pressing the game's buttons doesn't pull focus out of the chat box.
        box.addEventListener('mousedown', ev => { if (ev.target !== canvas) ev.preventDefault(); });
        companion.root.append(box);
        companion.play('hop');
        newRound();
        ctx.emit('gameOpen');
      }
      function close() {
        stop();
        box?.remove();
        box = canvas = g = null;
        game = null;
      }

      // ——— "Play while you wait?" ———
      function hideOffer() { clearTimeout(offerTimer); offerEl?.remove(); offerEl = null; }
      function maybeOffer() {
        if (!ctx.isChat || offeredThisAnswer || box || offerEl) return;
        if (Mochi.settings.get('game.offer') === false || Date.now() - declinedAt < 10 * 60 * 1000) return;
        if (document.hidden || companion.isHidden || companion.isTucked || panel.isOffering || companion.root.querySelector('.offer')) return;
        offeredThisAnswer = true;
        offerEl = h('div', { class: 'offer game-offer', role: 'dialog', 'aria-label': Mochi.t('game.offer') },
          h('p', { text: Mochi.t('game.offer') }),
          h('div', { class: 'row' },
            h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'play-game', onclick: open }, Mochi.t('game.play')),
            h('button', { class: 'px-btn', type: 'button', 'data-act': 'no-game', onclick: () => { declinedAt = Date.now(); hideOffer(); } }, Mochi.t('game.noThanks'))));
        offerEl.addEventListener('mousedown', ev => ev.preventDefault());
        companion.root.append(offerEl);
        offerTimer = setTimeout(hideOffer, 20000);
      }
      const waitThenOffer = ms => { clearTimeout(offerTimer); if (!offerEl) offerTimer = setTimeout(maybeOffer, ms); };
      ctx.on('userMessage', () => { offeredThisAnswer = false; waitThenOffer(OFFER_AFTER.thinking); });
      ctx.on('responseStart', () => waitThenOffer(OFFER_AFTER.writing));
      ctx.on('responseEnd', () => {
        clearTimeout(offerTimer);
        hideOffer();
        if (box && noteEl && game && !game.over) noteEl.textContent = Mochi.t('game.answered');
      });
      ctx.on('visibility', hidden => { if (hidden && game && !game.over) stop(); else if (!hidden && game && !game.over && box) start(); });
      Mochi.settings.onChange(p => { if (p.startsWith('game') && Mochi.settings.get('game.offer') === false) hideOffer(); });

      Mochi.debugHooks.game = value => (value === 'offer' ? (offeredThisAnswer = false, declinedAt = 0, maybeOffer()) : value === 'close' ? close() : value === 'end' ? game && (game.left = 1) : open());
      Mochi.game = { open, close, get state() { return game && { score: game.score, left: game.left, over: game.over, xp: game.xp, stars: game.stars.length, x: game.x }; }, get running() { return !!raf; }, get best() { return best; } };
    },
  });
})();
