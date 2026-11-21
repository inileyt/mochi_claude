/*
 * Mochi — focus mode (a Pomodoro timer).
 *
 * Menu → Mochi → Focus: 25 minutes of focus, then a 5-minute break, round
 * after round, until you stop (both lengths in Settings). While you focus,
 * Mochi puts on reading glasses, keeps quiet (no idle antics) and shows a
 * small timer badge; each phase gets exactly one bubble ("Break time!",
 * "Let's focus!"). The start time is saved, so the timer carries on across
 * reloads and tabs. Works on every site where Mochi is.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const KEY = 'focus.state';

  // Reading glasses (round frames that leave the eyes showing), worn on the face slot while focusing.
  const GLASSES = {
    id: 'focus-glasses', name: 'outfit.focusGlasses', author: 'Mochi', slot: 'face',
    at: [13, 21],
    pixels: [
      '.OOOO....OOOO.',
      'OO..OOOOOO..OO',
      '.O..O....O..O.',
      '.O..O....O..O.',
      '.OOOO....OOOO.',
    ],
    palette: { O: '#2b1d3a' },
  };

  const minutes = path => Math.max(1, Number(Mochi.settings.get(path)) || 1);
  const lengthOf = phase => (phase === 'break' ? minutes('focus.breakMinutes') : minutes('focus.minutes')) * 60000;
  const clock = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  Mochi.settings.define({ focus: { minutes: 25, breakMinutes: 5 } });
  const opts = list => () => list.map(n => [String(n), Mochi.t('focus.min', { n })]);
  Mochi.menu.addSetting({ path: 'focus.minutes', type: 'select', label: 'settings.focusMinutes', options: opts([10, 15, 20, 25, 30, 40, 45, 50, 60]) });
  Mochi.menu.addSetting({ path: 'focus.breakMinutes', type: 'select', label: 'settings.breakMinutes', options: opts([3, 5, 10, 15, 20]) });
  Mochi.menu.addItem({ section: 'mochi', id: 'focus-start', icon: '◔', label: 'menu.focusStart', when: () => !Mochi.focus?.active, run: () => Mochi.focus.start() });
  Mochi.menu.addItem({ section: 'mochi', id: 'focus-stop', icon: '■', label: 'menu.focusStop', when: () => !!Mochi.focus?.active, run: () => Mochi.focus.stop() });

  Mochi.features = Mochi.features || [];
  Mochi.features.push({
    id: 'focus',
    init(ctx) {
      const { companion } = ctx;
      const { h } = Mochi.ui;
      const t = Mochi.t;
      let state = null; // { phase: 'focus' | 'break', startedAt, round, announced }
      let timer = null;
      let now = () => Date.now(); // the test page can move time

      const timeEl = h('b', { class: 'focus-time' });
      const badge = h('div', { class: 'focus-badge', hidden: true, role: 'status' },
        h('span', { class: 'focus-label' }), timeEl,
        h('button', { class: 'focus-x', type: 'button', 'aria-label': t('menu.focusStop'), title: t('menu.focusStop'), onclick: () => stop() }, '×'));
      badge.addEventListener('mousedown', ev => ev.preventDefault());
      companion.root.append(badge);

      function wearGlasses(on) {
        if (!Mochi.outfits) return;
        if (on) Mochi.outfits.overrides.face = GLASSES; else delete Mochi.outfits.overrides.face;
        Mochi.outfits.apply(companion);
      }

      function render() {
        if (!state) { badge.hidden = true; companion.root.classList.remove('focusing', 'on-break'); return; }
        const left = lengthOf(state.phase) - (now() - state.startedAt);
        badge.hidden = false;
        badge.dataset.phase = state.phase;
        badge.querySelector('.focus-label').textContent = t(state.phase === 'break' ? 'focus.breakBadge' : 'focus.badge');
        timeEl.textContent = clock(left);
        companion.root.classList.toggle('focusing', state.phase === 'focus');
        companion.root.classList.toggle('on-break', state.phase === 'break');
      }

      /** One bubble per phase, even across reloads. */
      function announce() {
        const key = `${state.round}:${state.phase}`;
        if (state.announced === key) return;
        state.announced = key;
        if (state.phase === 'break') {
          companion.play('stretch');
          companion.flashFace({ eyes: 'happy', mouth: 'big' }, 1400);
          companion.say(Mochi.tPick('focus.breakSay', { n: state.round }), 4200);
        } else {
          companion.play('hop');
          companion.say(Mochi.tPick(state.round === 1 ? 'focus.startSay' : 'focus.againSay', { n: state.round }), 3600);
        }
        Mochi.sound?.play('happy');
        ctx.emit('focusPhase', state.phase, state.round);
      }

      async function save() { await Mochi.store.set(KEY, state); }

      function tick() {
        if (!state) return;
        let changed = false;
        // Catch up with the clock (also after a reload or a long time away).
        for (let i = 0; i < 500 && now() - state.startedAt >= lengthOf(state.phase); i++) {
          state.startedAt += lengthOf(state.phase);
          state.phase = state.phase === 'focus' ? 'break' : 'focus';
          if (state.phase === 'focus') state.round++;
          changed = true;
        }
        if (changed) {
          wearGlasses(state.phase === 'focus');
          if (!document.hidden) announce();
          save();
        } else if (!document.hidden && state.announced !== `${state.round}:${state.phase}`) {
          announce();
          save();
        }
        render();
      }

      function run() {
        clearInterval(timer);
        timer = setInterval(tick, 1000);
        wearGlasses(state.phase === 'focus');
        tick();
      }

      async function start() {
        state = { phase: 'focus', startedAt: now(), round: 1, announced: null };
        companion.setMood('focused');
        setTimeout(() => { if (companion.mood === 'focused') companion.setMood('neutral'); }, 2500);
        await save();
        run();
      }

      async function stop() {
        if (!state) return;
        const rounds = state.round - (state.phase === 'focus' ? 1 : 0);
        clearInterval(timer); timer = null;
        state = null;
        await save();
        wearGlasses(false);
        render();
        companion.play('wave');
        companion.say(rounds > 0 ? t('focus.doneSay', { n: rounds }) : t('focus.stopSay'), 2600);
        ctx.emit('focusPhase', null, rounds);
      }

      Mochi.focus = {
        start, stop, GLASSES,
        get active() { return !!state; },
        get state() { return state && { ...state, left: lengthOf(state.phase) - (now() - state.startedAt) }; },
      };

      // Pick up a running timer (another tab or before a reload), and follow changes from other tabs.
      Mochi.store.get(KEY, null).then(saved => { if (saved?.phase && saved.startedAt) { state = saved; run(); } });
      Mochi.store.watch?.(KEY, next => {
        if (!next && state) { state = null; clearInterval(timer); timer = null; wearGlasses(false); render(); }
        else if (next?.phase && (!state || next.startedAt !== state.startedAt || next.phase !== state.phase)) { state = next; run(); }
      });
      ctx.on('visibility', hidden => { if (!hidden) tick(); });
      Mochi.settings.onChange(p => { if (p.startsWith('focus')) tick(); });

      // Test page: {"focus": "start" | "stop" | "skip"} — skip jumps to the end of this phase.
      Mochi.debugHooks.focus = value => {
        if (value === 'start') return start();
        if (value === 'stop') return stop();
        if (value === 'skip' && state) { state.startedAt = now() - lengthOf(state.phase) + 500; save(); setTimeout(tick, 600); }
      };
    },
  });
})();
