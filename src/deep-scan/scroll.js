/*
 * Mochi — Deep Scan, Task 6: scroll behaviour. The page is scrolled from top to
 * bottom (fine 20px steps over the first 300px, then 20% of the viewport), and
 * Mochi records: reveal-on-scroll triggers (which class/style changes, at what
 * visible share, with which stagger), sticky/fixed elements that change (exact
 * threshold found by scrolling back and forth), parallax ratios, scroll-snap,
 * smooth scrolling, scroll-driven CSS animations, lazily loaded content,
 * progress bars, "back to top" buttons. Then it scrolls back to the top.
 * Runs before tokens/components so revealed elements are described as revealed.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const D = Mochi.deepScan;
  const frames = n => Mochi.deepShots.frames(n);
  const selOf = el => Mochi.deepStructure.sel({ tag: el.tagName.toLowerCase(), id: el.id || null, cls: [...el.classList].filter(c => !/^(is-|has-|active|open|show|aos-)/.test(c)).slice(0, 2) });
  const WATCH = ['height', 'backgroundColor', 'boxShadow', 'transform', 'opacity', 'top', 'paddingTop', 'borderBottomColor', 'backdropFilter', 'color', 'visibility', 'display'];
  const round = n => Math.round(n);

  async function to(y) { scrollTo({ left: 0, top: y, behavior: 'instant' }); await frames(2); }
  // The visible share, as IntersectionObserver counts it (with the element's current transform).
  const ratioOf = el => { const r = el.getBoundingClientRect(); if (!r.height) return 0; const vis = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)); return vis / r.height; };
  const look = el => { const cs = getComputedStyle(el); const o = {}; for (const p of WATCH) o[p] = cs[p]; o.h = round(el.getBoundingClientRect().height); o.cls = [...el.classList].sort().join(' '); return o; };
  const differs = (a, b) => WATCH.some(p => a[p] !== b[p]) || a.cls !== b.cls || Math.abs(a.h - b.h) > 1;

  async function run(scan) {
    const nodes = (scan.nodes || []).filter(n => n.el.isConnected);
    const fixedEls = nodes.filter(n => ['sticky', 'fixed'].includes(n.style.position)).map(n => n.el).filter(el => !scan.ignore.contains(el)).slice(0, 20);
    const startHeight = document.documentElement.scrollHeight;
    const startCount = document.body.getElementsByTagName('*').length;
    const docY = el => el.getBoundingClientRect().top + scrollY;
    // Parallax candidates: region-level blocks and their children (doc position should not change with scroll).
    const blocks = nodes.filter(n => !n.hidden && n.rect.h > 40 && n.rect.w > 40 && !['sticky', 'fixed'].includes(n.style.position) && n.depth <= 6).map(n => n.el).slice(0, 600);

    // Every class/style change while scrolling, with where we were.
    const changes = [];
    let stepY = 0;
    const mo = new MutationObserver(list => {
      for (const m of list) {
        const el = m.target;
        if (!(el instanceof Element) || scan.ignore.contains(el) || changes.length > 2000) continue;
        if (m.attributeName === 'style' && fixedEls.includes(el)) continue;
        const now = m.attributeName === 'class' ? el.getAttribute('class') : el.getAttribute('style');
        changes.push({ el, attr: m.attributeName, from: m.oldValue, to: now, y: stepY, ratio: ratioOf(el), prevRatio: lastRatio.get(el) ?? 0, at: performance.now() });
      }
    });
    mo.observe(document.body, { attributes: true, attributeOldValue: true, attributeFilter: ['class', 'style'], subtree: true });
    D.cleanup.push(() => mo.disconnect());

    const maxY = () => Math.max(0, document.documentElement.scrollHeight - innerHeight);
    const stepBig = Math.max(80, round(innerHeight * 0.2));
    const fixedTrack = fixedEls.map(el => ({ el, states: [] }));
    const posTrack = blocks.map(el => ({ el, pts: [] }));
    const seen = new Map(); // element → first y it was ≥ 1% visible
    const lastRatio = new Map(); // element → visible share at the previous step
    const ys = [];
    for (let y = 0; y <= 300; y += 20) ys.push(y);
    for (let y = 300 + stepBig; y < maxY() + stepBig; y += stepBig) ys.push(Math.min(y, maxY()));
    let prevY = 0;
    for (const [i, y] of ys.entries()) {
      scan.check();
      stepY = y;
      await to(y);
      await scan.sleep(i < 16 ? 40 : 110); // IntersectionObserver callbacks + class changes
      for (const t of fixedTrack) t.states.push({ y, ...look(t.el) });
      for (const p of posTrack) { const r = p.el.getBoundingClientRect(); if (r.bottom > -200 && r.top < innerHeight + 200) p.pts.push({ y, d: r.top + scrollY }); }
      for (const n of nodes.slice(0, 1500)) { const r = ratioOf(n.el); if (!seen.has(n.el) && r > 0.01) seen.set(n.el, y); }
      for (const n of nodes.slice(0, 1500)) lastRatio.set(n.el, ratioOf(n.el));
      prevY = y;
      if (i % 4 === 0) scan.progress(i / ys.length);
      if (y >= maxY()) break;
    }
    await scan.sleep(700); // reveals that were still animating
    mo.disconnect();

    // ——— sticky / fixed elements that change: exact threshold by bisection ———
    const fixedChanges = [];
    for (const t of fixedTrack) {
      const k = t.states.findIndex((s, i) => i > 0 && differs(t.states[i - 1], s));
      if (k < 0) continue;
      const a = t.states[k - 1], b = t.states[k];
      let lo = a.y, hi = b.y;
      const base = look(t.el); // (we're at the bottom now: the "after" look)
      while (hi - lo > 1) { const mid = round((lo + hi) / 2); await to(mid); await scan.sleep(30); if (differs(a, look(t.el))) hi = mid; else lo = mid; }
      await to(hi); await scan.sleep(450); // let its transition finish
      const after = look(t.el);
      const tr = Mochi.deepStates.transitionsOf(getComputedStyle(t.el));
      const diff = {};
      for (const p of WATCH) if (a[p] !== after[p]) diff[p] = { from: a[p], to: after[p] };
      if (Math.abs(a.h - after.h) > 1) diff.height = { from: `${a.h}px`, to: `${after.h}px` };
      const added = after.cls.split(' ').filter(c => c && !a.cls.split(' ').includes(c));
      fixedChanges.push({ target: selOf(t.el), position: getComputedStyle(t.el).position, threshold: hi, addsClass: added, changes: diff, transitions: tr });
      void base;
    }

    // ——— reveal on scroll: class/style changes on elements that entered the viewport ———
    const groups = new Map();
    for (const c of changes) {
      if (fixedEls.some(f => f === c.el || f.contains(c.el))) continue;
      if (c.attr === 'class') {
        const before = (c.from || '').split(/\s+/), after = (c.to || '').split(/\s+/);
        const added = after.filter(x => x && !before.includes(x));
        if (!added.length) continue;
        const key = `${c.el.parentElement ? selOf(c.el.parentElement) : ''} > ${selOf(c.el)}|${added.join('.')}`;
        if (!groups.has(key)) groups.set(key, { target: selOf(c.el), parent: c.el.parentElement ? selOf(c.el.parentElement) : null, addsClass: added, items: [] });
        groups.get(key).items.push(c);
      }
    }
    const reveals = [];
    for (const g of groups.values()) {
      // The visible share when the class came: between the share at the previous step and at this one.
      // Between the share at the previous step (not yet) and the share when it happened.
      const intervals = g.items.map(c => [c.prevRatio, c.ratio]);
      const lo = Math.max(...intervals.map(i => i[0])), hi = Math.min(...intervals.map(i => i[1]));
      const threshold = hi >= lo ? Math.round(((lo + hi) / 2) * 100) / 100 : Math.round(intervals[0][1] * 100) / 100;
      const delays = g.items.map(c => { const cs = getComputedStyle(c.el); return Math.max(...[cs.animationDelay, cs.transitionDelay].flatMap(v => v.split(',')).map(v => parseFloat(v) * (v.trim().endsWith('ms') ? 1 : 1000))); });
      const distinct = [...new Set(delays.filter(d => d >= 0))].sort((a, b) => a - b);
      const stagger = distinct.length > 1 ? Math.round(distinct[1] - distinct[0]) : 0;
      const el = g.items[0].el;
      const cs = getComputedStyle(el);
      const anim = (scan.startedAnimations || []).find(a => a.target === g.target);
      reveals.push({
        target: g.target, parent: g.parent, count: g.items.length, addsClass: g.addsClass,
        threshold, thresholdRange: [Math.round(lo * 100) / 100, Math.round(hi * 100) / 100],
        stagger, delays: distinct.slice(0, 6),
        how: anim ? { animation: anim.name, duration: anim.duration, easing: anim.easing, keyframes: anim.keyframes } : { transition: Mochi.deepStates.transitionsOf(cs) },
        firstAt: Math.min(...g.items.map(c => c.y)),
      });
    }
    // A reveal happens as something comes into view; class changes at 0% visible (slideshow timers…) aren't reveals.
    for (let i = reveals.length - 1; i >= 0; i--) if (reveals[i].thresholdRange[1] < 0.01 || reveals[i].threshold < 0.005) reveals.splice(i, 1);
    reveals.sort((a, b) => a.firstAt - b.firstAt);

    // ——— parallax: blocks whose page position changes with scroll ———
    const parallax = [];
    const changedEls = new Set(changes.filter(c => c.attr === 'class').map(c => c.el)); // reveals (a style change is how parallax itself works)
    for (const p of posTrack) {
      if (p.pts.length < 3) continue;
      if (fixedEls.some(f => f.contains(p.el)) || changedEls.has(p.el) || [...changedEls].some(c => c.contains(p.el))) continue;
      const dys = p.pts.slice(1).map((q, i) => ({ ds: q.y - p.pts[i].y, dd: q.d - p.pts[i].d })).filter(x => x.ds > 0);
      const moved = dys.reduce((a, x) => a + Math.abs(x.dd), 0);
      if (moved < 8) continue;
      const ratio = dys.reduce((a, x) => a + x.dd, 0) / dys.reduce((a, x) => a + x.ds, 0); // how much its page position moves per px of scroll
      const speed = Math.round((1 - ratio) * 100) / 100; // 1 = scrolls normally, 0.5 = half speed
      if (Math.abs(speed - 1) < 0.05 || p.el.querySelector('*') && parallax.some(x => x.el.contains(p.el))) continue;
      parallax.push({ el: p.el, target: selOf(p.el), speed, text: `moves at ${Math.round(speed * 100)}% of the scroll speed` });
    }
    // Things that move on their own (a looping float) aren't parallax: they move without scrolling too.
    for (const x of [...parallax]) {
      const ys2 = [docY(x.el)];
      for (let k = 0; k < 3; k++) { await scan.sleep(230); ys2.push(docY(x.el)); } // over ~0.7 s (a slow loop barely moves at its peak)
      if (Math.max(...ys2) - Math.min(...ys2) > 1) parallax.splice(parallax.indexOf(x), 1);
    }
    const topParallax = parallax.filter(x => !parallax.some(o => o !== x && o.el.contains(x.el) && Math.abs(o.speed - x.speed) < 0.05)).map(({ el, ...x }) => x).slice(0, 8);

    // ——— the rest: snap, smooth, scroll-driven CSS, lazy content, progress bars ———
    const rootCs = getComputedStyle(document.documentElement);
    const snap = nodes.filter(n => n.style.scrollSnapType && n.style.scrollSnapType !== 'none').map(n => ({ target: selOf(n.el), type: n.style.scrollSnapType, align: getComputedStyle(n.el.firstElementChild || n.el).scrollSnapAlign }));
    if (rootCs.scrollSnapType !== 'none') snap.unshift({ target: 'html (page)', type: rootCs.scrollSnapType });
    const timelines = nodes.filter(n => { const t = getComputedStyle(n.el).animationTimeline; return t && t !== 'auto' && t !== 'none'; }).map(n => ({ target: selOf(n.el), timeline: getComputedStyle(n.el).animationTimeline, animation: getComputedStyle(n.el).animationName })).slice(0, 10);
    const grew = document.documentElement.scrollHeight - startHeight;
    const added = document.body.getElementsByTagName('*').length - startCount;
    const lazyImgs = [...document.images].filter(i => i.loading === 'lazy').length;
    const progress = fixedTrack.filter(t => { const w = t.states.map(s => s.transform); return new Set(w).size > 3 && t.el.getBoundingClientRect().height < 12; }).map(t => selOf(t.el));
    // "Back to top": a small fixed element that becomes visible after some scrolling.
    const backToTop = fixedChanges.filter(f => { const el = fixedEls.find(e => selOf(e) === f.target); const r = el?.getBoundingClientRect(); return r && r.width < 140 && r.height < 140 && ((f.changes.opacity && parseFloat(f.changes.opacity.to) > parseFloat(f.changes.opacity.from)) || f.changes.visibility?.to === 'visible' || (f.changes.display && f.changes.display.from === 'none')); }).map(f => ({ target: f.target, appearsAfter: f.threshold }));

    await to(0);
    await scan.sleep(300);

    scan.spec.scroll = {
      pageHeight: startHeight, viewport: innerHeight, steps: ys.length,
      smooth: rootCs.scrollBehavior === 'smooth', snap, scrollDrivenAnimations: timelines,
      stickyAndFixed: fixedChanges, reveals, parallax: topParallax, progressBars: progress, backToTop,
      lazy: { imagesWithLoadingLazy: lazyImgs, pageGrewBy: grew, elementsAdded: added, infinite: grew > innerHeight },
    };
    scan.spec.scroll.timeline = timelineText(scan.spec.scroll);
  }

  function timelineText(s) {
    const lines = [];
    for (const f of s.stickyAndFixed) {
      const bits = Object.entries(f.changes).filter(([k]) => k !== 'cls').map(([k, v]) => `${k.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)} ${v.from} → ${v.to}`);
      const tr = f.transitions.length ? ` (${f.transitions.map(t => `${t.property} ${t.duration}ms ${t.easing}`).join(', ')})` : '';
      lines.push(`${f.threshold}px: ${f.target}${f.addsClass.length ? ` gets .${f.addsClass.join('.')}` : ''} — ${bits.join(', ')}${tr}`);
    }
    for (const r of s.reveals) {
      const how = r.how.animation ? `${r.how.animation} ${r.how.duration}ms ${r.how.easing}` : r.how.transition?.map(t => `${t.property} ${t.duration}ms ${t.easing}`).join(', ');
      lines.push(`from ~${r.firstAt}px: ${r.target} ×${r.count} reveal (adds .${r.addsClass.join('.')}) when ~${Math.round(r.threshold * 100)}% visible${how ? `: ${how}` : ''}${r.stagger ? `, stagger ${r.stagger}ms` : ''}`);
    }
    for (const p of s.parallax) lines.push(`parallax: ${p.target} ${p.text}`);
    for (const b of s.backToTop) lines.push(`after ${b.appearsAfter}px: ${b.target} appears`);
    if (s.snap.length) lines.push(`scroll-snap: ${s.snap.map(x => `${x.target} (${x.type}${x.align ? `, align ${x.align}` : ''})`).join('; ')}`);
    if (s.smooth) lines.push('smooth scrolling for in-page links (scroll-behavior: smooth)');
    if (s.scrollDrivenAnimations.length) lines.push(`scroll-driven CSS animations: ${s.scrollDrivenAnimations.map(x => `${x.target} (${x.timeline})`).join('; ')}`);
    if (s.lazy.infinite) lines.push(`more content loads while scrolling (page grew by ${s.lazy.pageGrewBy}px)`);
    return lines.sort((a, b) => (parseInt(a.match(/(\d+)px/)?.[1] || 9e9, 10)) - (parseInt(b.match(/(\d+)px/)?.[1] || 9e9, 10)));
  }

  Mochi.deepScroll = { timelineText };
  D.addPhase({ id: 'scroll', order: 35, cdp: false, label: 'deep.step.scroll', budget: 35000, weight: 2, run });
})();
