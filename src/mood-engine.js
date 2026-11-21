/*
 * Mochi — the mood engine. Turns chat events into feelings.
 *
 * Inputs (from the chat watcher): userMessage, responseStart,
 * responseProgress, responseEnd, typing, newChat, scroll, visibility,
 * plus pokes from the companion. Output: calls on the companion.
 *
 *   you send a message      → curious (looks at your message), then thinking
 *   Claude starts answering → thinking (looks up, taps head, thought bubble)
 *   Claude is streaming     → focused (watches the reply, blinks)
 *   Claude finishes         → happy / excited / surprised / sad (from local sentiment)
 *   2 min quiet             → neutral idle with rare little antics
 *   5 min quiet             → falls asleep (Zzz); wakes with a stretch
 *   you type                → glances at the message box (and wakes up)
 *   a new chat starts       → waves hello
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const { sentiment, config } = Mochi;
  const T = config.timing;

  const pick = list => list[Math.floor(Math.random() * list.length)];
  const chance = p => Math.random() < p;

  class MoodEngine {
    constructor(companion) {
      this.c = companion;
      this.phase = 'idle'; // idle | waiting | streaming | reacting | sleeping
      this.lastActivity = Date.now();
      this.lastScroll = 0;
      this.lastUserText = '';
      this.timers = new Map();
      this.pokes = [];
      this.hidden = false;

      companion.on('poke', () => this.poke());
      companion.on('untuck', () => { this.activity(); this.c.setMood('happy'); this.c.play('wave'); this.c.say(pick(config.phrases.hello)); this.calmDownLater(4000); });
      this.tick = setInterval(() => this.checkIdle(), 5000);
      this.scheduleIdleAction();
    }

    // ——— chat events ———
    hello() {
      this.c.setMood('happy');
      this.c.play('wave');
      this.c.say(pick(config.phrases.hello));
      this.calmDownLater(4200);
    }

    newChat() {
      this.activity({ wake: true });
      this.phase = 'idle';
      this.hello();
    }

    userMessage(text, el) {
      this.activity({ wake: true });
      this.lastUserText = text || '';
      this.phase = 'waiting';
      const first = sentiment.moodOfMessage(text);
      // Your words set the first reaction: a sad message gets a gentle face, a wild one a jump.
      this.c.setMood(first === 'curious' ? 'curious' : first);
      if (first === 'surprised') this.c.play('hop');
      if (el) this.c.lookAtElement(el, T.curiousBeforeThinking);
      if (chance(config.chatter.userMessage)) this.c.say(pick(config.phrases[first === 'sad' ? 'sad' : first === 'curious' ? 'curious' : first]));
      this.later('think', T.curiousBeforeThinking, () => {
        if (this.phase === 'waiting') this.think();
      });
    }

    responseStart() {
      this.activity({ wake: true });
      if (this.phase === 'streaming') return;
      // Still giving your message its curious glance: the pending timer switches to thinking.
      if (this.phase === 'waiting' && this.timers.has('think')) return;
      this.phase = 'waiting';
      this.think();
    }

    think() {
      clear(this.timers, 'think');
      this.c.setMood('thinking');
      if (chance(config.chatter.thinking)) this.c.say(pick(config.phrases.thinking), 1800);
    }

    responseProgress(el) {
      if (this.phase === 'streaming') return;
      this.activity();
      clear(this.timers, 'think');
      this.phase = 'streaming';
      this.c.setMood('focused');
      if (el) this.c.lookAtElement(el);
    }

    responseEnd(answerText) {
      if (this.phase !== 'waiting' && this.phase !== 'streaming') return;
      this.activity();
      clear(this.timers, 'think');
      this.phase = 'reacting';
      this.c.lookDefault();
      const mood = sentiment.reactionFor(this.lastUserText, answerText);
      this.c.setMood(mood);
      if (mood === 'excited') this.c.flashFx('love', 1700);
      if (mood === 'happy' && chance(0.3)) this.c.play('wiggle');
      if (chance(mood === 'sad' ? 0.7 : config.chatter.reaction)) this.c.say(pick(config.phrases[mood]));
      this.calmDownLater(mood === 'sad' ? T.reactionHold * 1.6 : T.reactionHold);
    }

    typing(inputEl) {
      const wasAsleep = this.phase === 'sleeping';
      this.activity({ wake: true });
      if (wasAsleep || this.phase === 'waiting' || this.phase === 'streaming') return;
      if (this.c.mood === 'neutral' || this.c.mood === 'happy') this.c.lookAtElement(inputEl, 1800);
    }

    scroll() { this.lastScroll = Date.now(); }

    visibility(hidden) {
      this.hidden = hidden;
      this.c.setPaused(hidden);
    }

    // ——— play ———
    poke() {
      const now = Date.now();
      if (now < (this.dizzyUntil || 0)) return; // let the dizzy spell play out
      this.pokes = this.pokes.filter(t => now - t < 3000).concat(now);
      if (this.phase === 'sleeping') { this.wake(); return; }
      this.activity();

      if (this.pokes.length >= 6) {
        this.pokes = [];
        this.dizzyUntil = now + 2000;
        this.c.setMood('surprised');
        this.c.play('dizzy');
        this.c.flashFx('dizzy', 1800);
        this.c.say(pick(config.phrases.dizzy));
        this.calmDownLater(2600);
        return;
      }

      const busy = this.phase === 'waiting' || this.phase === 'streaming';
      const reactions = busy
        ? [() => { this.c.play('squish'); this.c.flashFace({ eyes: 'happy', mouth: 'smile' }, 700); }]
        : [
            () => { this.c.setMood('happy'); this.c.play('hop'); this.c.say(pick(config.phrases.poke)); },
            () => { this.c.setMood('excited'); this.c.play('spin'); this.c.say('Wheee!'); },
            () => { this.c.setMood('surprised'); this.c.say(pick(config.phrases.surprised)); },
            () => { this.c.play('squish'); this.c.flashFace({ eyes: 'happy', mouth: 'big' }, 1200); this.c.flashFx('love', 1600); this.c.say('♥'); },
            () => { this.c.play('wave'); this.c.flashFace({ eyes: 'happy', mouth: 'smile' }, 1400); this.c.say(pick(config.phrases.hello)); },
            () => { this.c.play('wiggle'); this.c.flashFace({ eyes: 'happy', mouth: 'big' }, 900); this.c.say('Hehe!'); },
          ];
      pick(reactions)();
      if (!busy) this.calmDownLater(2600);
    }

    wake() {
      this.phase = 'idle';
      this.lastActivity = Date.now();
      this.c.setMood('neutral');
      this.c.play('stretch');
      this.c.say(pick(config.phrases.wake), 2200);
      this.later('wake-smile', 1700, () => { if (this.phase === 'idle') { this.c.setMood('happy'); this.calmDownLater(2500); } });
    }

    // ——— idle life ———
    activity({ wake = false } = {}) {
      this.lastActivity = Date.now();
      if (wake && this.phase === 'sleeping') this.wake();
    }

    calmDownLater(ms) {
      this.later('calm', ms, () => {
        if (this.phase === 'reacting') this.phase = 'idle';
        if (this.phase === 'idle') this.c.setMood('neutral');
      });
    }

    checkIdle() {
      if (this.phase === 'waiting' || this.phase === 'streaming' || this.phase === 'sleeping') return;
      const quiet = Date.now() - this.lastActivity;
      if (quiet >= T.sleepAfter) {
        this.phase = 'sleeping';
        clear(this.timers, 'calm');
        if (chance(0.5)) this.c.say(pick(config.phrases.sleepy), 2000);
        this.c.setMood('sleeping');
      }
    }

    scheduleIdleAction() {
      const wait = T.idleActionMin + Math.random() * (T.idleActionMax - T.idleActionMin);
      this.later('idle-action', wait, () => {
        this.idleAction();
        this.scheduleIdleAction();
      });
    }

    idleAction() {
      const reading = Date.now() - this.lastScroll < T.readingQuiet;
      if (this.hidden || reading || this.phase !== 'idle' || this.c.mood !== 'neutral' || this.c.isTucked || this.c.isHidden) return;
      const roll = Math.random();
      if (roll < 0.34) this.c.play('look');
      else if (roll < 0.52) { this.c.play('stretch'); }
      else if (roll < 0.66) { this.c.flashFx('note', 2600); if (chance(config.chatter.idle)) this.c.say(pick(config.phrases.idle), 2000); }
      else if (roll < 0.78) { this.lookAtInput(); }
      else if (roll < 0.88) { this.c.play('wave'); }
      else {
        // Excited about nothing in particular.
        this.c.setMood('excited');
        if (chance(0.6)) this.c.say(pick(config.phrases.excited), 1800);
        this.later('calm', 2400, () => { if (this.phase === 'idle') this.c.setMood('neutral'); });
      }
    }

    lookAtInput() {
      const input = Mochi.findInput?.();
      if (input) this.c.lookAtElement(input, 2200);
    }

    later(name, ms, fn) {
      clearTimeout(this.timers.get(name));
      this.timers.set(name, setTimeout(() => { this.timers.delete(name); fn(); }, ms));
    }
  }

  function clear(timers, name) {
    clearTimeout(timers.get(name));
    timers.delete(name);
  }

  Mochi.MoodEngine = MoodEngine;
})();
