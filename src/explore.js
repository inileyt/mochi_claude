/*
 * Mochi — explore mode. Now and then, when nothing is going on, Mochi goes
 * for a little trip: a walk along the bottom edge of the window, or a hop up
 * to sit on a heading or a picture for a moment. Then it comes home.
 *
 * Polite rules:
 *   - it only goes where it covers no text and no controls (links, buttons,
 *     fields…), checked point by point along the way;
 *   - it comes straight home when your mouse comes near, when you scroll or
 *     type, when the chat moves, or when a menu opens;
 *   - never during focus mode, with Reduce motion, or while hidden/tucked.
 * Off by default on claude.ai, on elsewhere (Settings → Explore the page).
 * Mochi moves with a CSS translate on top of its home spot; the spot you
 * dragged it to is never changed.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  const CONFIG = {
    gap: [45000, 90000], // ms between trips
    nearPx: 150,         // the mouse this close → go home
    stepPx: 4,           // walking: whole pixels per step…
    stepMs: 90,          // …every this many ms
    stay: [5000, 9000],  // how long Mochi sits or looks around
  };
  const CONTROLS = 'a,button,input,textarea,select,label,summary,option,video,audio,iframe,canvas,[contenteditable=""],[contenteditable="true"],[role="button"],[role="link"],[role="textbox"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="switch"],[role="slider"],[tabindex]:not([tabindex="-1"])';
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rand = ([a, b]) => a + Math.random() * (b - a);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  Mochi.settings.define({ explore: { claude: false, web: true } });
  Mochi.menu.addSetting({ path: 'explore.claude', type: 'toggle', label: 'settings.explore', when: ctx => ctx.isClaude });
  Mochi.menu.addSetting({ path: 'explore.web', type: 'toggle', label: 'settings.explore', when: ctx => !ctx.isClaude });

  /** Is there text or a control at this point of the page? (Mochi itself doesn't count.) */
  function busyAt(x, y, host) {
    const el = document.elementFromPoint(x, y);
    if (!el || el === host) return false;
    if (el.closest(CONTROLS)) return true;
    const range = document.caretRangeFromPoint?.(x, y);
    const node = range?.startContainer;
    if (node?.nodeType === 3 && /\S/.test(node.nodeValue)) {
      const r = document.createRange();
      const i = Math.min(range.startOffset, node.nodeValue.length - 1);
      r.setStart(node, Math.max(0, i));
      r.setEnd(node, Math.max(0, i) + 1);
      const box = r.getBoundingClientRect();
      if (x >= box.left - 5 && x <= box.right + 5 && y >= box.top - 4 && y <= box.bottom + 4) return true;
    }
    return false;
  }
  /** Would Mochi's body at this box cover anything? (Checks a 6 × 6 grid of points.) */
  function free(box, host) {
    if (box.left < 0 || box.top < 0 || box.right > innerWidth || box.bottom > innerHeight) return false;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
      const x = box.left + ((i + 0.5) / 6) * box.width;
      const y = box.top + ((j + 0.5) / 6) * box.height;
      if (busyAt(x, y, host)) return false;
    }
    return true;
  }

  Mochi.explore = { CONFIG, free, busyAt };

  Mochi.features = Mochi.features || [];
  Mochi.features.push({
    id: 'explore',
    init(ctx) {
      const { companion, engine, panel, isClaude } = ctx;
      const root = companion.root;
      let trip = null;        // { id, kind } while away
      let nextAt = Date.now() + rand(CONFIG.gap);
      let offset = { x: 0, y: 0 };

      const enabled = () => Mochi.settings.get(isClaude ? 'explore.claude' : 'explore.web') === true && !reduced();
      const quiet = () => !document.hidden && !companion.isHidden && !companion.isTucked && engine.phase === 'idle'
        && !Mochi.focus?.active && !Mochi.menuInstance?.isOpen && panel.sheet.hidden
        && !root.querySelector('.offer, .game') && !root.classList.contains('dragging');

      const size = () => root.offsetWidth;
      /** The part of Mochi's box that is really Mochi (not the empty corners of the sprite). */
      const body = (left, top) => { const s = size(); return { left: left + s * 0.18, top: top + s * 0.22, right: left + s * 0.82, bottom: top + s * 0.92, width: s * 0.64, height: s * 0.7 }; };
      const home = () => { const r = root.getBoundingClientRect(); return { left: r.left - offset.x, top: r.top - offset.y }; };

      function moveTo(x, y, { hop = false } = {}) {
        offset = { x: Math.round(x), y: Math.round(y) };
        root.classList.toggle('ex-hop', hop);
        root.style.setProperty('--ex-x', `${offset.x}px`);
        root.style.setProperty('--ex-y', `${offset.y}px`);
      }

      // ——— where could Mochi go? ———
      function sitSpots() {
        const s = size(), h0 = home(), out = [];
        const els = [...document.querySelectorAll('h1, h2, h3, img')].slice(0, 120);
        for (const el of els) {
          if (el.closest('mochi-companion')) continue;
          const r = el.getBoundingClientRect();
          if (r.top < s + 8 || r.top > innerHeight - 40 || r.left < 0 || r.right > innerWidth) continue;
          if (el.tagName === 'IMG' && (r.width < 80 || r.height < 60)) continue;
          const left = Math.min(r.left + 8, r.right - s);
          const top = r.top - s * 0.9; // feet on the element's top edge
          if (left < 0 || !free(body(left, top), companion.host)) continue;
          out.push({ kind: 'sit', left, top, el, dx: left - h0.left, dy: top - h0.top });
        }
        return out;
      }
      function walkPlan() {
        const s = size(), h0 = home();
        const top = innerHeight - s * 0.96; // feet on the bottom edge
        // The way down from home must be free too.
        for (const f of [0.33, 0.66, 1]) if (!free(body(h0.left, h0.top + (top - h0.top) * f), companion.host)) return null;
        // How far can Mochi walk left (it lives on the right)? Stop before anything busy.
        let reach = h0.left;
        for (let x = h0.left - 20; x >= 8; x -= 20) {
          if (!free(body(x, top), companion.host)) break;
          reach = x;
        }
        if (h0.left - reach < 60) return null;
        const to = reach + Math.random() * Math.min(h0.left - reach - 40, 160);
        return { kind: 'walk', top, from: h0.left, to, dyDown: top - h0.top };
      }

      // ——— trips ———
      const away = id => trip && trip.id === id;
      async function walk(id, toDx, dy) {
        companion.el.classList.add('walking');
        companion.lookAt(toDx < offset.x ? -8 : 8, 0);
        while (away(id) && Math.abs(offset.x - toDx) >= CONFIG.stepPx) {
          moveTo(offset.x + Math.sign(toDx - offset.x) * CONFIG.stepPx, dy);
          await sleep(CONFIG.stepMs);
        }
        companion.el.classList.remove('walking');
        companion.lookDefault();
      }

      async function go(kind) {
        if (trip) return false;
        const plan = kind === 'walk' ? walkPlan() : kind === 'sit' ? sitSpots()[0] : (() => {
          const spots = sitSpots();
          const w = walkPlan();
          const all = [...spots.slice(0, 4), ...(w ? [w] : [])];
          return all[Math.floor(Math.random() * all.length)];
        })();
        if (!plan) return false;
        const id = Math.random();
        trip = { id, kind: plan.kind };
        ctx.emit('explore', plan.kind);
        if (plan.kind === 'sit') {
          companion.play('hop');
          moveTo(plan.dx, plan.dy, { hop: true });
          await sleep(500);
          if (!away(id)) return true;
          companion.play('squish');
          companion.lookAtElement?.(plan.el, 2000);
          // Only talk with room above for the bubble (it would cover a site's header).
          if (Math.random() < 0.5 && plan.top > 110) companion.say(Mochi.tPick(plan.el.tagName === 'IMG' ? 'explore.picture' : 'explore.heading'), 1800);
          await sleep(rand(CONFIG.stay));
        } else {
          const h0 = home();
          companion.play('hop');
          moveTo(0, plan.dyDown, { hop: true });
          await sleep(450);
          if (!away(id)) return true;
          await walk(id, plan.to - h0.left, plan.dyDown);
          if (!away(id)) return true;
          companion.play('look');
          if (Math.random() < 0.4) companion.say(Mochi.tPick('explore.walk'), 1800);
          await sleep(rand(CONFIG.stay) / 2);
          if (!away(id)) return true;
          await walk(id, 0, plan.dyDown);
        }
        if (away(id)) goHome();
        return true;
      }

      function goHome() {
        if (!trip && !offset.x && !offset.y) return;
        trip = null;
        companion.el.classList.remove('walking');
        companion.lookDefault();
        if (offset.x || offset.y) { companion.play('hop'); moveTo(0, 0, { hop: true }); }
        nextAt = Date.now() + rand(CONFIG.gap);
      }

      // ——— when to go, when to come back ———
      ctx.on('tick', () => {
        if (trip || Date.now() < nextAt) return;
        nextAt = Date.now() + rand(CONFIG.gap);
        if (enabled() && quiet()) go();
      });
      for (const ev of ['userMessage', 'responseStart', 'typing', 'newChat', 'visibility', 'gameOpen', 'focusPhase']) ctx.on(ev, () => goHome());
      companion.on('menu', () => goHome());
      addEventListener('scroll', () => { if (trip) goHome(); }, { capture: true, passive: true });
      addEventListener('wheel', () => { if (trip) goHome(); }, { passive: true });
      addEventListener('resize', () => goHome(), { passive: true });
      addEventListener('pointermove', ev => {
        if (!trip) return;
        const r = companion.el.getBoundingClientRect();
        if (Math.hypot(ev.clientX - (r.left + r.width / 2), ev.clientY - (r.top + r.height / 2)) < CONFIG.nearPx) goHome();
      }, { passive: true });
      Mochi.settings.onChange(p => { if (p.startsWith('explore') && !enabled()) goHome(); });

      Mochi.explore.go = go;
      Mochi.explore.home = goHome;
      Mochi.explore.state = () => ({ trip: trip && trip.kind, offset: { ...offset }, enabled: enabled(), quiet: quiet() });
      Mochi.explore.plans = () => ({ sits: sitSpots().map(s => s.el.tagName + ':' + (s.el.textContent || s.el.alt || '').trim().slice(0, 20)), walk: !!walkPlan() });
      // Test page: {"explore": "trip" | "walk" | "sit" | "home"}.
      Mochi.debugHooks.explore = value => (value === 'home' ? goHome() : go(value === 'trip' ? undefined : value));
    },
  });
})();
