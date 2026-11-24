/*
 * Mochi — Scan animation: the pure part (no DOM, Node-testable).
 *  - reconstruct(samples): turn per-frame samples of a moving element (transform + opacity, sampled by
 *    src/tools/animation.js) into an approximate @keyframes, for animation driven by JavaScript.
 *  - describe / prompt: a plain-words summary and a prompt asking Claude to recreate it.
 * CSS animations keep their authored @keyframes (read in the tool); only JS motion is reconstructed.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const round = (v, d = 0) => { const p = 10 ** d; return Math.round((v || 0) * p) / p; };

  /**
   * samples: [{ t, tx, ty, scale, rot, opacity }], t in ms. → { name, css, shorthand, duration, moving } | null.
   * Only the properties that actually change are written; ~6 keyframe stops are kept.
   */
  function reconstruct(samples, { name = 'mochi-move', stops = 6 } = {}) {
    if (!Array.isArray(samples) || samples.length < 4) return null;
    const t0 = samples[0].t;
    const span = samples[samples.length - 1].t - t0 || 1;
    const range = key => { const vs = samples.map(s => s[key] ?? 0); return Math.max(...vs) - Math.min(...vs); };
    const EPS = { tx: 1, ty: 1, scale: 0.02, rot: 1, opacity: 0.03 };
    const moving = ['tx', 'ty', 'scale', 'rot', 'opacity'].filter(k => range(k) > EPS[k]);
    if (!moving.length) return null;
    const nearest = want => samples.reduce((a, b) => (Math.abs(b.t - want) < Math.abs(a.t - want) ? b : a));
    const lines = [];
    for (let i = 0; i <= stops; i++) {
      const s = nearest(t0 + (span * i) / stops);
      const tr = [];
      if (moving.includes('tx') || moving.includes('ty')) tr.push(`translate(${round(s.tx)}px, ${round(s.ty)}px)`);
      if (moving.includes('scale')) tr.push(`scale(${round(s.scale, 3)})`);
      if (moving.includes('rot')) tr.push(`rotate(${round(s.rot, 1)}deg)`);
      const decl = [];
      if (tr.length) decl.push(`transform: ${tr.join(' ')}`);
      if (moving.includes('opacity')) decl.push(`opacity: ${round(s.opacity, 2)}`);
      lines.push(`  ${Math.round((i / stops) * 100)}% { ${decl.join('; ')}; }`);
    }
    const duration = round(span / 1000, 1) || 1;
    return {
      name, moving, duration,
      css: `@keyframes ${name} {\n${lines.join('\n')}\n}`,
      shorthand: `animation: ${name} ${duration}s ease-in-out infinite;`,
    };
  }

  const WORDS = { tx: 'moves horizontally', ty: 'moves vertically', scale: 'scales', rot: 'rotates', opacity: 'fades' };
  /** A plain-words line, from either a reconstructed result or a CSS-animation info object. */
  function describe(info) {
    if (!info) return 'No animation found on this element.';
    if (info.kind === 'css') {
      const bits = [`a CSS animation \`${info.name}\``, info.duration ? `${info.duration}s` : null, info.timing || null, info.iterations === 'infinite' || info.iterations > 1e6 ? 'looping' : (info.iterations > 1 ? `${info.iterations}×` : null)].filter(Boolean);
      return `This element runs ${bits.join(', ')}.`;
    }
    if (info.kind === 'transition') return `This element has CSS transitions: ${(info.transitions || []).join(', ')}.`;
    if (info.moving) return `This element ${info.moving.map(m => WORDS[m]).join(', ')} (reconstructed as a ~${info.duration}s loop).`;
    return 'No animation found on this element.';
  }

  /** A prompt asking Claude to recreate the animation. */
  function prompt(info) {
    const lines = [
      `Recreate this animation from ${info.host || 'a web page'} on \`${info.selector || 'the element'}\`.`,
      '',
      describe(info),
      '',
      '```css',
      info.css || '/* no CSS captured */',
      '```',
      '',
      info.kind === 'js' ? 'This was reconstructed by sampling the element frame by frame, so treat the keyframes as approximate — match the overall motion, timing and easing.' : 'Keep the timing and easing exact.',
      'Turn the animation off under `@media (prefers-reduced-motion: reduce)`.',
    ];
    return lines.filter(l => l !== null).join('\n');
  }

  Mochi.animCore = { reconstruct, describe, prompt, round };
  if (typeof module !== 'undefined') module.exports = Mochi.animCore;
})();
