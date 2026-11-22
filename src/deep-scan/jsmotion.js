/*
 * Mochi — Deep Scan, Task 5b: motion driven by JavaScript (requestAnimationFrame,
 * GSAP, Framer Motion, Lottie…). Elements that move without a CSS animation are
 * sampled every frame for a few seconds and the samples are fitted to a short
 * description ("moves vertically ±12px, smooth (sine), every ~3.0s, looping").
 * Libraries are named from what the page shows (script names, attributes,
 * elements) — a suggestion for the rebuild.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const D = Mochi.deepScan;
  const frame = () => new Promise(r => requestAnimationFrame(t => r(t)));
  const selOf = el => Mochi.deepStructure.sel({ tag: el.tagName.toLowerCase(), id: el.id || null, cls: [...el.classList].filter(c => !/^(is-|has-|active|open|show)/.test(c)).slice(0, 2) });

  function matrixOf(cs) {
    const t = cs.transform;
    if (!t || t === 'none') return { tx: 0, ty: 0, scale: 1, rot: 0 };
    const m = t.match(/matrix(3d)?\(([^)]+)\)/);
    if (!m) return { tx: 0, ty: 0, scale: 1, rot: 0 };
    const v = m[2].split(',').map(Number);
    if (m[1]) return { tx: v[12], ty: v[13], scale: Math.hypot(v[0], v[1]), rot: Math.atan2(v[1], v[0]) * 180 / Math.PI };
    return { tx: v[4], ty: v[5], scale: Math.hypot(v[0], v[1]), rot: Math.atan2(v[1], v[0]) * 180 / Math.PI };
  }
  function sample(el) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const m = matrixOf(cs);
    return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, opacity: parseFloat(cs.opacity), tx: m.tx, ty: m.ty, scale: m.scale, rot: m.rot };
  }
  const cssAnimated = el => (el.getAnimations?.() || []).some(a => a.playState === 'running');

  /** Fits one series (times in ms, values) → { kind: 'loop'|'once'|'still', … }. */
  function fit(ts, vs) {
    const min = Math.min(...vs), max = Math.max(...vs), range = max - min;
    if (!(range > 0)) return { kind: 'still' };
    const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
    const crossings = [];
    for (let i = 1; i < vs.length; i++) if ((vs[i - 1] - mean) * (vs[i] - mean) < 0) crossings.push(ts[i - 1] + (ts[i] - ts[i - 1]) * Math.abs(vs[i - 1] - mean) / Math.abs(vs[i] - vs[i - 1]));
    const span = ts[ts.length - 1] - ts[0];
    // Directional change that ends: a one-shot move.
    const first = vs[0], last = vs[vs.length - 1];
    if (crossings.length <= 1 && Math.abs(last - first) > range * 0.8) {
      const target = last, start = first;
      const done = ts[vs.findIndex(v => Math.abs(v - target) <= range * 0.02)] - ts[0];
      const half = ts[0] + done / 2;
      const atHalf = vs[ts.findIndex(t => t >= half)];
      const progress = (atHalf - start) / (target - start);
      const easing = progress > 0.62 ? 'ease-out' : progress < 0.38 ? 'ease-in' : Math.abs(progress - 0.5) < 0.08 ? 'linear or ease-in-out' : 'ease';
      return { kind: 'once', from: start, to: target, duration: Math.round(done), easing };
    }
    if (crossings.length >= 2) {
      const gaps = crossings.slice(1).map((c, i) => c - crossings[i]);
      const period = Math.round(2 * gaps.reduce((a, b) => a + b, 0) / gaps.length);
      // How sine-like: correlation with a sine of that period, at the best phase.
      let best = 0;
      for (let ph = 0; ph < 12; ph++) {
        const phase = (ph / 12) * 2 * Math.PI;
        const s = ts.map(t => Math.sin((2 * Math.PI * t) / period + phase));
        const sv = vs.map(v => v - mean);
        const num = s.reduce((a, x, i) => a + x * sv[i], 0);
        const den = Math.sqrt(s.reduce((a, x) => a + x * x, 0) * sv.reduce((a, x) => a + x * x, 0));
        best = Math.max(best, den ? num / den : 0);
      }
      return { kind: 'loop', amplitude: range / 2, center: mean, period, shape: best > 0.95 ? 'smooth (sine)' : best > 0.8 ? 'smooth' : 'irregular', covered: span };
    }
    return { kind: 'drift', change: last - first, over: Math.round(span) };
  }

  function describe(series) {
    const parts = [];
    const r1 = n => Math.round(n * 10) / 10;
    const axis = { ty: 'vertically', tx: 'horizontally', y: 'vertically', x: 'horizontally' };
    for (const [prop, f] of Object.entries(series)) {
      if (f.kind === 'still') continue;
      if (prop === 'opacity') parts.push(f.kind === 'loop' ? `opacity pulses ±${r1(f.amplitude)} around ${r1(f.center)} every ~${r1(f.period / 1000)}s` : f.kind === 'once' ? `fades ${f.to > f.from ? 'in' : 'out'} (${r1(f.from)} → ${r1(f.to)}) over ~${f.duration} ms, ${f.easing}` : 'opacity drifts');
      else if (prop === 'scale') parts.push(f.kind === 'loop' ? `scales ±${r1(f.amplitude * 100)}% every ~${r1(f.period / 1000)}s` : f.kind === 'once' ? `scales ${r1(f.from)} → ${r1(f.to)} over ~${f.duration} ms, ${f.easing}` : 'scale drifts');
      else if (prop === 'rot') parts.push(f.kind === 'loop' ? `rocks ±${r1(f.amplitude)}° every ~${r1(f.period / 1000)}s` : f.kind === 'once' ? `rotates ${r1(f.to - f.from)}° over ~${f.duration} ms` : `spins (${r1(f.change / f.over * 1000)}°/s)`);
      else parts.push(f.kind === 'loop' ? `moves ${axis[prop]} ±${Math.round(f.amplitude)}px, ${f.shape}, every ~${r1(f.period / 1000)}s (looping)` : f.kind === 'once' ? `moves ${Math.round(Math.abs(f.to - f.from))}px ${prop.endsWith('y') ? (f.to > f.from ? 'down' : 'up') : (f.to > f.from ? 'right' : 'left')} over ~${f.duration} ms, ${f.easing}` : `drifts ${axis[prop]} (${Math.round(f.change)}px in ${f.over} ms)`);
    }
    return parts.join('; ');
  }

  function libraries() {
    const out = new Set();
    const srcs = [...document.scripts].map(s => (s.src || '').toLowerCase());
    const inline = [...document.scripts].filter(s => !s.src).map(s => s.textContent.slice(0, 20000)).join('\n');
    const has = (re, name) => { if (srcs.some(s => re.test(s)) || re.test(inline)) out.add(name); };
    has(/gsap|tweenmax|scrolltrigger/, 'GSAP'); has(/framer|motion\.dev|framer-motion/, 'Framer Motion'); has(/lottie|bodymovin/, 'Lottie'); has(/swiper/, 'Swiper');
    has(/\baos\b|aos\.js/, 'AOS'); has(/lenis/, 'Lenis (smooth scroll)'); has(/locomotive/, 'Locomotive Scroll'); has(/anime(\.min)?\.js|animejs/, 'anime.js');
    has(/three(\.module)?(\.min)?\.js|\bTHREE\./, 'three.js (WebGL)'); has(/pixi/, 'PixiJS'); has(/scrollreveal/, 'ScrollReveal'); has(/barba/, 'Barba.js'); has(/splide/, 'Splide'); has(/slick/, 'Slick'); has(/embla/, 'Embla carousel');
    if (document.querySelector('[data-aos]')) out.add('AOS');
    if (document.querySelector('.swiper, .swiper-container, swiper-container')) out.add('Swiper');
    if (document.querySelector('lottie-player, dotlottie-player, [data-animation-path], [data-lottie]')) out.add('Lottie');
    if (document.querySelector('[data-framer-name], [data-framer-component-type]')) out.add('Framer (site builder)');
    if (document.querySelector('[data-scroll-container], [data-scroll]')) out.add('Locomotive Scroll');
    if (document.querySelector('[data-w-id]')) out.add('Webflow interactions');
    if (/requestAnimationFrame/.test(inline)) out.add('hand-written requestAnimationFrame loop');
    if (/IntersectionObserver/.test(inline)) out.add('IntersectionObserver (reveal on scroll)');
    return [...out];
  }

  async function run(scan) {
    // 1) Which visible elements move without a CSS animation?
    const near = (scan.nodes || []).filter(n => n.el.isConnected && !n.hidden && n.el.tagName !== 'CANVAS').filter(n => { const r = n.el.getBoundingClientRect(); return r.bottom > -100 && r.top < innerHeight + 100 && r.width > 4; }).slice(0, 400);
    const firstPass = new Map(near.map(n => [n.el, sample(n.el)]));
    await scan.sleep(260); await frame();
    const moving = [];
    for (const n of near) {
      const a = firstPass.get(n.el), b = sample(n.el);
      const moved = Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty) > 0.5 || Math.abs(a.scale - b.scale) > 0.003 || Math.abs(a.rot - b.rot) > 0.2 || Math.abs(a.opacity - b.opacity) > 0.01;
      if (moved && !cssAnimated(n.el)) moving.push(n.el);
    }
    const top = moving.filter(el => !moving.some(o => o !== el && o.contains(el))).slice(0, 12);
    scan.check();
    // 2) Every frame for ~3.2 s.
    const series = top.map(() => ({ ts: [], s: [] }));
    const t0 = performance.now();
    while (top.length && performance.now() - t0 < 3200) {
      const t = await frame();
      top.forEach((el, i) => { series[i].ts.push(t - t0); series[i].s.push(sample(el)); });
      if (series[0].ts.length % 30 === 0) scan.progress((performance.now() - t0) / 3200);
    }
    // 3) Fit.
    const found = top.map((el, i) => {
      const { ts, s } = series[i];
      const props = {};
      for (const p of ['tx', 'ty', 'scale', 'rot', 'opacity']) { const f = fit(ts, s.map(x => x[p])); if (f.kind !== 'still' && (p === 'opacity' ? f.amplitude > 0.01 || f.kind !== 'loop' : true)) props[p] = f; }
      return { target: selOf(el), driver: 'JavaScript (no CSS animation on it)', description: describe(props), fit: props, frames: ts.length, sampledMs: Math.round(ts[ts.length - 1] || 0) };
    }).filter(x => x.description);
    scan.spec.motion = { ...(scan.spec.motion || {}), js: found, libraries: libraries(), jsNote: 'Elements were watched for ~3 s after load; motion that only starts on interaction or scroll is in the states and scroll sections.' };
  }

  Mochi.deepJsMotion = { fit, describe, matrixOf, libraries };
  D.addPhase({ id: 'jsmotion', order: 62, cdp: false, label: 'deep.step.motion', budget: 12000, weight: 1, run });
})();
