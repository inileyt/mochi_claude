/*
 * Mochi — Scan the hero (loaded the first time it's used; Menu → Tools → Scanners). Mochi finds the big
 * section at the top of a page (or the element you pick) and reads the lovely bits that make it move:
 *   - CSS @keyframes animations on its parts (kept exactly),
 *   - scroll / entrance reveals (elements that fade or slide in), rebuilt as a reusable reveal animation
 *     plus a tiny IntersectionObserver snippet — approximate, since those are usually driven by JavaScript,
 *   - a <canvas> drawn in code, and whether it's a 3D / WebGL scene (Three.js and friends), with a still
 *     frame and a prompt to recreate it on a canvas.
 * You get the CSS to reuse and a prompt for Claude. Nothing is downloaded; the page isn't changed.
 *
 *   Mochi.heroScan.buildCss(info) / .prompt(info)   — pure, from a plain info object (Node-testable)
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const T = (k, v) => Mochi.t(k, v);
  const first = v => String(v || '').split(',')[0].trim();

  function selectorFor(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const cls = [...el.classList].filter(c => !/^(is-|has-|active|open|show|in-view|visible|aos-)/.test(c)).slice(0, 2).map(c => `.${CSS.escape(c)}`).join('');
    return `${el.tagName.toLowerCase()}${cls}`;
  }
  /** A <canvas> that renders with WebGL refuses a 2D context (returns null); a 2D or unused one gives one. */
  function is3D(c) { try { return c.getContext('2d') === null; } catch (_) { return true; } }
  function keyframesText(name) {
    for (const sheet of document.styleSheets) { let rules; try { rules = sheet.cssRules; } catch (_) { continue; } for (const r of rules || []) if (r.type === 7 && r.name === name) return r.cssText; }
    return null;
  }

  // ——— deep capture: scroll a reveal into view and record its real motion ———
  const wait = ms => new Promise(r => setTimeout(r, ms));
  function matrixOf(cs) {
    const t = cs.transform; if (!t || t === 'none') return { tx: 0, ty: 0, scale: 1, rot: 0 };
    const m = t.match(/matrix(3d)?\(([^)]+)\)/); if (!m) return { tx: 0, ty: 0, scale: 1, rot: 0 };
    const v = m[2].split(',').map(Number);
    return m[1] ? { tx: v[12], ty: v[13], scale: Math.hypot(v[0], v[1]), rot: 0 } : { tx: v[4], ty: v[5], scale: Math.hypot(v[0], v[1]), rot: Math.atan2(v[1], v[0]) * 180 / Math.PI };
  }
  function sampleFor(el, ms) {
    return new Promise(resolve => {
      const out = [], start = performance.now();
      const frame = now => { const cs = getComputedStyle(el), m = matrixOf(cs); out.push({ t: now - start, tx: m.tx, ty: m.ty, scale: m.scale, rot: m.rot, opacity: Number(cs.opacity) || 1 }); if (now - start < ms && el.isConnected) requestAnimationFrame(frame); else resolve(out); };
      requestAnimationFrame(frame);
    });
  }
  /** Candidate reveals: things with a transition/animation on opacity or transform, from the hero down. */
  function revealCandidates(hero) {
    const out = [];
    const list = [...document.querySelectorAll('h1, h2, h3, p, img, picture, [class*="card" i], [class*="reveal" i], [class*="fade" i], [data-aos], li, section > div')];
    for (const el of list) {
      if (el.closest('mochi-companion') || el.getBoundingClientRect().width < 8) continue;
      const cs = getComputedStyle(el);
      const tr = parseFloat(String(cs.transitionDuration).split(',')[0]) || 0;
      if (tr > 0.05 && /opacity|transform|all|filter/.test(cs.transitionProperty)) out.push(el);
      else if (cs.animationName && cs.animationName !== 'none' && !/infinite/.test(cs.animationIterationCount)) out.push(el);
    }
    return out.slice(0, 10);
  }
  /** Scroll each candidate in while sampling; rebuild the real reveal as @keyframes (approximate but captured). */
  async function deepReveals(hero, onProgress) {
    const A = Mochi.animCore;
    const cands = revealCandidates(hero);
    const prev = scrollY, captured = [], seen = new Set();
    let i = 0;
    for (const el of cands) {
      onProgress?.(++i / cands.length);
      if (!el.isConnected) continue;
      // park the element JUST below the fold (not visible, so its reveal hasn't fired), then scroll it in
      const elTop = el.getBoundingClientRect().top + scrollY;
      window.scrollTo(0, Math.max(0, elTop - innerHeight - 40));
      await wait(170);
      const samples = sampleFor(el, 1100);
      window.scrollTo(0, Math.max(0, elTop - innerHeight * 0.45));
      const rec = A.reconstruct(await samples, { name: 'mochi-reveal' });
      if (rec && rec.moving.some(m => ['ty', 'tx', 'opacity', 'scale'].includes(m))) {
        const name = `reveal-${captured.length + 1}`;
        const css = rec.css.replace(/mochi-reveal/g, name);
        const sig = rec.moving.sort().join('+');
        captured.push({ selector: selectorFor(el), name, css, shorthand: `${name} ${rec.duration}s ease-out both`, moving: rec.moving, duration: rec.duration, repeat: seen.has(sig) });
        seen.add(sig);
      }
    }
    try { window.scrollTo(0, prev); } catch (_) {}
    return captured;
  }

  /** Pick the big section at the top of the page. */
  function findHero() {
    const vh = innerHeight || 800;
    const sels = ['[class*="hero" i]', '[id*="hero" i]', '[data-hero]', 'header', 'main > section:first-of-type', 'main > div:first-child', 'section:first-of-type', 'body > div:first-child'];
    let best = null, bestScore = -1;
    for (const s of sels) {
      let el; try { el = document.querySelector(s); } catch (_) { continue; }
      if (!el || el.closest('mochi-companion')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < innerWidth * 0.5 || r.height < 60) continue;
      const score = Math.min(2, r.height / vh) - Math.max(0, r.top) / vh;
      if (score > bestScore) { bestScore = score; best = el; }
    }
    return best || document.querySelector('header, main, section') || document.body;
  }

  function gather(hero) {
    const anims = [], reveals = [], canvases = [];
    const seenReveal = new Set(), seenAnim = new Set();
    const list = [hero, ...hero.querySelectorAll('h1, h2, h3, p, img, picture, svg, canvas, video, a, button, [class*="btn" i], [class*="card" i], li')].slice(0, 120);
    for (const el of list) {
      if (el.closest('mochi-companion')) continue;
      if (el.tagName === 'CANVAS') {
        let snapshot = null; try { snapshot = el.toDataURL('image/png'); } catch (_) { snapshot = null; }
        canvases.push({ selector: selectorFor(el), webgl: is3D(el), snapshot });
        continue;
      }
      const cs = getComputedStyle(el);
      const name = cs.animationName && cs.animationName !== 'none' ? first(cs.animationName) : null;
      if (name && !seenAnim.has(name)) { seenAnim.add(name); anims.push({ selector: selectorFor(el), name, duration: first(cs.animationDuration), timing: first(cs.animationTimingFunction), iterations: first(cs.animationIterationCount), keyframes: keyframesText(name) }); }
      const tp = cs.transitionProperty || '';
      const dur = parseFloat(first(cs.transitionDuration)) || 0;
      if (dur > 0.05 && /opacity|transform|all|filter/.test(tp)) {
        const key = `${first(cs.transitionDuration)}|${first(cs.transitionTimingFunction)}`;
        if (!seenReveal.has(key)) { seenReveal.add(key); reveals.push({ selector: selectorFor(el), duration: first(cs.transitionDuration), timing: first(cs.transitionTimingFunction), delay: first(cs.transitionDelay), props: tp }); }
      }
    }
    const threeD = canvases.some(c => c.webgl);
    const kind = threeD ? 'webgl' : canvases.length ? 'canvas' : anims.length ? 'css' : reveals.length ? 'reveal' : 'static';
    return { selector: selectorFor(hero), host: location.hostname || 'local', kind, threeD, anims, reveals, canvases, counts: { anims: anims.length, reveals: reveals.length, canvases: canvases.length } };
  }

  // ——— pure output ———
  function revealBlock(reveals) {
    if (!reveals.length) return '';
    const d = reveals[0].duration || '0.6s', t = reveals[0].timing || 'ease-out';
    return `/* Scroll / entrance reveal (approximate — the page drove it from JavaScript) */\n@keyframes mochi-reveal {\n  from { opacity: 0; transform: translateY(24px); }\n  to   { opacity: 1; transform: none; }\n}\n.reveal { opacity: 0; }\n.reveal.in { animation: mochi-reveal ${d} ${t} both; }`;
  }
  function buildCss(info) {
    const parts = [];
    for (const a of info.anims || []) { if (a.keyframes) parts.push(a.keyframes); parts.push(`${a.selector} { animation: ${a.name} ${a.duration} ${a.timing}${/infinite/.test(a.iterations) ? ' infinite' : ''}; }`); }
    if (info.realReveals && info.realReveals.length) {
      parts.push('/* Scroll reveals, recorded as they came into view (real motion sampled) */');
      for (const r of info.realReveals) parts.push(`${r.css}\n${r.selector} { animation: ${r.shorthand}; }`);
    } else {
      const rb = revealBlock(info.reveals || []); if (rb) parts.push(rb);
    }
    return parts.join('\n\n');
  }
  const IO_SNIPPET = `// Reveal elements as they scroll into view (add class "reveal" in your HTML):\nconst io = new IntersectionObserver((es) => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.15 });\ndocument.querySelectorAll('.reveal').forEach(el => io.observe(el));`;

  function prompt(info) {
    const lines = [`Recreate the hero section's motion from ${info.host} (\`${info.selector}\`).`, ''];
    if (info.threeD) lines.push("This hero has a 3D / WebGL <canvas> scene (e.g. Three.js). It can't become CSS — recreate it with a WebGL/Three.js scene rendered on a <canvas> in a requestAnimationFrame loop, and pause it under `prefers-reduced-motion: reduce`. A still frame is attached to match the look.", '');
    else if (info.canvases?.length) lines.push("The hero is drawn on a <canvas> in code (Canvas 2D). Recreate it on a <canvas> with a requestAnimationFrame loop; a still frame is attached.", '');
    const bits = [];
    if (info.counts.anims) bits.push(`${info.counts.anims} CSS animation(s)`);
    if (info.counts.reveals) bits.push(`${info.counts.reveals} scroll/entrance reveal(s)`);
    if (info.counts.canvases) bits.push(`${info.counts.canvases} canvas${info.counts.canvases > 1 ? 'es' : ''}`);
    if (bits.length) lines.push(`Found: ${bits.join(', ')}.`, '');
    if (info.realReveals?.length) lines.push(`Recorded ${info.realReveals.length} scroll reveal(s) by sampling their real motion as they came into view.`, '');
    const css = buildCss(info);
    if (css) lines.push('```css', css, '```', '');
    if (info.reveals?.length || info.realReveals?.length) lines.push('Trigger each reveal as its element scrolls into view (add class "in"):', '```js', IO_SNIPPET, '```', '');
    lines.push('Keep CSS animations exact; treat the reveals as approximate (match the feel: timing, distance, stagger). Turn animation off under `@media (prefers-reduced-motion: reduce)`.');
    return lines.filter(l => l !== '').join('\n');
  }

  function describe(info) {
    if (info.threeD) return T('hero.desc.webgl');
    if (info.kind === 'canvas') return T('hero.desc.canvas');
    const b = [];
    if (info.counts.anims) b.push(T('hero.n.anims', { n: info.counts.anims }));
    if (info.counts.reveals) b.push(T('hero.n.reveals', { n: info.counts.reveals }));
    return b.length ? T('hero.desc.some', { bits: b.join(', ') }) : T('hero.desc.none');
  }

  async function open(ctx, opts = {}) {
    const { companion, panel } = ctx;
    const { h, copyText } = Mochi.ui;
    Mochi.menuInstance?.close();
    if (panel.isOpen) panel.close();
    let hero = opts.el || null;
    if (!hero && opts.pick) {
      const picker = new Mochi.Picker(companion);
      if (picker.hint?.firstChild) picker.hint.firstChild.textContent = T('hero.title');
      companion.say(T('hero.pickHint'), 2400);
      hero = await picker.pick();
      if (!hero) { ctx.engine.pickCancel?.(); return null; }
    }
    if (!hero) hero = findHero();
    companion.setMood?.('curious'); companion.say(T('hero.looking'), 2000);
    const info = gather(hero);
    info.css = buildCss(info);
    Mochi.heroScan.last = info;

    const found = info.kind !== 'static';
    const body = h('div', { class: 'anim' });
    const shot = info.canvases.find(c => c.snapshot)?.snapshot;
    if (shot) body.append(h('div', { class: 'anim-preview' }, h('img', { class: 'anim-shot', alt: '', src: shot })));
    const note = h('p', { class: 'note', text: describe(info) });
    body.append(note);
    let box = null;
    if (info.css) { box = h('textarea', { class: 'export anim-css', readonly: true, spellcheck: 'false', 'aria-label': 'CSS' }); box.value = info.css; body.append(h('section', { class: 'blk' }, h('h4', { text: 'CSS' }), box)); }

    const copyBtn = h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'hero-copy', onclick: async () => { await copyText(buildCss(info), companion.shadow); ctx.actions.copied('CSS'); } }, `⧉ ${T('panel.copy')}`);
    const forClaude = ctx.isClaude
      ? h('button', { class: 'px-btn', type: 'button', 'data-act': 'hero-paste', onclick: async () => { panel.close(); ctx.engine.pasted(await Mochi.insertIntoComposer(prompt(info))); } }, `✎ ${T('panel.pasteToClaude')}`)
      : h('button', { class: 'px-btn', type: 'button', 'data-act': 'hero-ai', onclick: async () => { await copyText(prompt(info), companion.shadow); ctx.actions.copied(T('hero.forClaude')); } }, `⧉ ${T('hero.forClaude')}`);
    let recordBtn = null;
    if (info.reveals.length && !info.threeD) {
      recordBtn = h('button', { class: 'px-btn', type: 'button', 'data-act': 'hero-record', onclick: async () => {
        recordBtn.disabled = true; recordBtn.textContent = `… ${T('hero.recording')}`;
        companion.setMood?.('curious'); companion.say(T('hero.recording'), 4000);
        const real = await deepReveals(hero, () => companion.say(T('hero.recording'), 3000));
        if (real.length) { info.realReveals = real; info.css = buildCss(info); if (box) box.value = info.css; note.textContent = T('hero.recorded', { n: real.length }); companion.play('hop'); companion.say(T('hero.recorded', { n: real.length }), 2800); }
        else { companion.say(T('hero.recordNone'), 2800); }
        recordBtn.disabled = false; recordBtn.textContent = `⟲ ${T('hero.record')}`;
      } }, `⟲ ${T('hero.record')}`);
    }
    const footer = h('div', { class: 'row' },
      h('button', { class: 'px-btn', type: 'button', 'data-act': 'hero-pick', onclick: () => open(ctx, { pick: true }) }, `⌖ ${T('hero.pickOne')}`));
    if (recordBtn) footer.prepend(recordBtn);
    if (info.css) footer.prepend(copyBtn);
    if (found) footer.prepend(forClaude);

    panel.open(T('hero.title'), info.selector, body, footer);
    panel.view = 'hero';
    companion.play(found ? 'hop' : 'wiggle');
    companion.say(found ? T('hero.done') : T('hero.none'), 2800);
    return info;
  }

  Mochi.heroScan = Object.assign(Mochi.heroScan || {}, { findHero, gather, is3D, buildCss, prompt, describe, open, deepReveals, revealCandidates, IO_SNIPPET });
  (Mochi.toolImpl = Mochi.toolImpl || {}).hero = { open, close: () => {}, get isOpen() { return false; } };
  if (typeof module !== 'undefined') module.exports = Mochi.heroScan;
})();
