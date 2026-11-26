/*
 * Mochi — Deep Scan: pointer-reactive motion. Some of the most memorable motion on a page isn't in the
 * CSS at all — it's JavaScript that watches the mouse: buttons that lean toward the cursor (magnetic), a
 * dot or glow that trails it (follower), cards that tilt in 3D as you move over them (tilt), or elements
 * that wake up only when the pointer is near (proximity). None of this shows in a static scan or in the
 * page's stylesheet, so this phase *measures* it: it moves a synthetic cursor (a real `mouseMoved`, never a
 * click — the debugger proxy enforces that) on a small grid around each candidate and watches how the
 * element's transform answers. Every result is tagged `evidence: 'measured'`.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const D = Mochi.deepScan;
  const MAX_PROBE = 8, SETTLE = 170; // ms to let a transition answer each cursor move
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const sel = el => Mochi.deepStructure.sel({ tag: el.tagName.toLowerCase(), id: el.id || null, cls: [...el.classList].filter(c => !/^(is-|has-|active|open|show|hover)/.test(c)).slice(0, 2) });

  /** Translate (tx,ty), scale (sx,sy), 3D-rotation (rx,ry, degrees) of an element's computed transform. */
  function matrixOf(el) {
    const t = getComputedStyle(el).transform;
    const base = { tx: 0, ty: 0, sx: 1, sy: 1, rx: 0, ry: 0, is3d: false };
    if (!t || t === 'none') return base;
    const m = t.match(/matrix(3d)?\(([^)]+)\)/);
    if (!m) return base;
    const v = m[2].split(',').map(parseFloat);
    if (m[1]) { // matrix3d, column-major 4×4
      const ry = Math.atan2(v[8], v[10]) * 180 / Math.PI, rx = Math.atan2(-v[9], v[10]) * 180 / Math.PI;
      return { tx: v[12], ty: v[13], sx: Math.hypot(v[0], v[1], v[2]), sy: Math.hypot(v[4], v[5], v[6]), rx, ry, is3d: Math.abs(v[8]) > 1e-3 || Math.abs(v[9]) > 1e-3 };
    }
    const [a, b, c, d, e, f] = v; // matrix(a,b,c,d,e,f)
    return { tx: e, ty: f, sx: Math.hypot(a, b), sy: Math.hypot(c, d), rx: 0, ry: 0, is3d: false };
  }
  const opacityOf = el => parseFloat(getComputedStyle(el).opacity) || 1;

  async function moveTo(scan, x, y) {
    await scan.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y) });
    await frame(); await sleep(SETTLE);
  }
  const sample = el => ({ m: matrixOf(el), o: opacityOf(el) });

  /** Candidate elements worth probing: CTAs, and anything whose style hints pointer-reactivity. */
  function candidates(scan) {
    const hint = '[data-tilt], [class*="magnet" i], [class*="tilt" i], [class*="cursor" i], [class*="parallax" i], [class*="spotlight" i], [class*="glow" i]';
    const vp = { w: innerWidth, h: innerHeight };
    const pick = [], seen = new Set();
    const onScreen = el => { const r = el.getBoundingClientRect(); return r.width >= 8 && r.height >= 8 && r.bottom > 0 && r.top < vp.h && r.right > 0 && r.left < vp.w; };
    const reactive = el => { const cs = getComputedStyle(el); return el.matches(hint) || /transform/.test(cs.transitionProperty) || cs.transitionProperty === 'all' || /transform/.test(cs.willChange); };
    const add = el => { if (!el || seen.has(el) || scan.ignore?.contains(el) || !onScreen(el) || !reactive(el)) return; seen.add(el); pick.push(el); };
    document.querySelectorAll(hint).forEach(add); // explicit hints first
    document.querySelectorAll('a, button, [role="button"], [class*="btn" i], [class*="card" i], [class*="tile" i], [class*="item" i], img').forEach(add);
    // then a capped sweep for anything else that transitions or will-change its transform (a proximity tile need not be a button)
    let n = 0;
    for (const el of (document.body ? document.body.querySelectorAll('*') : [])) { if (n++ > 1500 || pick.length >= 40) break; add(el); }
    return pick.slice(0, MAX_PROBE);
  }

  /** Follower children: small absolutely-placed nodes that might trail the cursor. */
  const followers = el => [...el.querySelectorAll('[class*="cursor" i], [class*="follow" i], [class*="dot" i], [class*="glow" i]')]
    .filter(k => { const cs = getComputedStyle(k); return cs.position === 'absolute' || cs.position === 'fixed'; }).slice(0, 2);

  async function probe(scan, el) {
    const r = el.getBoundingClientRect();
    const cx = Math.max(2, Math.min(innerWidth - 2, r.left + r.width / 2)), cy = Math.max(2, Math.min(innerHeight - 2, r.top + r.height / 2));
    const dx = Math.min(r.width / 2 + 30, 120), dy = Math.min(r.height / 2 + 30, 120);
    const farX = cx < innerWidth / 2 ? innerWidth - 2 : 2, farY = cy < innerHeight / 2 ? innerHeight - 2 : 2;
    const kids = followers(el);
    const read = () => ({ self: sample(el), kids: kids.map(sample) });

    await moveTo(scan, farX, farY); const base = read();
    await moveTo(scan, cx, cy); const near = read();
    await moveTo(scan, Math.min(innerWidth - 2, cx + dx), cy); const right = read();
    await moveTo(scan, Math.max(2, cx - dx), cy); const left = read();
    await moveTo(scan, cx, Math.min(innerHeight - 2, cy + dy)); const down = read();
    await moveTo(scan, cx, Math.max(2, cy - dy)); const up = read();
    await moveTo(scan, farX, farY); // park the cursor away again

    const d = (a, b) => ({ tx: b.self.m.tx - a.self.m.tx, ty: b.self.m.ty - a.self.m.ty, sx: b.self.m.sx - a.self.m.sx, o: b.self.o - a.self.o, rx: b.self.m.rx - a.self.m.rx, ry: b.self.m.ry - a.self.m.ry });
    const rX = d(base, right), lX = d(base, left), dY = d(base, down), uY = d(base, up), nr = d(base, near);
    const opp = (p, q) => Math.sign(p) !== 0 && Math.sign(p) === -Math.sign(q); // reverses with cursor side
    const big = (...xs) => Math.max(...xs.map(Math.abs));

    // Tilt: 3D rotation that swings with cursor position.
    if ((right.self.m.is3d || left.self.m.is3d || up.self.m.is3d || down.self.m.is3d) && (big(rX.ry, lX.ry) > 1.5 || big(uY.rx, dY.rx) > 1.5)) {
      return { selector: sel(el), kind: 'tilt', evidence: 'measured', detail: `rotates up to ~${Math.round(big(rX.ry, lX.ry))}°Y / ${Math.round(big(uY.rx, dY.rx))}°X with the pointer (3D card tilt)` };
    }
    // Magnetic: the element itself translates, and the direction flips with the cursor side.
    const magX = opp(rX.tx, lX.tx) && big(rX.tx, lX.tx) > 1.5, magY = opp(dY.ty, uY.ty) && big(dY.ty, uY.ty) > 1.5;
    if (magX || magY) {
      const toward = (magX && rX.tx > 0) || (magY && dY.ty > 0);
      return { selector: sel(el), kind: 'magnetic', evidence: 'measured', detail: `leans ${toward ? 'toward' : 'away from'} the pointer up to ~${Math.round(big(rX.tx, lX.tx, dY.ty, uY.ty))}px (JS, not CSS)` };
    }
    // Follower: a child trails the cursor while the element itself holds still.
    for (let i = 0; i < kids.length; i++) {
      const kr = right.kids[i].m.tx - base.kids[i].m.tx, kl = left.kids[i].m.tx - base.kids[i].m.tx;
      if (opp(kr, kl) && big(kr, kl) > 4) return { selector: sel(el), kind: 'follower', evidence: 'measured', detail: `${sel(kids[i])} trails the pointer` };
    }
    // Proximity: it reacts to the pointer being near (scale/opacity) without a directional lean.
    if (big(nr.sx) > 0.02 || big(nr.o) > 0.04) {
      return { selector: sel(el), kind: 'proximity', evidence: 'measured', detail: `${big(nr.sx) > 0.02 ? `scales ${nr.sx > 0 ? 'up' : 'down'}` : `fades ${nr.o > 0 ? 'in' : 'out'}`} when the pointer is near` };
    }
    return null;
  }

  async function run(scan) {
    const els = candidates(scan);
    const effects = [];
    for (const el of els) {
      scan.check?.();
      try { const hit = await probe(scan, el); if (hit) effects.push(hit); } catch (_) { /* element went away or probe blocked */ }
      scan.progress?.(effects.length ? 0.5 : 0);
    }
    // de-dup by selector+kind
    const seen = new Set();
    const uniq = effects.filter(e => { const k = `${e.kind}:${e.selector}`; if (seen.has(k)) return false; seen.add(k); return true; });
    scan.spec.pointer = {
      effects: uniq, probed: els.length,
      note: uniq.length
        ? "Measured by moving the cursor: these are JavaScript mouse effects (not in the CSS or the stylesheet). Recreate them with a pointermove handler."
        : 'No pointer-reactive motion was measured on the elements probed.',
    };
  }

  Mochi.deepPointer = { matrixOf, candidates };
  D.addPhase({ id: 'pointer', order: 58, cdp: true, label: 'deep.step.pointer', budget: 14000, weight: 1, run });
})();
