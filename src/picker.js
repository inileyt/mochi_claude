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
        h('b', { text: 'Pick an element' }), ' · click to take it · ↑ parent · ↓ back · Enter take · Esc cancel');
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
      resolve?.(result);
    }

    /** The page element under a point (looking into open shadow roots), never Mochi or its glass. */
    elementAt(x, y) {
      let el = document.elementsFromPoint(x, y).find(n => n !== this.c.host && n !== document.documentElement && n !== document.body);
      for (let depth = 0; el?.shadowRoot && depth < 5; depth++) {
        const inner = el.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === el) break;
        el = inner;
      }
      return el || null;
    }

    hover(x, y, force = false) {
      this.lastPoint = [x, y];
      const el = this.elementAt(x, y);
      if (!el || (el === this.current && !force)) return;
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
      this.label.textContent = `${guessName(el)} · ${shortSelector(el)} · ${Math.round(r.width)}×${Math.round(r.height)}`;
      this.label.hidden = false;
      const below = r.top < 28;
      Object.assign(this.label.style, { left: `${Math.max(4, Math.min(r.left, innerWidth - 260))}px`, top: `${below ? r.bottom + 6 : r.top - 24}px` });
    }
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
    if (tag === 'img' || tag === 'svg' || tag === 'picture') return 'image';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (r.height <= 32 && r.width <= 200 && (parseColor(cs.backgroundColor) || px(cs.borderTopWidth) > 0)) return 'badge';
    if ((px(cs.borderTopLeftRadius) > 0 || cs.boxShadow !== 'none' || px(cs.borderTopWidth) > 0) && r.width >= 120 && r.height >= 60) return 'card';
    if (tag === 'section' || r.width >= innerWidth * 0.8) return 'section';
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
    'background-color', 'background-image', 'color', 'opacity', 'backdrop-filter', 'overflow',
    'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-transform', 'text-decoration-line', 'text-align', 'white-space', 'list-style-type',
    'transition', 'cursor', 'width', 'height', 'object-fit',
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
  const KEEP_ATTRS = ['href', 'src', 'alt', 'type', 'placeholder', 'aria-label', 'role', 'title', 'for', 'name', 'value', 'width', 'height'];
  const SVG_ATTRS = /^(viewBox|xmlns|fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|d|cx|cy|r|rx|ry|x|y|x1|x2|y1|y2|width|height|points|transform|fill-rule|clip-rule|opacity)$/i;
  const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /** Clean SVG markup: shapes and their paint only (no scripts, links or event handlers). */
  function cleanSvg(node, depth = 0) {
    if (depth > 8) return '';
    const tag = node.tagName;
    if (!/^(svg|g|path|circle|ellipse|rect|line|polyline|polygon|defs|lineargradient|radialgradient|stop|clippath|mask)$/i.test(tag)) return '';
    const attrs = [...node.attributes].filter(a => SVG_ATTRS.test(a.name) || (/^(offset|stop-color|gradientUnits|id|clip-path|mask)$/i.test(a.name) && !/url\(\s*['"]?(https?:|\/\/)/i.test(a.value)))
      .map(a => ` ${a.name}="${escapeHtml(a.value)}"`).join('');
    const kids = [...node.children].map(k => cleanSvg(k, depth + 1)).join('');
    return `<${tag}${attrs}>${kids}</${tag}>`;
  }

  /**
   * Everything about one picked element: its key style, hover, colors, and
   * clean HTML + CSS for its subtree (at most 120 elements).
   */
  function extractComponent(root, { mount } = {}) {
    const t0 = performance.now();
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

    const cssFor = (el, cs, parentCs, className, isRoot) => {
      const defaults = defaultsFor(el.tagName, mount || document.documentElement);
      const decl = [];
      for (const prop of PROPS) {
        let value = cs.getPropertyValue(prop);
        if (!value) continue;
        if (prop === 'width' || prop === 'height') {
          if (!SIZED.test(el.tagName) && !(isRoot && /inline-block|inline-flex/.test(cs.display))) continue;
        }
        if (/^(top|right|bottom|left)$/.test(prop) && !/absolute|fixed|sticky/.test(cs.position)) continue;
        if (prop === 'position' && (value === 'static' || (isRoot && value !== 'relative'))) continue; // a picked root isn't pinned to the page
        if (INHERITED.has(prop)) {
          if (!isRoot && parentCs && parentCs.getPropertyValue(prop) === value) continue;
          if (isRoot && !/^(color|font-family|font-size|font-weight|line-height|letter-spacing|text-transform|cursor)$/.test(prop) && value === defaults[prop]) continue;
          if (isRoot && /^(letter-spacing|text-transform|cursor)$/.test(prop) && /^(normal|none|auto)$/.test(value)) continue;
        } else if (value === defaults[prop]) continue;
        if (prop === 'background-image' && /url\(/.test(value)) value = value.replace(/url\([^)]*\)/g, 'url(…)');
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

      if (el instanceof SVGElement) {
        if (el.tagName.toLowerCase() !== 'svg') return '';
        const decl = cssFor(el, cs, parentCs, className, isRoot);
        if (decl.length) lines.push(rule(`.${className}`, decl));
        return cleanSvg(el).replace(/^<svg/, `<svg class="${className}"`);
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
        return ` ${a}="${escapeHtml(v.slice(0, 500))}"`;
      }).join('');
      nodes.push(el);
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

    const style = {
      background: tidy(rootCs.backgroundColor),
      backgroundImage: rootCs.backgroundImage !== 'none' ? tidy(rootCs.backgroundImage).replace(/url\([^)]*\)/g, 'url(…)') : null,
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
