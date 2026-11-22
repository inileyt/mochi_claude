/*
 * Mochi — Deep Scan, Task 5: motion.
 *  5a — CSS animations and transitions: what's running (document.getAnimations()),
 *       what started during the scan (the DevTools Animation domain), their
 *       timing and keyframes (and the authored @keyframes), the transitions
 *       declared on elements, and whether the site handles reduced motion.
 *  5b — JavaScript-driven motion (rAF, GSAP, Framer Motion, Lottie…): elements
 *       that move without a CSS animation are sampled every frame for a few
 *       seconds and fitted to a short description; libraries are named from
 *       what the page shows (script names, attributes, elements).
 * The page is captured as it is: reduced motion is not emulated.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const D = Mochi.deepScan;
  const selOf = el => Mochi.deepStructure.sel({ tag: el.tagName.toLowerCase(), id: el.id || null, cls: [...el.classList].filter(c => !/^(is-|has-|active|open|show)/.test(c)).slice(0, 2) });
  const ms = v => Math.round(v || 0);

  function timingOf(a) {
    const t = a.effect.getTiming();
    const kf = a.effect.getKeyframes?.() || [];
    const easing = t.easing === 'linear' && kf[0]?.easing && kf.every(k => k.easing === kf[0].easing) ? kf[0].easing : t.easing;
    return { duration: ms(t.duration), delay: ms(t.delay), iterations: t.iterations === Infinity ? 'infinite' : t.iterations, direction: t.direction, fill: t.fill, easing };
  }
  const keyframesOf = a => (a.effect.getKeyframes?.() || []).slice(0, 8).map(k => Object.fromEntries(Object.entries(k).filter(([key, v]) => !['composite', 'computedOffset', 'easing'].includes(key) && v !== null && v !== undefined)));

  /** Selectors inside @media (prefers-reduced-motion: reduce) blocks, and what they switch off. */
  function reducedMotion(scan) {
    const blocks = [];
    for (const s of scan.sheets || []) {
      for (const m of s.text.matchAll(/@media[^{]*prefers-reduced-motion\s*:\s*reduce[^{]*\{/g)) {
        const open = m.index + m[0].length - 1;
        const body = s.text.slice(open + 1, Mochi.deepCss.blockEnd(s.text, open));
        for (const r of body.matchAll(/([^{}]+)\{([^}]*)\}/g)) blocks.push({ selector: r[1].trim().replace(/\s+/g, ' '), sets: r[2].trim().replace(/\s+/g, ' ').slice(0, 160) });
      }
    }
    return { handled: blocks.length > 0, rules: blocks.slice(0, 12), note: blocks.length ? 'The site turns some motion off for people who ask for less motion. Keep these rules.' : 'No prefers-reduced-motion rules found. Add them when you rebuild (turn off parallax, reveals and loops).' };
  }

  async function runCss(scan) {
    const running = document.getAnimations().filter(a => a.effect?.target && !scan.ignore.contains(a.effect.target));
    const seen = new Map();
    for (const a of running) {
      const isTransition = typeof CSSTransition !== 'undefined' && a instanceof CSSTransition;
      if (isTransition) continue;
      const name = a.animationName || a.id || 'web animation';
      const target = selOf(a.effect.target);
      const key = `${name}|${target}`;
      if (seen.has(key)) { seen.get(key).count++; continue; }
      seen.set(key, { name, kind: a.animationName ? 'css animation' : 'web animation (JS)', target, count: 1, ...timingOf(a), keyframes: keyframesOf(a), playState: a.playState, trigger: 'on load (running)', css: scan.css?.keyframes?.[name] ? `@keyframes ${name} { ${scan.css.keyframes[name]} }` : null });
    }
    // Animations that started while the scan ran (opening menus, reveals, hovers…): the page's own
    // animationstart events (Chrome doesn't give extensions the DevTools Animation domain).
    for (const a of scan.startedAnimations || []) {
      const key = `${a.name}|${a.target}`;
      if (seen.has(key)) { const s = seen.get(key); s.count++; if (a.delay && !s.delays.includes(a.delay)) s.delays.push(a.delay); continue; }
      seen.set(key, { ...a, count: 1, delays: a.delay ? [a.delay] : [], trigger: a.during ? `started during: ${a.during}` : 'started during the scan', css: scan.css?.keyframes?.[a.name] ? `@keyframes ${a.name} { ${scan.css.keyframes[a.name]} }` : null });
      if (seen.size > 60) break;
    }
    for (const s of seen.values()) if (s.delays?.length > 1) { const d = s.delays.sort((x, y) => x - y); s.stagger = d[1] - d[0]; }
    // Transitions declared on elements (what animates when a state or class changes).
    const transitions = new Map();
    for (const n of scan.nodes || []) {
      if (!n.el.isConnected) continue;
      const cs = getComputedStyle(n.el);
      if (cs.transitionDuration.split(',').every(d => parseFloat(d) === 0)) continue;
      const list = Mochi.deepStates.transitionsOf(cs);
      const key = `${selOf(n.el)}|${JSON.stringify(list)}`;
      if (!transitions.has(key)) transitions.set(key, { target: selOf(n.el), transitions: list, count: 0 });
      transitions.get(key).count++;
      if (transitions.size > 40) break;
    }
    scan.spec.motion = {
      ...(scan.spec.motion || {}),
      animations: [...seen.values()],
      transitions: [...transitions.values()],
      reducedMotion: reducedMotion(scan),
      capturedWithReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      started: (scan.startedAnimations || []).length,
    };
  }

  /** From the start of a scan: every CSS animation that starts (and the step it started in). */
  D.addPhase({
    id: 'motion-watch', order: 1, always: true, cdp: false, label: 'deep.step.prepare', budget: 2000, weight: 0.1,
    run(scan) {
      scan.startedAnimations = [];
      const onStart = ev => {
        const el = ev.target;
        if (!(el instanceof Element) || scan.ignore.contains(el) || scan.startedAnimations.length >= 300) return;
        const a = el.getAnimations?.().find(x => x.animationName === ev.animationName);
        const t = a ? timingOf(a) : {};
        scan.startedAnimations.push({ name: ev.animationName, kind: 'css animation', target: selOf(el), ...t, keyframes: a ? keyframesOf(a) : [], during: scan.step ? Mochi.t(scan.step) : null, at: Math.round(performance.now()) });
      };
      addEventListener('animationstart', onStart, true);
      D.cleanup.push(() => removeEventListener('animationstart', onStart, true));
    },
  });

  Mochi.deepMotion = { timingOf, keyframesOf, reducedMotion };
  D.addPhase({ id: 'motion', order: 60, cdp: true, label: 'deep.step.motion', budget: 15000, weight: 1, run: runCss });
})();
