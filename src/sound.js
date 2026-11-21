/*
 * Mochi — 8-bit sounds, made in code with the Web Audio API (no audio files).
 *
 * Off by default (Settings → Sounds, with a volume slider). Never plays
 * before you've clicked or typed on the page (browser autoplay rules), and
 * is throttled: each sound waits a while before it can play again, and only
 * one sound plays at a time.
 *
 *   Mochi.sound.play('hop' | 'happy' | 'sad' | 'levelUp' | 'snore' | 'purr' | 'beeps' | 'pop')
 *
 * A sound is a list of notes: [frequency Hz, start s, length s, wave, volume, slideTo Hz].
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  const N = { C4: 262, D4: 294, E4: 330, F4: 349, G4: 392, A4: 440, B4: 494, C5: 523, D5: 587, E5: 659, F5: 698, G5: 784, A5: 880, C6: 1047 };
  const SOUNDS = {
    hop: { gap: 900, notes: [[N.A4, 0, 0.07, 'square', 0.5, N.E5]] },
    pop: { gap: 400, notes: [[N.E5, 0, 0.04, 'square', 0.35, N.A5]] },
    happy: { gap: 4000, notes: [[N.C5, 0, 0.08, 'square', 0.4], [N.E5, 0.08, 0.08, 'square', 0.4], [N.G5, 0.16, 0.08, 'square', 0.4], [N.C6, 0.24, 0.16, 'square', 0.35]] },
    sad: { gap: 6000, notes: [[N.E4, 0, 0.22, 'triangle', 0.6], [N.C4, 0.24, 0.36, 'triangle', 0.55, 247]] },
    levelUp: { gap: 2000, notes: [[N.G4, 0, 0.1, 'square', 0.4], [N.C5, 0.1, 0.1, 'square', 0.4], [N.E5, 0.2, 0.1, 'square', 0.4], [N.G5, 0.3, 0.14, 'square', 0.4], [N.E5, 0.46, 0.08, 'square', 0.35], [N.G5, 0.54, 0.35, 'square', 0.4]] },
    snore: { gap: 20000, notes: [[110, 0, 0.55, 'triangle', 0.5, 82], [98, 0.75, 0.6, 'triangle', 0.4, 140]] },
    purr: { gap: 3000, purr: true, notes: [[46, 0, 0.8, 'sawtooth', 0.45]] },
    beeps: { gap: 2500, notes: [[N.A5, 0, 0.06, 'square', 0.35], [1319, 0.09, 0.06, 'square', 0.35], [988, 0.18, 0.09, 'square', 0.35]] },
  };
  const GLOBAL_GAP = 350; // ms between any two sounds

  let ctx = null;
  let userActed = false;
  const last = {};
  let lastAny = 0;
  const log = []; // what played (for the test page)

  // A real click or key press on the page lets sounds play (autoplay rules).
  const markActed = ev => { if (ev.isTrusted) userActed = true; };
  addEventListener('pointerdown', markActed, { capture: true, passive: true });
  addEventListener('keydown', markActed, { capture: true, passive: true });

  const allowed = () => Mochi.settings.get('sound.on') === true && (userActed || navigator.userActivation?.hasBeenActive === true);

  function audio() {
    if (!ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function play(name) {
    const sound = SOUNDS[name];
    if (!sound || !allowed()) return false;
    const now = performance.now();
    if (now - lastAny < GLOBAL_GAP || now - (last[name] || -1e9) < sound.gap) return false;
    const ac = audio();
    if (!ac) return false;
    last[name] = lastAny = now;
    const volume = Math.max(0, Math.min(1, Number(Mochi.settings.get('sound.volume') ?? 0.5))) * 0.18;
    const out = ac.createGain();
    out.gain.value = volume;
    out.connect(ac.destination);
    const t0 = ac.currentTime + 0.01;
    for (const [freq, start, length, wave, vol = 0.5, slideTo] of sound.notes) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = wave;
      osc.frequency.setValueAtTime(freq, t0 + start);
      if (slideTo) osc.frequency.linearRampToValueAtTime(slideTo, t0 + start + length);
      // A short attack and release, so notes don't click.
      gain.gain.setValueAtTime(0, t0 + start);
      gain.gain.linearRampToValueAtTime(vol, t0 + start + 0.008);
      gain.gain.setValueAtTime(vol, t0 + start + length - 0.02);
      gain.gain.linearRampToValueAtTime(0, t0 + start + length);
      let node = osc;
      if (sound.purr) {
        // A purr: a low buzz, softened and wobbling ~22 times a second.
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 380;
        const lfo = ac.createOscillator();
        const depth = ac.createGain();
        lfo.frequency.value = 22;
        depth.gain.value = vol * 0.8;
        lfo.connect(depth).connect(gain.gain);
        lfo.start(t0 + start);
        lfo.stop(t0 + start + length);
        osc.connect(lp);
        node = lp;
      }
      node.connect(gain).connect(out);
      osc.start(t0 + start);
      osc.stop(t0 + start + length + 0.02);
    }
    log.push({ name, at: Math.round(now) });
    if (log.length > 50) log.shift();
    return true;
  }

  Mochi.settings.define({ sound: { on: false, volume: 0.5 } });
  Mochi.sound = { play, SOUNDS, log, get context() { return ctx; }, get userActed() { return userActed; } };

  Mochi.menu.addSetting({ path: 'sound.on', type: 'toggle', label: 'settings.sound', after: on => { if (on) setTimeout(() => play('pop'), 50); } });
  Mochi.menu.addSetting({ path: 'sound.volume', type: 'range', min: 0, max: 1, step: 0.1, label: 'settings.volume', when: () => Mochi.settings.get('sound.on') === true, after: () => { last.pop = 0; lastAny = 0; play('pop'); } });

  Mochi.features = Mochi.features || [];
  Mochi.features.push({
    id: 'sound',
    init(ctx) {
      const { companion } = ctx;
      companion.on('action', action => {
        if (action === 'hop' || action === 'celebrate' || action === 'spin') play('hop');
        else if (action === 'squish') play('pop');
      });
      companion.on('mood', mood => {
        if (mood === 'happy' || mood === 'excited') play('happy');
        else if (mood === 'sad') play('sad');
        else if (mood === 'sleeping') play('snore');
      });
      ctx.on('levelUp', () => { last.levelUp = 0; lastAny = 0; play('levelUp'); });
      // Character voices: the cat purrs and the robot beeps when you poke them.
      const voice = char => (char?.id === 'cat' ? 'purr' : char?.id === 'robot' ? 'beeps' : null);
      ctx.on('poke', () => { const v = voice(companion.character); if (v) { lastAny = 0; play(v); } });
      ctx.on('friendChanged', () => {
        Mochi.friends?.buddy?.on('poke', () => { const v = voice(Mochi.friends.buddy.character); if (v) { lastAny = 0; play(v); } });
      });

      Mochi.debugHooks.sound = name => { userActed = true; lastAny = 0; last[name] = 0; return play(name); };
    },
  });
})();
