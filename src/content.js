/*
 * Mochi — start-up. Mounts Mochi, wires the chat watcher to the mood engine,
 * and keeps Mochi in a spot that never covers the message box. Runs on its own
 * on claude.ai, and on any other page when the toolbar button injects it.
 */
(async () => {
  const Mochi = globalThis.Mochi;
  if (!Mochi || Mochi.started || window.top !== window) return;
  Mochi.started = true;

  // On claude.ai Mochi follows the chat. Anywhere else (brought in by the toolbar
  // button) it only notices typing, scrolling and quiet time, and reads no page text.
  const isClaude = location.hostname === 'claude.ai';

  const companion = await new Mochi.Companion().mount();
  const engine = new Mochi.MoodEngine(companion);
  const watcher = new Mochi.ChatWatcher({
    userMessage: (text, el) => engine.userMessage(text, el),
    responseStart: () => engine.responseStart(),
    responseProgress: el => engine.responseProgress(el),
    responseEnd: text => engine.responseEnd(text),
    typing: input => engine.typing(input),
    newChat: () => engine.newChat(),
    scroll: () => engine.scroll(),
    visibility: hidden => engine.visibility(hidden),
  }, { chat: isClaude });
  watcher.start();

  // The toolbar button calls this: hide Mochi, or bring it back with a wave.
  Mochi.toggle = () => {
    const show = companion.isHidden;
    companion.setHidden(!show);
    if (show) engine.hello();
    return show ? 'shown' : 'hidden';
  };

  // ——— placement: in the free space right of the message box, or just above it on narrow screens ———
  const place = () => {
    if (!isClaude) { companion.setAutoPosition(24, 24); return; }
    const size = companion.size;
    const input = Mochi.findInput();
    if (!input) { companion.setAutoPosition(24, 110); return; }
    const r = input.getBoundingClientRect();
    if (!r.width) { companion.setAutoPosition(24, 110); return; }
    const gutter = innerWidth - r.right;
    if (gutter >= size + 32) {
      // Sit in the right gutter, feet level with the bottom of the message box.
      const right = Math.max(16, Math.min(64, (gutter - size) / 2));
      companion.setAutoPosition(right, Math.max(12, innerHeight - r.bottom - 6));
    } else {
      // Narrow window: perch above the right end of the message box.
      companion.setAutoPosition(12, Math.max(12, innerHeight - r.top + 8));
    }
  };
  place();
  companion.on('reposition', () => { place(); companion.say('Back to my spot!'); });
  addEventListener('resize', place, { passive: true });
  setInterval(place, 1500);

  // First hello.
  setTimeout(() => engine.hello(), 900);

  // Test hooks: only on a local test page, never on claude.ai.
  if (location.protocol === 'file:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    document.addEventListener('mochi:debug', ev => {
      const { mood, action, say, fx, idleNow, sleepNow } = ev.detail || {};
      if (mood) companion.setMood(mood);
      if (action) companion.play(action);
      if (say) companion.say(say);
      if (fx) companion.flashFx(fx, 2500);
      if (idleNow) engine.idleAction();
      if (sleepNow) { engine.lastActivity = 0; engine.phase = 'idle'; engine.checkIdle(); }
    });
    Mochi.debug = { companion, engine, watcher };
  }
})();
