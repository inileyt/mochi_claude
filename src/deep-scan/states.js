/*
 * Mochi — Deep Scan, Task 4a: hover / focus / focus-visible / active.
 * For each component (one element per component), CSS.forcePseudoState puts
 * it in that state without moving the mouse; Mochi waits for its transition to
 * finish, reads the style change (on the element and its first descendants),
 * and takes cropped screenshots of the default and hover looks.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const D = Mochi.deepScan;
  const STATES = ['hover', 'focus', 'focus-visible', 'active'];
  const WATCH = ['backgroundColor', 'backgroundImage', 'color', 'borderTopColor', 'borderTopWidth', 'boxShadow', 'transform', 'opacity', 'outlineStyle', 'outlineColor', 'outlineWidth', 'outlineOffset',
    'textDecorationLine', 'filter', 'fontWeight', 'letterSpacing', 'width', 'height', 'paddingLeft', 'scale', 'translate'];
  const kebab = s => s.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);
  const MAX_COMPONENTS = 18;

  /** A CSS path that finds exactly this element (no attributes added to the page). */
  function pathOf(el) {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && e !== document.documentElement; e = e.parentElement) {
      if (e.id && document.querySelectorAll(`#${CSS.escape(e.id)}`).length === 1) { parts.unshift(`#${CSS.escape(e.id)}`); break; }
      const i = [...e.parentElement.children].indexOf(e) + 1;
      parts.unshift(`${e.tagName.toLowerCase()}:nth-child(${i})`);
    }
    return parts.join(' > ');
  }
  async function nodeIdOf(scan, el) {
    const { root } = await scan.cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await scan.cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: pathOf(el) });
    return nodeId || null;
  }

  /** "transform 200ms ease, box-shadow 200ms ease" → [{ property, duration, easing, delay }] */
  function transitionsOf(cs) {
    const split = v => v.split(/,(?![^(]*\))/).map(x => x.trim());
    const props = split(cs.transitionProperty), durs = split(cs.transitionDuration), eases = split(cs.transitionTimingFunction), delays = split(cs.transitionDelay);
    const ms = v => Math.round(parseFloat(v) * (v.endsWith('ms') ? 1 : 1000));
    return props.map((p, i) => ({ property: p, duration: ms(durs[i % durs.length]), easing: eases[i % eases.length], delay: ms(delays[i % delays.length]) })).filter(t => t.duration > 0 || t.delay > 0);
  }
  const longest = list => Math.min(1500, Math.max(0, ...list.map(t => t.duration + t.delay)));

  function read(el) { const cs = getComputedStyle(el); const o = {}; for (const p of WATCH) o[p] = cs[p]; o.animated = el.getAnimations?.().some(a => a.playState === 'running' && !(a instanceof CSSTransition)); return o; }
  function diff(a, b) {
    const out = {};
    for (const p of WATCH) {
      if (a[p] === b[p]) continue;
      if ((p === 'transform' || p === 'opacity' || p === 'scale' || p === 'translate') && (a.animated || b.animated)) continue; // a running animation, not the state
      if (p === 'borderTopColor' && parseFloat(b.borderTopWidth) === 0) continue; // follows the text colour, invisible
      if (p.startsWith('outline') && b.outlineStyle === 'none') continue;
      out[kebab(p)] = { from: a[p], to: b[p] };
    }
    if (b.outlineStyle === 'auto' && a.outlineStyle !== 'auto') {
      for (const k of ['outline-style', 'outline-color', 'outline-width', 'outline-offset']) delete out[k];
      out.outline = { from: 'none', to: 'browser default focus ring' };
    }
    return out;
  }
  /** Chrome applies a forced state at the next style read: read once now, so the transition starts now. */
  // …then jump its transitions to the end (the end value is what the spec needs; the state is forced anyway).
  const touch = el => {
    void getComputedStyle(el).backgroundColor; void el.getBoundingClientRect();
    for (const a of el.getAnimations?.() || []) if (a instanceof CSSTransition) { try { a.finish(); } catch (_) { /* already done */ } }
  };
  const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex], [role="button"], [role="tab"], [contenteditable="true"]';
  const descendantsOf = el => [...el.querySelectorAll('*')].filter(d => d.getBoundingClientRect().width > 0).slice(0, 10);

  async function run(scan) {
    const list = (scan.ui || []).filter(c => c.type !== 'modal' && c.type !== 'input' || c.type === 'input').slice(0, 40);
    const out = [];
    let done = 0;
    const targets = list.filter(c => c.els.some(e => e.getBoundingClientRect().width > 0)).slice(0, MAX_COMPONENTS);
    for (const c of targets) {
      scan.check();
      const el = c.els.find(e => e.getBoundingClientRect().width > 0);
      const nodeId = await nodeIdOf(scan, el).catch(() => null);
      if (!nodeId) continue;
      const cs = getComputedStyle(el);
      const transitions = transitionsOf(cs);
      const kids = descendantsOf(el);
      const base = read(el), baseKids = kids.map(read);
      const entry = { component: c.id, type: c.type, variant: c.variant || c.name || null, selector: c.selector, transitions, states: {} };
      const r = el.getBoundingClientRect();
      const clip = { x: r.left + scrollX - 16, y: r.top + scrollY - 16, width: r.width + 32, height: r.height + 40 };
      let shotDefault = false;
      const states = el.matches(FOCUSABLE) ? STATES : ['hover'];
      for (const state of states) {
        await scan.cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [state] });
        touch(el); kids.forEach(touch);
        await scan.sleep(longest(transitions) + 80);
        const now = read(el);
        const d = diff(base, now);
        const kd = kids.map((k, i) => ({ k, d: diff(baseKids[i], read(k)) })).filter(x => Object.keys(x.d).length).slice(0, 4)
          .map(x => ({ selector: Mochi.deepStructure.sel({ tag: x.k.tagName.toLowerCase(), id: x.k.id || null, cls: [...x.k.classList].slice(0, 2) }), changes: x.d }));
        if (Object.keys(d).length || kd.length) {
          // The transition that applies while entering this state (it can differ from the default one).
          const tIn = transitionsOf(getComputedStyle(el));
          entry.states[state] = { changes: d, ...(kd.length ? { children: kd } : {}), ...(JSON.stringify(tIn) !== JSON.stringify(transitions) ? { transitions: tIn } : {}) };
          if (state === 'hover' && out.filter(o => o.shots).length < 12) {
            await scan.cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
            touch(el); kids.forEach(touch);
            await scan.sleep(longest(transitions) + 80);
            await Mochi.deepShots.capture(scan, { name: `states/${c.id}-default.png`, clip, meta: { component: c.id, state: 'default' } });
            await scan.cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
            touch(el); kids.forEach(touch);
            await scan.sleep(longest(transitions) + 80);
            await Mochi.deepShots.capture(scan, { name: `states/${c.id}-hover.png`, clip, meta: { component: c.id, state: 'hover' } });
            entry.shots = { default: `screenshots/states/${c.id}-default.png`, hover: `screenshots/states/${c.id}-hover.png` };
            shotDefault = true;
          }
        }
        await scan.cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
        touch(el); kids.forEach(touch);
        await scan.sleep(longest(transitions) + 40); // back to normal before the next state
      }
      if (!shotDefault && transitions.length === 0 && !Object.keys(entry.states).length) { done++; continue; }
      await scan.sleep(longest(transitions) + 30);
      out.push(entry);
      scan.progress(++done / targets.length);
    }
    scan.spec.states = { ...(scan.spec.states || {}), interactive: out, note: 'Each state was forced with DevTools (no real mouse); values are read after the transition finished.' };
  }

  Mochi.deepStates = { pathOf, nodeIdOf, transitionsOf };
  D.addPhase({ id: 'states', order: 50, cdp: true, label: 'deep.step.states', budget: 45000, weight: 2, run });
})();
