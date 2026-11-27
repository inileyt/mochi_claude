/*
 * Mochi — Deep Scan: text and colour animations. Numbers that count up ("10,000+ users"), text that types
 * itself out, and backgrounds/colours that drift or cycle — effects that don't move or transform an element,
 * so the motion scan misses them. This phase watches the live page for ~2s and reads them off: a counter's
 * start/end and format, a typewriter's final text and speed, and a colour/gradient that animates. Each result
 * is tagged evidence: 'measured'.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const D = Mochi.deepScan;
  const frame = () => new Promise(r => requestAnimationFrame(t => r(t)));
  const selOf = el => Mochi.deepStructure.sel({ tag: el.tagName.toLowerCase(), id: el.id || null, cls: [...el.classList].filter(c => !/^(is-|has-|active|open|show)/.test(c)).slice(0, 2) });
  const text = el => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  /** The first number in a string, plus the non-digit bits around it (prefix/suffix like $, %, +, K). */
  function num(s) {
    const m = s.match(/^(\D*?)(-?[\d][\d,.\s]*)(\D*)$/);
    if (!m) return null;
    const v = parseFloat(m[2].replace(/[,\s]/g, ''));
    return Number.isFinite(v) ? { v, prefix: m[1].trim(), suffix: m[3].trim() } : null;
  }

  async function run(scan) {
    const nodes = (scan.nodes || []).filter(n => n.el.isConnected && !n.hidden);
    const inView = el => { const r = el.getBoundingClientRect(); return r.bottom > -40 && r.top < innerHeight + 40 && r.width > 2; };
    // Text candidates: short-text leaves, preferring counter/typewriter-ish hints.
    const textEls = [];
    for (const n of nodes) {
      const el = n.el;
      if (scan.ignore.contains(el) || !inView(el) || el.children.length > 2) continue;
      const t = text(el);
      const hinted = /count|number|stat|odometer|tick|type|typed|typewriter/i.test(el.className || '') || el.hasAttribute('data-count') || el.hasAttribute('data-target');
      if (t && t.length <= 60 && (hinted || num(t) || /^[\s\S]{0,2}$/.test(t))) textEls.push(el);
      if (textEls.length >= 70) break;
    }
    // Colour candidates: things whose background/text colour transitions or animates.
    const colEls = nodes.filter(n => {
      if (scan.ignore.contains(n.el) || !inView(n.el)) return false;
      const cs = getComputedStyle(n.el);
      return cs.animationName !== 'none' || /background|color/.test(cs.transitionProperty) || cs.transitionProperty === 'all' || /gradient/.test(cs.backgroundImage);
    }).map(n => n.el).slice(0, 50);

    const tSeries = textEls.map(el => ({ el, v: [] }));
    const cSeries = colEls.map(el => ({ el, v: [] }));
    const snap = () => {
      for (const s of tSeries) s.v.push(text(s.el));
      for (const s of cSeries) { const cs = getComputedStyle(s.el); s.v.push({ bg: cs.backgroundColor, img: cs.backgroundImage, fg: cs.color }); }
    };
    const t0 = performance.now();
    snap();
    while (performance.now() - t0 < 2200) { await frame(); await scan.sleep(110); snap(); scan.check(); }

    // ——— counters & typewriters ———
    const counters = [], typers = [];
    for (const s of tSeries) {
      const seq = s.v;
      if (new Set(seq).size < 3) continue; // it didn't change
      const nums = seq.map(num);
      if (nums.filter(Boolean).length >= seq.length - 1 && nums[0] && nums.at(-1)) {
        const vals = nums.filter(Boolean).map(n => n.v);
        const up = vals.every((v, i) => i === 0 || v >= vals[i - 1] - 1e-6), down = vals.every((v, i) => i === 0 || v <= vals[i - 1] + 1e-6);
        if ((up || down) && Math.abs(vals.at(-1) - vals[0]) > 0) {
          const last = nums.filter(Boolean).at(-1);
          counters.push({ target: selOf(s.el), kind: 'counter', from: vals[0], to: last.v, prefix: last.prefix || '', suffix: last.suffix || '', evidence: 'measured',
            text: `counts ${up ? 'up' : 'down'} ${last.prefix}${vals[0]} → ${last.prefix}${last.v}${last.suffix} on view` });
          continue;
        }
      }
      // typewriter: each sample is a prefix of the final text and the length grows
      const final = seq.at(-1), grows = seq.every((x, i) => i === 0 || x.length >= seq[i - 1].length);
      if (grows && final.length > 3 && seq[0].length < final.length && seq.slice(0, -1).every(x => final.startsWith(x))) {
        typers.push({ target: selOf(s.el), kind: 'typewriter', finalText: final.length <= 40 ? final : `${final.length} chars`, evidence: 'measured', text: `types out "${final.slice(0, 40)}"${final.length > 40 ? '…' : ''}` });
      }
    }

    // ——— colour / gradient animation ———
    const parse = c => Mochi.color?.parseColor?.(c);
    const far = (a, b) => { const x = parse(a), y = parse(b); return x && y ? Math.abs(x.r - y.r) + Math.abs(x.g - y.g) + Math.abs(x.b - y.b) + Math.abs((x.a ?? 1) - (y.a ?? 1)) * 255 : a !== b ? 60 : 0; };
    const colors = [];
    for (const s of cSeries) {
      for (const [prop, key] of [['background', 'bg'], ['text colour', 'fg'], ['gradient', 'img']]) {
        const vs = s.v.map(x => x[key]);
        const uniq = [...new Set(vs)];
        if (uniq.length < 2) continue;
        if (key === 'img') { if (!/gradient/.test(vs[0]) && !/gradient/.test(vs.at(-1))) continue; }
        else if (Math.max(...vs.map(v => far(vs[0], v))) < 24) continue; // ignore sub-threshold noise
        const cycles = far(vs[0], vs.at(-1)) < (key === 'img' ? 1 : 16);
        colors.push({ target: selOf(s.el), property: prop, from: vs[0], to: uniq.find(v => v !== vs[0]) || vs.at(-1), loops: cycles, evidence: 'measured',
          text: `${prop} animates${cycles ? ' (loops)' : ` ${vs[0]} → ${vs.at(-1)}`}` });
        break; // one property per element
      }
      if (colors.length >= 12) break;
    }

    scan.spec.textFx = {
      counters: counters.slice(0, 16), typewriters: typers.slice(0, 8), colorAnimations: colors,
      note: (counters.length || typers.length || colors.length)
        ? 'Measured over ~2s on load: animate counters to these end values, type the text out, and animate the colours/gradients.'
        : 'No counting, typing or colour animation was measured in the first couple of seconds.',
    };
  }

  Mochi.deepTextFx = { num };
  D.addPhase({ id: 'textfx', order: 64, cdp: false, label: 'deep.step.textfx', budget: 8000, weight: 0.6, run });
})();
