/*
 * Mochi — "Pick an element". You point at any part of the page (a button,
 * a card, a nav bar…), Mochi outlines it, and a click takes that element's
 * exact style: its key styles, its hover state, and clean HTML + CSS for the
 * whole piece.
 *
 *   const el = await picker.pick()          // null when cancelled (Esc)
 *   const cmp = Mochi.extractComponent(el)  // the data shape is at the bottom
 *
 * While picking, a clear glass covers the page, so the page never switches to
 * its hover look and no click reaches it (links don't open, buttons don't
 * fire). Keys: ↑ select the parent, ↓ go back down, Enter take it, Esc cancel.
 * A right-click or a click on Mochi cancels too.
 * Everything is read in the page; nothing is sent anywhere.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const { parseColor, hex } = Mochi.color;

  // ——— the picker overlay ———
  // A clear "glass" covers the page while you pick: the page never sees the
  // pointer, so nothing switches to its :hover look (Mochi reads the resting
  // style) and no click reaches it (links don't open, buttons don't fire).
  class Picker {
    constructor(companion) {
      this.c = companion;
      const { h } = Mochi.ui;
      this.catcher = h('div', { class: 'pick-catcher', hidden: true });
      this.box = h('div', { class: 'pick-box', hidden: true });
      this.label = h('div', { class: 'pick-label', hidden: true });
      this.hint = h('div', { class: 'pick-hint', hidden: true },
        h('b', { text: Mochi.t('menu.pick') }), ` · ${Mochi.t('picker.hint')}`);
      companion.shadow.append(this.catcher, this.box, this.label, this.hint);
      this.catcher.addEventListener('pointermove', ev => this.hover(ev.clientX, ev.clientY));
      this.catcher.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        this.hover(ev.clientX, ev.clientY);
        if (this.current) this.finish(this.current);
      });
      this.catcher.addEventListener('contextmenu', ev => { ev.preventDefault(); this.finish(null); });
      this.onKey = this.onKey.bind(this);
      this.onScroll = () => { if (this.lastPoint) this.hover(...this.lastPoint, true); else this.draw(); };
    }

    get isActive() { return !!this.resolve; }

    pick() {
      if (this.isActive) this.finish(null);
      return new Promise(resolve => {
        this.resolve = resolve;
        this.current = null;
        this.trail = [];
        this.lastPoint = null;
        this.layers = [];
        this.layer = 0;
        this.ghosts = this.findGhosts();
        this.catcher.hidden = false;
        this.hint.hidden = false;
        addEventListener('keydown', this.onKey, true);
        addEventListener('scroll', this.onScroll, true);
      });
    }

    finish(result) {
      removeEventListener('keydown', this.onKey, true);
      removeEventListener('scroll', this.onScroll, true);
      this.catcher.hidden = this.box.hidden = this.label.hidden = this.hint.hidden = true;
      const resolve = this.resolve;
      this.resolve = null;
      this.ghosts = null;
      this.layers = [];
      resolve?.(result);
    }

    /**
     * Everything under a point, top first: page elements (looking into open
     * shadow roots), decorations that ignore the mouse (pointer-events: none,
     * like floating blobs and animated backgrounds), never Mochi or its glass.
     * An SVG counts as one picture, and an empty see-through overlay (a link
     * stretched over a card) goes to the back, so the card comes first.
     */
    layersAt(x, y) {
      const own = n => n === this.c.host || n === document.documentElement || n === document.body;
      const deep = el => {
        for (let depth = 0; el?.shadowRoot && depth < 5; depth++) {
          const root = el.shadowRoot;
          const inner = root.elementsFromPoint(x, y).find(n => !own(n) && n !== el && root.contains(n));
          if (!inner) break;
          el = inner;
        }
        return el;
      };
      const hits = document.elementsFromPoint(x, y).filter(n => !own(n));
      const top = hits[0];
      const ghosts = (this.ghosts || []).filter(g => {
        if (!g.isConnected) return false;
        const r = g.getBoundingClientRect();
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false;
        // Painted above the top element? (it comes later in the page, or lives inside it)
        return !top || top.contains(g) || !!(top.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING);
      }).sort((a, b) => area(a) - area(b));
      const seen = new Set();
      const layers = [];
      for (const raw of [...ghosts, ...hits]) {
        const el = outerSvg(deep(raw));
        if (!el || seen.has(el) || own(el)) continue;
        seen.add(el);
        layers.push(el);
      }
      // Empty see-through overlays go last (still reachable with Space).
      const solid = layers.filter(el => !isClearOverlay(el));
      return solid.length ? [...solid, ...layers.filter(el => isClearOverlay(el))] : layers;
    }

    /** Decorations that don't take the mouse (pointer-events: none), found once per pick. */
    findGhosts() {
      const out = [];
      const all = document.body ? document.body.getElementsByTagName('*') : [];
      const limit = Math.min(all.length, 20000);
      const t0 = performance.now();
      for (let i = 0; i < limit && performance.now() - t0 < 120; i++) { // once per pick, so a short wait is fine
        const el = all[i];
        if (el === this.c.host) continue;
        const cs = getComputedStyle(el);
        if (cs.pointerEvents !== 'none' || cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) continue;
        // The top of a pointer-events: none branch only (its children inherit it).
        const up = el.parentElement;
        if (up && up !== document.body && getComputedStyle(up).pointerEvents === 'none') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        if (!paints(el, cs) && !el.querySelector('svg, img, canvas, video, picture')) continue;
        out.push(el);
      }
      return out;
    }

    hover(x, y, force = false) {
      const samePoint = this.lastPoint && Math.abs(this.lastPoint[0] - x) < 1 && Math.abs(this.lastPoint[1] - y) < 1;
      this.lastPoint = [x, y];
      this.layers = this.layersAt(x, y);
      if (!samePoint) this.layer = 0;
      const el = this.layers[this.layer % Math.max(1, this.layers.length)] || null;
      if (!el || (el === this.current && !force)) { this.draw(); return; }
      if (el !== this.current) this.trail = [];
      this.current = el;
      this.draw();
    }

    onKey(ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); this.finish(null); return; }
      if (!this.current) return;
      if (ev.key === 'ArrowUp') {
        const up = this.current.parentElement || this.current.getRootNode()?.host;
        if (up && up !== document.body && up !== document.documentElement) { this.trail.push(this.current); this.current = up; }
      } else if (ev.key === 'ArrowDown') {
        const down = this.trail.pop() || [...this.current.children].find(k => k.getBoundingClientRect().width > 0);
        if (down) this.current = down;
      } else if (ev.key === ' ' || ev.key === 'Spacebar') {
        // The next layer under the pointer (a picture under an overlay, a blob behind a card…).
        if (!this.layers?.length) return;
        this.layer = (this.layer + 1) % this.layers.length;
        this.current = this.layers[this.layer];
        this.trail = [];
        ev.preventDefault();
        ev.stopImmediatePropagation();
        this.draw();
        return;
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        this.finish(this.current);
        return;
      } else return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      this.lastPoint = null;
      this.draw();
    }

    draw() {
      const el = this.current;
      if (!el || !el.isConnected) { this.box.hidden = this.label.hidden = true; return; }
      const r = el.getBoundingClientRect();
      Object.assign(this.box.style, { left: `${r.left - 2}px`, top: `${r.top - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px` });
      this.box.hidden = false;
      const many = (this.layers?.length || 0) > 1 ? ` · ␣ ${(this.layer % this.layers.length) + 1}/${this.layers.length}` : '';
      this.label.textContent = `${guessName(el)} · ${shortSelector(el)} · ${Math.round(r.width)}×${Math.round(r.height)}${many}`;
      this.label.hidden = false;
      const below = r.top < 28;
      Object.assign(this.label.style, { left: `${Math.max(4, Math.min(r.left, innerWidth - 260))}px`, top: `${below ? r.bottom + 6 : r.top - 24}px` });
    }
  }

  // ——— what's under the pointer ———
  const area = el => { const r = el.getBoundingClientRect(); return r.width * r.height; };
  /** An SVG is one picture: its shapes lead to the outermost <svg>. */
  function outerSvg(el) {
    if (!(el instanceof SVGElement)) return el;
    let svg = el instanceof SVGSVGElement ? el : el.ownerSVGElement;
    while (svg?.ownerSVGElement) svg = svg.ownerSVGElement;
    return svg || el;
  }
  const MEDIA = /^(IMG|SVG|svg|CANVAS|VIDEO|PICTURE|IFRAME)$/;
  /** Does it draw anything itself (a color, an image, a border, a shadow, media)? */
  function paints(el, cs = getComputedStyle(el)) {
    if (MEDIA.test(el.tagName)) return true;
    const bg = parseColor(cs.backgroundColor);
    return (bg && bg.a > 0.05) || cs.backgroundImage !== 'none' || px(cs.borderTopWidth) > 0 || px(cs.borderLeftWidth) > 0
      || cs.boxShadow !== 'none' || cs.filter !== 'none' || cs.backdropFilter !== 'none' || cs.maskImage !== 'none';
  }
  /** A see-through, empty layer stretched over something (a "whole card is a link" overlay). */
  function isClearOverlay(el) {
    if (MEDIA.test(el.tagName) || (el.textContent || '').trim() || el.querySelector?.('svg, img, canvas, video, picture')) return false;
    return !paints(el);
  }

  // ——— naming ———
  function guessName(el) {
    const tag = el.tagName.toLowerCase();
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const role = el.getAttribute('role');
    if (tag === 'button' || role === 'button' || (tag === 'input' && /^(submit|button|reset)$/i.test(el.type))) return 'button';
    if (tag === 'a') return (px(cs.paddingLeft) >= 8 && (parseColor(cs.backgroundColor) || px(cs.borderTopWidth) > 0)) ? 'button' : 'link';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'input';
    if (tag === 'nav' || role === 'navigation') return 'navbar';
    if (tag === 'header') return 'header';
    if (tag === 'footer') return 'footer';
    if (tag === 'svg') return r.width >= 64 || r.height >= 64 ? 'illustration' : 'icon';
    if (tag === 'img' || tag === 'picture') return 'image';
    if (tag === 'canvas') return 'canvas';
    if (tag === 'video') return 'video';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    const empty = !(el.textContent || '').trim();
    if (empty && cs.animationName !== 'none') return 'animation';
    if (empty && /url\(/.test(cs.backgroundImage)) return 'image';
    if (r.height <= 32 && r.width <= 200 && (parseColor(cs.backgroundColor) || px(cs.borderTopWidth) > 0)) return 'badge';
    if ((px(cs.borderTopLeftRadius) > 0 || cs.boxShadow !== 'none' || px(cs.borderTopWidth) > 0) && r.width >= 120 && r.height >= 60) return 'card';
    if (tag === 'section' || r.width >= innerWidth * 0.8) return 'section';
    if (cs.animationName !== 'none') return 'animation';
    if (/url\(/.test(cs.backgroundImage)) return 'image';
    return tag;
  }
  function shortSelector(el) {
    const part = n => {
      const cls = [...n.classList].filter(c => c.length < 30 && !/^[a-z]{1,3}[_-]?[0-9a-f]{5,}$/i.test(c)).slice(0, 2);
      return `${n.tagName.toLowerCase()}${n.id && n.id.length < 24 ? `#${n.id}` : ''}${cls.length ? `.${cls.join('.')}` : ''}`;
    };
    const parts = [];
    for (let n = el; n && n !== document.body && parts.length < 3; n = n.parentElement) parts.unshift(part(n));
    return parts.join(' > ');
  }

  // ——— extraction ———
  const px = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  /** rgb(…) → #hex where opaque, so the CSS reads cleanly. */
  /** Any color in a CSS value (rgb, hsl, color(srgb …), oklch, lab…) → #hex, or rgba() when see-through. */
  const tidy = v => String(v).replace(/\b(rgba?|hsla?|color|oklch|oklab|lab|lch|hwb)\([^()]*\)/g, m => {
    const c = parseColor(m);
    if (!c) return 'transparent';
    return c.a >= 0.995 ? hex(c) : `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(c.a * 100) / 100})`;
  });
  const INHERITED = new Set(['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-transform', 'text-align', 'white-space', 'cursor', 'list-style-type']);
  const PROPS = [
    'display', 'position', 'top', 'right', 'bottom', 'left', 'flex-direction', 'flex-wrap', 'align-items', 'justify-content', 'gap', 'grid-template-columns', 'flex-grow', 'flex-shrink',
    'padding', 'margin', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius', 'box-shadow',
    'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat', 'color', 'opacity', 'backdrop-filter', 'overflow',
    'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-transform', 'text-decoration-line', 'text-align', 'white-space', 'list-style-type',
    'transition', 'cursor', 'width', 'height', 'object-fit',
    'transform', 'filter', 'mix-blend-mode', 'animation',
  ];
  const SIZED = /^(IMG|SVG|VIDEO|CANVAS|PICTURE|INPUT|TEXTAREA|SELECT|IFRAME)$/;

  // Default styles per tag, from a blank frame inside Mochi (so page CSS doesn't count as "default").
  let defaultsFrame = null;
  const defaultsCache = new Map();
  function defaultsFor(tag, mount) {
    if (defaultsCache.has(tag)) return defaultsCache.get(tag);
    let out = {};
    try {
      if (!defaultsFrame) {
        defaultsFrame = document.createElement('iframe');
        defaultsFrame.setAttribute('aria-hidden', 'true');
        defaultsFrame.style.cssText = 'position:fixed;width:10px;height:10px;left:-50px;top:-50px;border:0;visibility:hidden';
        mount.append(defaultsFrame);
      }
      const doc = defaultsFrame.contentDocument;
      const probe = doc.createElement(tag.toLowerCase());
      if (tag === 'A') probe.setAttribute('href', '#'); // a link's default look (underline, color) needs an href
      doc.body.append(probe);
      const cs = defaultsFrame.contentWindow.getComputedStyle(probe);
      for (const p of PROPS) out[p] = cs.getPropertyValue(p);
      probe.remove();
    } catch (_) { out = {}; }
    defaultsCache.set(tag, out);
    return out;
  }

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META']);
  const KEEP_ATTRS = ['href', 'src', 'alt', 'type', 'placeholder', 'aria-label', 'role', 'title', 'for', 'name', 'value', 'width', 'height', 'poster'];
  const SVG_TAGS = /^(svg|g|path|circle|ellipse|rect|line|polyline|polygon|defs|lineargradient|radialgradient|stop|clippath|mask|pattern|symbol|use|text|tspan|title|image|filter|fe[a-z]+|animate|animatetransform|animatemotion|set|mpath)$/i;
  const SVG_ATTRS = /^(viewBox|xmlns|fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|stroke-dasharray|stroke-dashoffset|stroke-opacity|fill-opacity|fill-rule|clip-rule|d|cx|cy|r|rx|ry|fx|fy|x|y|x1|x2|y1|y2|dx|dy|width|height|points|transform|opacity|offset|stop-color|stop-opacity|gradientUnits|gradientTransform|spreadMethod|patternUnits|patternContentUnits|patternTransform|preserveAspectRatio|id|clip-path|mask|filter|font-size|font-family|font-weight|font-style|text-anchor|dominant-baseline|letter-spacing|in|in2|result|stdDeviation|mode|operator|k1|k2|k3|k4|flood-color|flood-opacity|values|type|attributeName|attributeType|dur|begin|end|repeatCount|repeatDur|from|to|by|keyTimes|keySplines|calcMode|additive|accumulate|rotate|path|restart)$/i;
  const SHAPES = /^(path|circle|ellipse|rect|line|polyline|polygon|text|tspan|use)$/i;
  const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // Only links inside the drawing itself (#id) or a data: image: nothing that would load from the web.
  const safeRef = v => /^#[\w.-]+$/.test(v) || /^data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,]/i.test(v);
  const safeUrlRef = v => !/url\(\s*['"]?(?!#)/i.test(v);

  /**
   * Clean SVG markup: shapes, text, gradients, filters and SMIL animations,
   * with the colors the page really paints (CSS classes and currentColor
   * resolved). No scripts, event handlers, links or anything that loads.
   */
  function cleanSvg(node, budget, onPaint, depth = 0) {
    if (depth > 24 || budget.n <= 0) return '';
    const tag = node.tagName;
    if (!SVG_TAGS.test(tag)) return '';
    budget.n--;
    const attrs = new Map();
    for (const a of node.attributes) {
      const name = a.name;
      if ((name === 'href' || name === 'xlink:href') && safeRef(a.value)) { attrs.set('href', a.value); continue; }
      if (!SVG_ATTRS.test(name) || /^on/i.test(name)) continue;
      if (/url\(/i.test(a.value) && !safeUrlRef(a.value)) continue;
      attrs.set(name, a.value);
    }
    // The paint the page actually uses (often set by CSS classes or currentColor).
    if (SHAPES.test(tag) || /^(svg|g)$/i.test(tag)) {
      try {
        const cs = getComputedStyle(node);
        for (const prop of ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity']) {
          let v = cs.getPropertyValue(prop);
          if (!v || attrs.has(prop) && attrs.get(prop) === v) continue;
          if (/url\(/.test(v)) { if (!/url\(\s*["']?#/.test(v)) continue; v = v.replace(/url\(\s*["']?[^#)]*?(#[^"')]+)["']?\s*\)/, 'url($1)'); }
          if ((prop === 'opacity' || /-opacity$/.test(prop)) && v === '1') continue;
          if (prop === 'stroke-width' && (v === '1px' || cs.stroke === 'none')) continue;
          if (prop === 'stroke' && v === 'none' && !attrs.has('stroke')) continue;
          if (SHAPES.test(tag) || attrs.has(prop) || /^(fill|stroke)$/.test(prop) && v !== 'none' && v !== 'rgb(0, 0, 0)') attrs.set(prop, tidy(v));
          if (SHAPES.test(tag) && /^(fill|stroke)$/.test(prop) && !/url\(/.test(v)) onPaint(v, node);
        }
      } catch (_) { /* not rendered: keep its own attributes */ }
    }
    const open = [...attrs].map(([k, v]) => ` ${k}="${escapeHtml(v)}"`).join('');
    const kids = [...node.childNodes].map(k => {
      if (k.nodeType === 3) return /^(text|tspan|title)$/i.test(tag) ? escapeHtml(k.data) : '';
      return k.nodeType === 1 ? cleanSvg(k, budget, onPaint, depth + 1) : '';
    }).join('');
    return `<${tag}${open}>${kids}</${tag}>`;
  }

  /**
   * A picture of what an <img>, <canvas> or <video> shows right now, as a
   * small data: image (at most 480 px wide). null when the browser doesn't
   * allow it (a picture from another site that didn't opt in).
   */
  function snapshot(el) {
    try {
      // Only pictures that are really there: a loaded image, a video with a frame.
      if (el.tagName === 'IMG' && (!el.complete || !el.naturalWidth)) return null;
      if (el.tagName === 'VIDEO' && el.readyState < 2) return null;
      const w = el.naturalWidth || el.videoWidth || el.width || el.clientWidth;
      const h = el.naturalHeight || el.videoHeight || el.height || el.clientHeight;
      if (!w || !h) return null;
      const scale = Math.min(1, 480 / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * scale));
      c.height = Math.max(1, Math.round(h * scale));
      const g = c.getContext('2d');
      g.drawImage(el, 0, 0, c.width, c.height);
      let url = c.toDataURL('image/png');
      if (url.length > 160000) url = c.toDataURL('image/jpeg', 0.82);
      if (url.length > 240000 || url.length < 200) return null;
      const colors = samplePixels(g, c.width, c.height);
      if (!colors.length) return null; // nothing drawn yet (all see-through)
      return { url, colors };
    } catch (_) { return null; } // tainted by another site: leave it out
  }
  /** The main colors of a picture: a coarse grid of pixels, counted. */
  function samplePixels(g, w, h) {
    const counts = new Map();
    const data = g.getImageData(0, 0, w, h).data;
    const stepX = Math.max(1, Math.floor(w / 24)), stepY = Math.max(1, Math.floor(h / 24));
    for (let y = 0; y < h; y += stepY) for (let x = 0; x < w; x += stepX) {
      const i = (y * w + x) * 4;
      if (data[i + 3] < 128) continue;
      const q = v => Math.min(255, Math.round(v / 24) * 24);
      const key = hex({ r: q(data[i]), g: q(data[i + 1]), b: q(data[i + 2]), a: 1 });
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => ({ hex: k, weight: n }));
  }
  const absUrl = u => { try { return new URL(u, document.baseURI).href; } catch (_) { return u; } };
  /** url(…) in CSS: small data: images stay, web addresses become absolute, big data blobs are shortened. */
  const cssUrls = v => String(v).replace(/url\(\s*(['"]?)(.*?)\1\s*\)/g, (m, q, u) => (u.startsWith('data:') ? (u.length <= 8000 ? `url("${u}")` : 'url(…)') : `url("${absUrl(u)}")`));
  /** The CSS animations (by name) from the page's own stylesheets, as @keyframes text. */
  function keyframesFor(names, roots) {
    const out = new Map();
    if (!names.size) return [];
    const visit = rules => {
      for (const r of rules) {
        if (out.size >= names.size) return;
        if (r instanceof CSSKeyframesRule) { if (names.has(r.name) && !out.has(r.name)) out.set(r.name, r.cssText); continue; }
        if (r.cssRules && !(r instanceof CSSStyleRule)) visit(r.cssRules);
      }
    };
    for (const root of roots) {
      for (const sheet of [...(root.styleSheets || []), ...(root.adoptedStyleSheets || [])]) {
        let rules;
        try { rules = sheet.cssRules; } catch (_) { continue; } // another origin's stylesheet: off limits
        if (rules) visit(rules);
      }
    }
    return [...out.values()];
  }

  /**
   * Everything about one picked element: its key style, hover, colors, and
   * clean HTML + CSS for its subtree (at most 120 elements).
   */
  function extractComponent(root, { mount } = {}) {
    const t0 = performance.now();
    root = outerSvg(root); // a shape inside an SVG means the whole picture
    const rootCs = getComputedStyle(root);
    const rect = root.getBoundingClientRect();
    const name = guessName(root);
    const nodes = [];
    const lines = [];
    const palette = new Map();
    const addColor = (value, role, weight) => {
      const c = parseColor(value);
      if (!c || c.a < 0.3) return;
      const key = hex(c);
      const cur = palette.get(key) || { hex: key, role, weight: 0 };
      cur.weight += weight;
      palette.set(key, cur);
    };
    let counter = 0;
    const animations = new Set(); // CSS animation names used inside
    const media = [];             // snapshots of images, canvas and video: { cls, tag, url }
    const svgBudget = { n: 1500 };
    const gradientColors = (value, weight) => {
      const found = String(value).match(/\b(?:rgba?|hsla?|color|oklch|oklab|lab|lch|hwb)\([^()]*\)|#[0-9a-f]{3,8}\b/gi) || [];
      for (const c of found) addColor(c, 'gradient', weight / found.length);
    };

    const cssFor = (el, cs, parentCs, className, isRoot) => {
      const defaults = defaultsFor(el.tagName, mount || document.documentElement);
      const decl = [];
      // What a running animation is changing right now (its @keyframes describe it; the value now is just a moment).
      const animated = new Set();
      if (cs.animationName !== 'none') {
        try {
          for (const a of el.getAnimations?.() || []) for (const k of a.effect?.getKeyframes?.() || []) {
            for (const key of Object.keys(k)) animated.add(key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`));
          }
        } catch (_) { /* older browser: keep the values */ }
      }
      for (const prop of PROPS) {
        let value = cs.getPropertyValue(prop);
        if (!value || animated.has(prop)) continue;
        if (prop === 'width' || prop === 'height') {
          // Sizes matter for media, inline blocks, and boxes that are only a picture (an animated blob, a hero image).
          const boxOnly = isRoot && (/absolute|fixed/.test(cs.position) || (!(el.textContent || '').trim() && !el.querySelector('img, svg, canvas, video, picture')));
          if (!SIZED.test(el.tagName) && !(isRoot && /inline-block|inline-flex/.test(cs.display)) && !boxOnly) continue;
        }
        if (/^(top|right|bottom|left)$/.test(prop) && (isRoot || !/absolute|fixed|sticky/.test(cs.position))) continue; // the root's spot on the page isn't its style
        if (prop === 'position' && (value === 'static' || (isRoot && value !== 'relative'))) continue; // a picked root isn't pinned to the page
        if (INHERITED.has(prop)) {
          if (!isRoot && parentCs && parentCs.getPropertyValue(prop) === value) continue;
          if (isRoot && !/^(color|font-family|font-size|font-weight|line-height|letter-spacing|text-transform|cursor)$/.test(prop) && value === defaults[prop]) continue;
          if (isRoot && /^(letter-spacing|text-transform|cursor)$/.test(prop) && /^(normal|none|auto)$/.test(value)) continue;
        } else if (value === defaults[prop]) continue;
        if (prop === 'transform' && cs.animationName !== 'none') continue; // the animation moves it
        if (prop === 'animation' && cs.animationName === 'none') continue;
        if ((prop === 'background-image' || prop === 'mask-image') && /url\(/.test(value)) value = cssUrls(value);
        if (/^background-(size|position|repeat)$/.test(prop) && cs.backgroundImage === 'none') continue;
        if (/^border-(top|right|bottom|left)$/.test(prop) && /^0px|none/.test(value.replace(/\s+/g, ' ').split(' ').find(p => /px|none/.test(p)) || '')) continue;
        if (prop === 'margin' && isRoot) continue; // its spot on the page, not its style
        if (prop === 'transition' && /^all 0s/.test(value)) continue;
        if (prop === 'font-family') value = familyStack(value);
        decl.push([prop, tidy(value)]);
      }
      // Four equal sides → one border.
      const sides = ['border-top', 'border-right', 'border-bottom', 'border-left'];
      const vals = sides.map(sd => decl.find(([p]) => p === sd)?.[1]);
      if (vals.every(v => v && v === vals[0])) {
        const at = decl.findIndex(([p]) => p === 'border-top');
        for (const sd of sides) decl.splice(decl.findIndex(([p]) => p === sd), 1);
        decl.splice(at, 0, ['border', vals[0]]);
      }
      return decl;
    };

    const walk = (el, parentCs, depth) => {
      if (counter >= 120 || depth > 12) return '';
      if (SKIP.has(el.tagName)) return '';
      const cs = getComputedStyle(el);
      if (cs.display === 'none') return '';
      const isRoot = el === root;
      counter++;
      const className = isRoot ? 'mochi-pick' : `mochi-pick__${counter - 1}`;
      // Colors this piece uses.
      const r = el.getBoundingClientRect();
      addColor(cs.backgroundColor, 'background', r.width * r.height);
      if ([...el.childNodes].some(n => n.nodeType === 3 && n.data.trim())) addColor(cs.color, 'text', 400);
      if (px(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') addColor(cs.borderTopColor, 'border', (r.width + r.height) * 2);
      if (cs.backgroundImage !== 'none') gradientColors(cs.backgroundImage, r.width * r.height * 0.6);
      for (const n of cs.animationName.split(',').map(x => x.trim())) if (n && n !== 'none') animations.add(n);

      if (el instanceof SVGElement) {
        if (el.tagName.toLowerCase() !== 'svg') return '';
        const decl = cssFor(el, cs, parentCs, className, isRoot);
        if (decl.length) lines.push(rule(`.${className}`, decl));
        const onPaint = (v, node) => { const b = node.getBBox?.(); addColor(v, 'illustration', b ? Math.max(40, b.width * b.height) : 200); };
        return cleanSvg(el, svgBudget, onPaint).replace(/^<svg/, `<svg class="${className}"`);
      }
      const decl = cssFor(el, cs, parentCs, className, isRoot);
      if (decl.length) lines.push(rule(`.${className}`, decl));
      let tag = el.tagName.toLowerCase();
      if (tag.includes('-')) tag = /inline/.test(cs.display) ? 'span' : 'div';
      const attrs = KEEP_ATTRS.map(a => {
        let v = el.getAttribute(a);
        if (v === null) return '';
        if (a === 'href') v = '#';
        if (a === 'src') v = el.currentSrc || el.src || v;
        if (a === 'src' || a === 'poster') v = v.startsWith('data:') ? (v.length <= 20000 ? v : 'data:…') : absUrl(v);
        return ` ${a}="${escapeHtml(/^(src|poster)$/.test(a) && v.startsWith('data:') ? v : v.slice(0, 500))}"`;
      }).join('');
      nodes.push(el);
      // What an image, a canvas or a video shows right now (canvas and video have no markup for it).
      if (/^(IMG|CANVAS|VIDEO)$/.test(el.tagName) && media.length < 6) {
        const shot = snapshot(el);
        if (shot) {
          media.push({ cls: className, tag: tag, url: shot.url });
          for (const c of shot.colors) addColor(c.hex, 'image', c.weight * 40);
          if (tag === 'canvas') return `<img class="${className}" src="${shot.url}" alt="${escapeHtml(Mochi.t ? Mochi.t('picker.canvasShot') : 'Canvas snapshot')}" width="${el.width}" height="${el.height}">`;
        }
      }
      const kids = [...el.childNodes].map(n => {
        if (n.nodeType === 3) return escapeHtml(n.data.replace(/\s+/g, ' ').slice(0, 300));
        if (n.nodeType === 1) return walk(n, cs, depth + 1);
        return '';
      }).join('');
      if (/^(img|input|br|hr)$/.test(tag)) return `<${tag} class="${className}"${attrs}>`;
      return `<${tag} class="${className}"${attrs}>${kids}</${tag}>`;
    };

    const html = walk(root, root.parentElement ? getComputedStyle(root.parentElement) : null, 0).replace(/\s{2,}/g, ' ').trim();
    const hover = hoverOf(root);
    if (hover.length) lines.splice(1, 0, rule('.mochi-pick:hover', hover));
    // The animations' @keyframes, so the motion comes along.
    const roots = new Set([document, root.getRootNode()]);
    lines.push(...keyframesFor(animations, roots));

    const style = {
      background: tidy(rootCs.backgroundColor),
      backgroundImage: rootCs.backgroundImage !== 'none' ? tidy(cssUrls(rootCs.backgroundImage)).replace(/url\("data:[^"]{200,}"\)/g, 'url(data:…)') : null,
      animation: animations.size ? rootCs.animationName !== 'none' ? rootCs.animation : `inside: ${[...animations].join(', ')}` : null,
      color: tidy(rootCs.color),
      font: {
        family: Mochi.fontFamilyOf ? Mochi.fontFamilyOf(rootCs.fontFamily).name : rootCs.fontFamily.split(',')[0].replace(/["']/g, ''),
        stack: familyStack(rootCs.fontFamily),
        size: rootCs.fontSize, weight: rootCs.fontWeight, lineHeight: rootCs.lineHeight, letterSpacing: rootCs.letterSpacing,
        transform: rootCs.textTransform !== 'none' ? rootCs.textTransform : null,
      },
      padding: rootCs.padding,
      radius: rootCs.borderRadius,
      border: px(rootCs.borderTopWidth) > 0 && rootCs.borderTopStyle !== 'none' ? tidy(`${rootCs.borderTopWidth} ${rootCs.borderTopStyle} ${rootCs.borderTopColor}`) : 'none',
      shadow: rootCs.boxShadow !== 'none' ? tidy(rootCs.boxShadow) : 'none',
      backdrop: rootCs.backdropFilter && rootCs.backdropFilter !== 'none' ? rootCs.backdropFilter : null,
      display: rootCs.display,
      gap: rootCs.gap !== 'normal' ? rootCs.gap : null,
      transition: rootCs.transitionDuration.split(',').some(d => px(d) > 0) ? rootCs.transition : null,
      size: { width: Math.round(rect.width), height: Math.round(rect.height) },
    };

    return {
      v: 1,
      kind: 'component',
      id: `cmp_${Date.now().toString(36)}`,
      url: location.href.split('#')[0],
      host: location.hostname || 'local file',
      title: (document.title || location.hostname || 'Untitled').slice(0, 120),
      at: new Date().toISOString(),
      name,
      selector: shortSelector(root),
      label: (root.innerText || root.getAttribute('aria-label') || root.getAttribute('alt') || '').trim().replace(/\s+/g, ' ').slice(0, 60),
      style,
      hover: hover.length ? Object.fromEntries(hover) : null,
      colors: [...palette.values()].sort((a, b) => b.weight - a.weight).slice(0, 6).map(({ hex: h, role }) => ({ hex: h, role })),
      html,
      css: lines.join('\n\n'),
      media,
      stats: { elements: counter, capped: counter >= 120, ms: Math.round(performance.now() - t0) },
    };
  }

  const rule = (selector, decl) => `${selector} {\n${decl.map(([p, v]) => `  ${p}: ${v};`).join('\n')}\n}`;
  function familyStack(value) {
    const names = String(value).split(',').map(n => n.trim().replace(/^["']|["']$/g, ''))
      .map(n => (n.match(/^__(.+?)_[0-9a-f]{5,8}$/i)?.[1].replace(/_/g, ' ')) || n)
      .filter((n, i, all) => n && !/fallback/i.test(n) && all.findIndex(m => m.toLowerCase() === n.toLowerCase()) === i);
    return names.slice(0, 5).map(n => (/^[\w-]+$/.test(n) && /^(system-ui|sans-serif|serif|monospace|ui-[\w-]+|-apple-system|BlinkMacSystemFont|cursive)$/i.test(n) ? n : `"${n}"`)).join(', ');
  }

  /** :hover rules that apply to the element, from the page's own (same-origin) stylesheets. */
  function hoverOf(el) {
    const found = new Map();
    const deadline = performance.now() + 60;
    let seen = 0;
    const visit = rules => {
      for (const r of rules) {
        if (++seen > 25000 || performance.now() > deadline) return;
        if (r.cssRules && !(r instanceof CSSStyleRule)) {
          if (r.media && !matchMedia(r.media.mediaText).matches) continue;
          visit(r.cssRules);
          continue;
        }
        if (!(r instanceof CSSStyleRule) || !r.selectorText.includes(':hover')) continue;
        const hit = r.selectorText.split(',').some(sel => {
          if (!sel.includes(':hover') || /::/.test(sel)) return false;
          const target = sel.trim();
          // Only rules about the element itself (".btn:hover", not ".card:hover .btn").
          if (!/:hover\s*$/.test(target.replace(/:(not|is|where)\([^)]*\)/g, ''))) return false;
          try { return el.matches(target.replace(/:hover/g, '')); } catch (_) { return false; }
        });
        if (!hit) continue;
        for (const prop of r.style) {
          if (/^(--|cursor|transition|outline)/.test(prop)) continue;
          const value = r.style.getPropertyValue(prop);
          if (/^(initial|unset|inherit|revert)$/.test(value.trim())) continue; // a shorthand's resets, not a real change
          found.set(prop, tidy(r.style.getPropertyValue(prop)));
        }
      }
    };
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (_) { continue; } // another origin's stylesheet: off limits
      if (rules) visit(rules);
    }
    return [...found];
  }

  Mochi.Picker = Picker;
  Mochi.extractComponent = extractComponent;
  Mochi.pickName = guessName;

  /* SHAPE — what extractComponent() returns:
   * { v, kind: 'component', id, url, host, title, at, name: button|link|card|input|badge|navbar|…,
   *   selector, label,
   *   style: { background, backgroundImage, color, font: { family, stack, size, weight, lineHeight, letterSpacing, transform },
   *            padding, radius, border, shadow, backdrop, display, gap, transition, size: { width, height } },
   *   hover: { prop: value } | null, colors: [{ hex, role }], html, css, stats: { elements, capped, ms } }
   */
})();
