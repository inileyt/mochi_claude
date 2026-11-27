/*
 * Mochi — Deep Scan: the fine details a rebuild usually gets wrong. Three things that don't move but are
 * easy to miss: (1) form fields — their type, placeholder, validation and the options in a <select>, with
 * each field's label; (2) SVG animations — SMIL (<animate>…), CSS animation on SVG parts, and line-drawing
 * (animated stroke-dashoffset); (3) CSS visual effects — filter, blend modes, mask / clip-path and
 * backdrop-filter, which carry a lot of a design's polish. All read straight from the DOM (no CDP).
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const D = Mochi.deepScan;
  const selOf = el => Mochi.deepStructure.sel({ tag: el.tagName.toLowerCase(), id: el.id || null, cls: [...el.classList].filter(c => !/^(is-|has-|active|open|show)/.test(c)).slice(0, 2) });
  const txt = (el, n = 40) => (el?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, n) || null;
  const visible = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };

  /** The label a form field shows: <label for>, a wrapping <label>, aria-label, or the placeholder. */
  function labelOf(el) {
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return txt(l); }
    const wrap = el.closest('label'); if (wrap) return txt(wrap);
    const aria = el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') && txt(document.getElementById(el.getAttribute('aria-labelledby'))));
    return aria || el.getAttribute('placeholder') || null;
  }
  function fieldOf(el) {
    const tag = el.tagName.toLowerCase();
    const f = { tag, label: labelOf(el) };
    if (tag === 'input') f.type = el.getAttribute('type') || 'text';
    if (tag === 'button' || el.type === 'submit' || el.type === 'button') { f.kind = 'button'; f.text = txt(el) || el.value || null; return f; }
    for (const a of ['name', 'placeholder', 'autocomplete', 'inputmode', 'pattern']) { const v = el.getAttribute(a); if (v) f[a] = v.slice(0, 60); }
    for (const a of ['required', 'readonly', 'disabled', 'multiple', 'checked']) if (el.hasAttribute(a)) f[a] = true;
    for (const a of ['min', 'max', 'step', 'minlength', 'maxlength']) { const v = el.getAttribute(a); if (v != null) f[a] = v; }
    if (tag === 'select') f.options = [...el.options].slice(0, 20).map(o => txt(o, 30));
    return f;
  }

  function forms() {
    const out = [];
    for (const form of [...document.querySelectorAll('form')].slice(0, 12)) {
      if (!visible(form)) continue;
      const fields = [...form.querySelectorAll('input, select, textarea, button')].filter(el => el.type !== 'hidden').slice(0, 30).map(fieldOf);
      out.push({ selector: selOf(form), action: form.getAttribute('action') || null, method: (form.getAttribute('method') || 'get').toLowerCase(), fields });
    }
    // Inputs that aren't inside a <form> (search boxes, newsletter signups built with JS).
    const loose = [...document.querySelectorAll('input, select, textarea')].filter(el => el.type !== 'hidden' && !el.closest('form') && visible(el)).slice(0, 20).map(fieldOf);
    if (loose.length) out.push({ selector: '(no <form> element)', action: null, method: null, fields: loose });
    return out;
  }

  function svgAnimations() {
    const out = [];
    for (const svg of [...document.querySelectorAll('svg')].slice(0, 60)) {
      if (!visible(svg)) continue;
      const smil = [...svg.querySelectorAll('animate, animateTransform, animateMotion, set')];
      const cssAnim = [...svg.querySelectorAll('*')].filter(el => getComputedStyle(el).animationName !== 'none').slice(0, 6);
      const lineDraw = [...svg.querySelectorAll('path, line, polyline, rect, circle')].filter(el => {
        const cs = getComputedStyle(el); return cs.strokeDasharray !== 'none' && (cs.animationName !== 'none' || cs.transitionProperty.includes('stroke-dashoffset'));
      });
      if (!smil.length && !cssAnim.length && !lineDraw.length) continue;
      out.push({
        selector: selOf(svg),
        smil: smil.slice(0, 8).map(a => ({ type: a.tagName.toLowerCase(), attr: a.getAttribute('attributeName') || a.getAttribute('type') || null, dur: a.getAttribute('dur') || null, values: (a.getAttribute('values') || `${a.getAttribute('from') || ''}→${a.getAttribute('to') || ''}`).slice(0, 50), repeat: a.getAttribute('repeatCount') || null })),
        cssParts: cssAnim.map(el => ({ selector: selOf(el), animation: getComputedStyle(el).animationName, duration: getComputedStyle(el).animationDuration })),
        lineDraw: lineDraw.length ? lineDraw.slice(0, 4).map(selOf) : undefined,
        note: lineDraw.length ? 'A line-drawing effect (animated stroke-dashoffset).' : smil.length ? 'SMIL animation (<animate> inside the SVG).' : 'CSS animation on SVG parts.',
      });
      if (out.length >= 16) break;
    }
    return out;
  }

  function effects(scan) {
    const DEF = { filter: 'none', mixBlendMode: 'normal', backgroundBlendMode: 'normal', clipPath: 'none', backdropFilter: 'none', webkitBackdropFilter: 'none', maskImage: 'none', webkitMaskImage: 'none' };
    const out = [];
    const nodes = (scan.nodes || []).filter(n => n.el.isConnected && !n.hidden && !scan.ignore.contains(n.el)).slice(0, 2500);
    for (const n of nodes) {
      const cs = getComputedStyle(n.el);
      const e = {};
      if (cs.filter !== DEF.filter) e.filter = cs.filter.slice(0, 80);
      if (cs.backdropFilter !== DEF.backdropFilter && cs.webkitBackdropFilter !== DEF.webkitBackdropFilter) e.backdropFilter = (cs.backdropFilter !== 'none' ? cs.backdropFilter : cs.webkitBackdropFilter).slice(0, 80);
      if (cs.mixBlendMode !== DEF.mixBlendMode) e.mixBlendMode = cs.mixBlendMode;
      if (cs.backgroundBlendMode !== DEF.backgroundBlendMode) e.backgroundBlendMode = cs.backgroundBlendMode;
      if (cs.clipPath !== DEF.clipPath) e.clipPath = cs.clipPath.slice(0, 80);
      const mask = cs.maskImage !== 'none' ? cs.maskImage : cs.webkitMaskImage;
      if (mask && mask !== 'none') e.mask = mask.slice(0, 80);
      if (Object.keys(e).length) { out.push({ selector: selOf(n.el), ...e }); if (out.length >= 30) break; }
    }
    return out;
  }

  async function run(scan) {
    const f = forms(), svg = svgAnimations(), fx = effects(scan);
    scan.spec.details = {
      forms: f, svgAnimations: svg, effects: fx,
      note: 'Fine details a rebuild often misses: form fields (with labels, validation and <select> options), SVG animations (SMIL / CSS / line-drawing) and CSS effects (filter, blend, mask, clip-path, backdrop-filter). Reproduce them exactly.',
    };
  }

  Mochi.deepDetails = { fieldOf, labelOf };
  D.addPhase({ id: 'details', order: 77, cdp: false, label: 'deep.step.details', budget: 6000, weight: 0.4, run });
})();
