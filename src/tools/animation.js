/*
 * Mochi — Scan animation (loaded the first time it's used; Menu → Tools). Pick an element and Mochi
 * watches it for a couple of seconds: a CSS animation keeps its authored @keyframes and timing; an
 * element moved by JavaScript (rAF, GSAP, Framer Motion…) is sampled frame by frame and rebuilt as an
 * approximate @keyframes. You get a live preview, the CSS, and a prompt to have Claude recreate it.
 * Nothing leaves your browser; nothing on the page is changed (Mochi reads styles only).
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const T = (k, v) => Mochi.t(k, v);
  const A = () => Mochi.animCore;

  /** A short, stable-ish selector for the picked element. */
  function selectorFor(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const cls = [...el.classList].filter(c => !/^(is-|has-|active|open|show|hover|focus)/.test(c)).slice(0, 2).map(c => `.${CSS.escape(c)}`).join('');
    return `${el.tagName.toLowerCase()}${cls}`;
  }

  /** translate / scale / rotate out of a computed transform. */
  function matrixOf(cs) {
    const t = cs.transform;
    if (!t || t === 'none') return { tx: 0, ty: 0, scale: 1, rot: 0 };
    const m = t.match(/matrix(3d)?\(([^)]+)\)/);
    if (!m) return { tx: 0, ty: 0, scale: 1, rot: 0 };
    const v = m[2].split(',').map(Number);
    if (m[1]) return { tx: v[12], ty: v[13], scale: Math.hypot(v[0], v[1]), rot: Math.atan2(v[1], v[0]) * 180 / Math.PI };
    return { tx: v[4], ty: v[5], scale: Math.hypot(v[0], v[1]), rot: Math.atan2(v[1], v[0]) * 180 / Math.PI };
  }

  /** The authored @keyframes text for a name (from the page's own stylesheets; cross-origin ones are skipped). */
  function keyframesText(name) {
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch (_) { continue; }
      for (const r of rules || []) { if (r.type === 7 && r.name === name) return r.cssText; }
    }
    return null;
  }

  function sample(el, ms = 2500) {
    return new Promise(resolve => {
      const out = []; const start = performance.now();
      const frame = now => {
        const cs = getComputedStyle(el), m = matrixOf(cs);
        out.push({ t: now - start, tx: m.tx, ty: m.ty, scale: m.scale, rot: m.rot, opacity: Number(cs.opacity) || 1 });
        if (now - start < ms) requestAnimationFrame(frame); else resolve(out);
      };
      requestAnimationFrame(frame);
    });
  }

  const first = v => String(v || '').split(',')[0].trim();

  async function capture(el, onSampling) {
    const cs = getComputedStyle(el);
    const selector = selectorFor(el);
    const host = location.hostname || 'local';
    const animName = cs.animationName && cs.animationName !== 'none' ? first(cs.animationName) : null;
    if (animName) {
      const kf = keyframesText(animName);
      const shorthand = `${selector} {\n  animation: ${animName} ${first(cs.animationDuration)} ${first(cs.animationTimingFunction)} ${first(cs.animationDelay)} ${first(cs.animationIterationCount)} ${first(cs.animationDirection)} ${first(cs.animationFillMode)};\n}`;
      const iters = first(cs.animationIterationCount);
      return { kind: 'css', selector, host, name: animName, duration: parseFloat(cs.animationDuration) || 0, timing: first(cs.animationTimingFunction), iterations: iters === 'infinite' ? 'infinite' : Number(iters), css: [kf, shorthand].filter(Boolean).join('\n\n'), play: { name: animName, keyframes: kf, shorthand: `${animName} ${first(cs.animationDuration)} ${first(cs.animationTimingFunction)} ${first(cs.animationDelay)} ${first(cs.animationIterationCount)} ${first(cs.animationDirection)} ${first(cs.animationFillMode)}` } };
    }
    onSampling?.();
    const r = A().reconstruct(await sample(el));
    if (r) return { kind: 'js', selector, host, name: r.name, duration: r.duration, moving: r.moving, css: `${r.css}\n\n${selector} {\n  ${r.shorthand}\n}`, play: { name: r.name, keyframes: r.css, shorthand: `${r.name} ${r.duration}s ease-in-out infinite` } };
    if (cs.transitionDuration && cs.transitionDuration !== '0s') {
      const tr = `${first(cs.transitionProperty) || 'all'} ${first(cs.transitionDuration)} ${first(cs.transitionTimingFunction)}`;
      return { kind: 'transition', selector, host, transitions: [tr], css: `${selector} {\n  transition: ${tr};\n}` };
    }
    return { kind: 'none', selector, host, css: '' };
  }

  async function open(ctx, opts = {}) {
    const { companion, panel } = ctx;
    const { h, copyText, downloadText } = Mochi.ui;
    Mochi.menuInstance?.close();
    if (panel.isOpen) panel.close();
    let el = opts.el || null;
    if (!el) {
      const picker = new Mochi.Picker(companion);
      if (picker.hint?.firstChild) picker.hint.firstChild.textContent = T('anim.title');
      companion.say(T('anim.pickHint'), 2400);
      el = await picker.pick();
      if (!el) { ctx.engine.pickCancel?.(); return null; }
    }
    companion.setMood('curious'); companion.say(T('anim.watching'), 2000);
    const info = await capture(el, () => companion.say(T('anim.watching'), 2600));
    Mochi.animScan.last = info;

    const found = info.kind !== 'none';
    const body = h('div', { class: 'anim' });
    if (found && info.play) {
      // A live preview that plays the captured animation (its own scoped @keyframes).
      const style = h('style', {});
      style.textContent = `${info.play.keyframes || ''}\n.anim-dot{animation:${info.play.shorthand};}`;
      body.append(h('div', { class: 'anim-preview' }, style, h('div', { class: 'anim-dot' })));
    }
    body.append(h('p', { class: 'note', text: A().describe(info) }));
    if (found) {
      const box = h('textarea', { class: 'export anim-css', readonly: true, spellcheck: 'false', 'aria-label': 'CSS' });
      box.value = info.css;
      body.append(h('section', { class: 'blk' }, h('h4', { text: 'CSS' }), box));
    }
    const footer = h('div', { class: 'row' },
      h('button', { class: 'px-btn', type: 'button', 'data-act': 'anim-again', onclick: () => open(ctx) }, `⌖ ${T('panel.pickAnother')}`));
    if (found) {
      footer.prepend(
        h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'anim-copy', onclick: async () => { await copyText(info.css, companion.shadow); ctx.actions.copied('CSS'); } }, `⧉ ${T('panel.copy')}`),
        h('button', { class: 'px-btn', type: 'button', 'data-act': 'anim-download', onclick: () => { downloadText('animation.css', info.css, companion.shadow, 'text/css'); ctx.actions.downloaded('animation.css'); } }, '⤓ .css'),
        ctx.isClaude
          ? h('button', { class: 'px-btn', type: 'button', 'data-act': 'anim-paste', onclick: async () => { panel.close(); ctx.engine.pasted(await Mochi.insertIntoComposer(A().prompt(info))); } }, `✎ ${T('panel.pasteToClaude')}`)
          : h('button', { class: 'px-btn', type: 'button', 'data-act': 'anim-ai', onclick: async () => { await copyText(A().prompt(info), companion.shadow); ctx.actions.copied(T('anim.forClaude')); } }, `⧉ ${T('anim.forClaude')}`));
    }
    panel.open(T('anim.title'), info.selector, body, footer);
    panel.view = 'anim';
    companion.play(found ? 'hop' : 'wiggle');
    companion.say(found ? T('anim.done', { kind: T(`anim.kind.${info.kind}`) }) : T('anim.none'), 2800);
    return info;
  }

  Mochi.animScan = Object.assign(Mochi.animScan || {}, { open, capture, selectorFor });
  Mochi.toolImpl.anim = { open, close: () => {}, get isOpen() { return false; } };
})();
