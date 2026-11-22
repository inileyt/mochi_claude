/*
 * Mochi — start-up. Mounts Mochi, wires the chat watcher to the mood engine,
 * and keeps Mochi in a spot that never covers the message box. Runs on its own
 * on claude.ai, and on any other page when the toolbar button injects it.
 *
 * Features plug in without touching this file:
 *   Mochi.features.push({ id: 'sound', init(ctx) { ctx.on('levelUp', …) } })
 * ctx: { companion, engine, watcher, panel, menu, isClaude, actions, on(event, fn), emit(event, …) }
 * Events: userMessage(text, el) · responseStart · responseProgress(el) · responseEnd(text) ·
 *         typing(input) · newChat · scroll · visibility(hidden) · poke · hello · tick (every 5 s)
 * Test hooks: Mochi.debugHooks.myKey = (value, ctx) => … answers
 *   document.dispatchEvent(new CustomEvent('mochi:debug', { detail: { myKey: value } }))
 */
(async () => {
  const Mochi = globalThis.Mochi;
  if (!Mochi || Mochi.started || window.top !== window) return;
  Mochi.features = Mochi.features || [];
  Mochi.debugHooks = Mochi.debugHooks || {};
  Mochi.started = true;

  // On claude.ai Mochi follows the chat. Anywhere else (brought in by the toolbar
  // button) it only notices typing, scrolling and quiet time, and reads no page text.
  // The local test page (test/test-page.html) stands in for claude.ai: <html data-mochi-test="claude">.
  const isLocal = location.protocol === 'file:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  // Which chat site this is (src/site.js): claude.ai, ChatGPT or Gemini (when enabled), or none.
  const site = Mochi.sites.current();
  const isClaude = site?.id === 'claude';
  const isChat = !!site;

  await Mochi.settings.load();

  // A tiny event bus, so features can listen to what happens.
  const listeners = {};
  const on = (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); };
  const emit = (name, ...args) => {
    for (const fn of listeners[name] || []) {
      try { fn(...args); } catch (_) { /* one feature failing never stops Mochi */ }
    }
  };

  const companion = await new Mochi.Companion().mount();
  const engine = new Mochi.MoodEngine(companion);
  const watcher = new Mochi.ChatWatcher({
    userMessage: (text, el) => { engine.userMessage(text, el); emit('userMessage', text, el); },
    responseStart: () => { engine.responseStart(); emit('responseStart'); },
    responseProgress: el => { engine.responseProgress(el); emit('responseProgress', el); },
    responseEnd: (text, el) => { engine.responseEnd(text); emit('responseEnd', text, el); },
    typing: input => { engine.typing(input); emit('typing', input); },
    newChat: () => { engine.newChat(); emit('newChat'); },
    scroll: () => { engine.scroll(); emit('scroll'); },
    visibility: hidden => { engine.visibility(hidden); emit('visibility', hidden); },
  }, { chat: isChat, site });
  watcher.start();
  companion.on('poke', () => emit('poke'));

  // ——— menu, UI scan and results panel ———
  let lastScan = null;
  let scanning = false;
  const runScan = async () => {
    if (scanning) return null;
    scanning = true;
    menu.close();
    if (panel.isOpen) panel.close();
    if (companion.isTucked) companion.setTucked(false);
    engine.scanStart();
    try {
      // The sniffing animation plays for at least a moment, even on a quick scan.
      const [scan] = await Promise.all([Mochi.scanUI({ ignore: companion.host }), new Promise(r => setTimeout(r, 1300))]);
      lastScan = scan;
      engine.scanDone(scan);
      emit('scanned', scan);
      // Into the pocket. A scan of claude.ai itself has nothing to bring back later.
      const entry = await Mochi.pocket.add(scan, { offered: isClaude });
      panel.showScan(entry, { saved: true });
      setTimeout(() => engine.saved(), 1500);
      return entry;
    } catch (err) {
      engine.scanFailed();
      return null;
    } finally {
      scanning = false;
    }
  };
  // ——— the pocket ———
  // Paste puts the AI prompt into claude.ai's message box; you press Enter yourself.
  const paste = async entry => {
    if (panel.isOpen) panel.close();
    const ok = await Mochi.insertIntoComposer(entry.prompt || Mochi.promptFor(entry));
    engine.pasted(ok);
    return ok;
  };
  const openPocket = async () => {
    panel.showPocket(await Mochi.pocket.list(), {
      paste: isClaude ? paste : null,
      copy: async entry => { await Mochi.ui.copyText(entry.prompt || Mochi.promptFor(entry), companion.shadow); engine.copied(Mochi.t('library.thePrompt')); },
      formats: entry => (entry.kind === 'deep' ? Mochi.deepScan?.showPaste(entry, ctx) : entry.kind === 'component' ? panel.showComponent(entry, { saved: true }) : panel.showScan(entry, { saved: true })),
      remove: async entry => { await Mochi.pocket.remove(entry.id); engine.removed(); openPocket(); },
    });
  };
  let offering = false;
  const maybeOffer = async () => {
    if (!isClaude || offering || panel.isOffering || document.hidden || companion.isHidden || companion.isTucked) return;
    offering = true;
    try {
      const entry = await Mochi.pocket.nextUnoffered();
      if (!entry) return;
      await Mochi.pocket.markOffered(entry.id);
      engine.offer();
      panel.showOffer(entry, { paste, later: () => engine.later(), open: openPocket });
    } finally {
      offering = false;
    }
  };

  // ——— Pick an element ———
  let picker = null;
  const runPick = async () => {
    if (scanning) return null;
    menu.close();
    if (panel.isOpen) panel.close();
    if (companion.isTucked) companion.setTucked(false);
    picker = picker || new Mochi.Picker(companion);
    engine.pickStart();
    const el = await picker.pick();
    if (!el) { engine.pickCancel(); return null; }
    try {
      const cmp = Mochi.extractComponent(el, { mount: companion.shadow });
      const entry = await Mochi.pocket.add(cmp, { offered: isClaude });
      engine.pickDone(cmp);
      emit('picked', cmp);
      panel.showComponent(entry, { saved: true });
      setTimeout(() => engine.saved(), 1600);
      return entry;
    } catch (err) {
      engine.scanFailed();
      return null;
    }
  };

  const actions = {
    scan: runScan,
    pick: runPick,
    play: () => { engine.poke(); emit('poke'); }, // the same as a poke: XP, sounds and the friend notice it too
    pocket: openPocket,
    paste: isClaude ? paste : null,
    copied: what => engine.copied(what),
    downloaded: name => engine.downloaded(name),
    resetPosition: () => companion.resetPosition(),
  };
  const panel = new Mochi.Panel(companion, actions);
  const ctx = { companion, engine, watcher, panel, isClaude, isChat, site, actions, on, emit };
  const menu = new Mochi.Menu(companion, ctx);
  ctx.menu = menu;
  Mochi.menuInstance = menu;
  companion.on('menu', () => { panel.hideOffer(); menu.toggle(); });

  // On claude.ai, Mochi offers a style it brought from another site: soon after
  // the page opens, when a scan lands in the pocket from another tab, and when
  // you come back to this tab.
  if (isClaude) {
    setTimeout(maybeOffer, 2600);
    Mochi.pocket.onChange(() => setTimeout(maybeOffer, 400));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(maybeOffer, 600); });
  }

  // The toolbar button calls this: hide Mochi, or bring it back with a wave.
  Mochi.toggle = () => {
    const show = companion.isHidden;
    companion.setHidden(!show);
    if (show) engine.hello();
    return show ? 'shown' : 'hidden';
  };

  // ——— placement: in the free space right of the message box, or just above it on narrow screens ———
  const place = () => {
    if (!isChat) { companion.setAutoPosition(24, 24); return; }
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
  companion.on('reposition', () => { place(); companion.say(Mochi.t('say.backToSpot')); });
  addEventListener('resize', place, { passive: true });
  setInterval(place, 1500);

  // Features plug in here (outfits, progress, friends, sounds, …).
  for (const feature of Mochi.features || []) {
    try { feature.init?.(ctx); } catch (_) { /* a feature that fails to start is skipped */ }
  }
  setInterval(() => emit('tick'), 5000);

  // First hello.
  setTimeout(() => { engine.hello(); emit('hello'); }, 900);

  // Test hooks: only on a local test page, never on claude.ai.
  if (location.protocol === 'file:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    document.addEventListener('mochi:debug', ev => {
      const { mood, action, say, fx, idleNow, sleepNow, scan, openMenu, format, openPocket: pocket, offer, pasteLast } = ev.detail || {};
      if (pocket) openPocket();
      if (offer) Mochi.pocket.list().then(items => items[0] && (engine.offer(), panel.showOffer(items[0], { paste, later: () => engine.later(), open: openPocket })));
      if (pasteLast) Mochi.pocket.list().then(items => items[0] && paste(items[0]));
      if (scan) runScan();
      if (ev.detail?.pick) runPick();
      if (openMenu) menu.open(typeof openMenu === 'string' ? openMenu : undefined);
      if (ev.detail?.setSetting) Mochi.settings.set(...ev.detail.setSetting);
      for (const [key, value] of Object.entries(ev.detail || {})) {
        const hook = Mochi.debugHooks?.[key];
        if (hook) {
          try {
            // A test can read what a hook returned: <html data-mochi-result-<key>="json"> (local test pages only).
            Promise.resolve(hook(value, ctx)).then(result => {
              try { document.documentElement.setAttribute(`data-mochi-result-${key.toLowerCase()}`, JSON.stringify(result === undefined ? null : result).slice(0, 40e6)); } catch (_) { /* not serialisable */ }
            }, err => document.documentElement.setAttribute(`data-mochi-result-${key.toLowerCase()}`, JSON.stringify({ error: String(err?.message || err) })));
          } catch (err) { console.warn('[mochi debug]', key, err); }
        }
      }
      if (format && lastScan) { if (!panel.isOpen) panel.showScan(lastScan); panel.setFormat(format); }
      if (mood) companion.setMood(mood);
      if (action) companion.play(action);
      if (say) companion.say(say);
      if (fx) companion.flashFx(fx, 2500);
      if (idleNow) engine.idleAction();
      if (sleepNow) { engine.lastActivity = 0; engine.phase = 'idle'; engine.checkIdle(); }
    });
    Mochi.debug = { companion, engine, watcher, panel, menu, ctx, runScan, runPick, openPocket, paste, maybeOffer, get picker() { return picker; }, get lastScan() { return lastScan; } };
  }
})();
