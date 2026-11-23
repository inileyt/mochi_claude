/*
 * Mochi — a picked part of the page as an SVG for Figma (loaded the first time it's used).
 * Figma turns pasted SVG code into editable layers, so Mochi rebuilds the element as shapes:
 *   boxes → <rect> (fill, border, corner radius, the first shadow, linear gradients, opacity),
 *   text  → <text> per line (font, size, weight, color, letter spacing), at the line's place,
 *   images → <image> (only when its pixels can be read here; otherwise a gray placeholder),
 *   inline SVG icons → copied as they are,
 * each in a <g id="…"> named after the element (Figma uses it as the layer name).
 * Approximate on purpose: no pseudo-elements' content, no filters/blend modes, no transforms.
 *
 *   Mochi.svgExport.build(el) → { svg, width, height, counts: { boxes, texts, images, icons, skipped } }
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const T = (k, v) => Mochi.t(k, v);
  const MAX_NODES = 600;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const num = v => Math.round(v * 100) / 100;
  const transparent = c => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);
  const layerName = el => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`.slice(0, 60);

  function build(root) {
    const R = root.getBoundingClientRect();
    const W = Math.max(1, Math.round(R.width)), H = Math.max(1, Math.round(R.height));
    const defs = [];
    let uid = 0, nodes = 0;
    const counts = { boxes: 0, texts: 0, images: 0, icons: 0, skipped: 0 };
    const id = p => `${p}${++uid}`;
    const X = v => num(v - R.left), Y = v => num(v - R.top);

    function gradient(bg) {
      const m = /linear-gradient\((.*)\)\s*$/.exec(bg);
      if (!m) return null;
      // Split on commas outside parentheses.
      const parts = []; let depth = 0, cur = '';
      for (const ch of m[1]) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { parts.push(cur.trim()); cur = ''; } else cur += ch; }
      parts.push(cur.trim());
      let angle = 180;
      if (/deg$/.test(parts[0])) angle = parseFloat(parts.shift());
      else if (/^to /.test(parts[0])) { const d = parts.shift(); angle = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270, 'to top right': 45, 'to bottom right': 135, 'to bottom left': 225, 'to top left': 315 }[d] ?? 180; }
      const stops = parts.map((p, i) => { const sm = /^(.*?)(?:\s+([\d.]+)%)?$/.exec(p); return { color: sm[1], at: sm[2] != null ? Number(sm[2]) : (i / Math.max(1, parts.length - 1)) * 100 }; });
      const a = (angle - 90) * Math.PI / 180;
      const gid = id('g');
      defs.push(`<linearGradient id="${gid}" x1="${num(50 - Math.cos(a) * 50)}%" y1="${num(50 - Math.sin(a) * 50)}%" x2="${num(50 + Math.cos(a) * 50)}%" y2="${num(50 + Math.sin(a) * 50)}%">${stops.map(s => `<stop offset="${s.at}%" stop-color="${esc(s.color)}"/>`).join('')}</linearGradient>`);
      return `url(#${gid})`;
    }
    function shadow(bs) {
      if (!bs || bs === 'none' || /inset/.test(bs)) return null;
      const m = /(rgba?\([^)]*\)|#[0-9a-f]{3,8})?\s*(-?[\d.]+)px\s+(-?[\d.]+)px\s*([\d.]+)?p?x?\s*(-?[\d.]+)?p?x?\s*(rgba?\([^)]*\)|#[0-9a-f]{3,8})?/i.exec(bs);
      if (!m) return null;
      const color = m[1] || m[6] || 'rgba(0,0,0,0.25)';
      const fid = id('s');
      defs.push(`<filter id="${fid}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${m[2]}" dy="${m[3]}" stdDeviation="${num((parseFloat(m[4]) || 0) / 2)}" flood-color="${esc(color)}"/></filter>`);
      return `url(#${fid})`;
    }
    function box(el, cs, r) {
      const out = [];
      const radius = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, r.width / 2, r.height / 2);
      const bg = transparent(cs.backgroundColor) ? null : cs.backgroundColor;
      const grad = cs.backgroundImage && cs.backgroundImage !== 'none' ? gradient(cs.backgroundImage) : null;
      const bw = parseFloat(cs.borderTopWidth) || 0;
      const border = bw && cs.borderTopStyle !== 'none' && !transparent(cs.borderTopColor) ? { w: bw, c: cs.borderTopColor } : null;
      const sh = shadow(cs.boxShadow);
      if (!bg && !grad && !border && !sh) return out;
      const rect = (fill, extra = '') => `<rect x="${X(r.left + (border ? border.w / 2 : 0))}" y="${Y(r.top + (border ? border.w / 2 : 0))}" width="${num(r.width - (border ? border.w : 0))}" height="${num(r.height - (border ? border.w : 0))}"${radius ? ` rx="${num(radius)}"` : ''} fill="${fill}"${extra}/>`;
      if (bg || sh || (!grad && border)) out.push(rect(bg ? esc(bg) : grad ? 'none' : 'none', `${border && !grad ? ` stroke="${esc(border.c)}" stroke-width="${border.w}"` : ''}${sh ? ` filter="${sh}"` : ''}`));
      if (grad) out.push(rect(grad, border ? ` stroke="${esc(border.c)}" stroke-width="${border.w}"` : ''));
      counts.boxes++;
      return out;
    }
    /** Each line of a text node: its characters grouped by line box. */
    function lines(node) {
      const text = node.textContent;
      const out = [];
      const range = document.createRange();
      let cur = null;
      for (let i = 0; i < text.length && i < 4000; i++) {
        range.setStart(node, i); range.setEnd(node, i + 1);
        const rects = range.getClientRects();
        const rc = rects[rects.length - 1];
        if (!rc || !rc.width && /\s/.test(text[i])) { if (cur) cur.text += text[i]; continue; }
        if (!cur || Math.abs(rc.top - cur.top) > rc.height / 2) { if (cur) out.push(cur); cur = { text: '', left: rc.left, top: rc.top, bottom: rc.bottom, height: rc.height }; }
        cur.text += text[i];
      }
      if (cur) out.push(cur);
      return out.map(l => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() })).filter(l => l.text);
    }
    function textOf(node, cs) {
      const size = parseFloat(cs.fontSize) || 16;
      const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      const ls = cs.letterSpacing === 'normal' ? '' : ` letter-spacing="${parseFloat(cs.letterSpacing) || 0}"`;
      const tt = cs.textTransform;
      return lines(node).map(l => {
        counts.texts++;
        let t = l.text;
        if (tt === 'uppercase') t = t.toUpperCase(); else if (tt === 'lowercase') t = t.toLowerCase();
        const baseline = l.bottom - (l.height - size) / 2 - size * 0.22;
        return `<text x="${X(l.left)}" y="${Y(baseline)}" font-family="${esc(fam)}" font-size="${num(size)}" font-weight="${esc(cs.fontWeight)}"${cs.fontStyle !== 'normal' ? ` font-style="${esc(cs.fontStyle)}"` : ''} fill="${esc(cs.color)}"${ls}>${esc(t)}</text>`;
      });
    }
    function image(el, r) {
      let href = null;
      try {
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(Math.min(el.naturalWidth || r.width, 1200)));
        c.height = Math.max(1, Math.round((el.naturalHeight || r.height) * (c.width / (el.naturalWidth || r.width))));
        c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
        href = c.toDataURL('image/png'); // throws for a cross-origin picture
      } catch (_) { href = null; }
      counts.images++;
      return href
        ? `<image x="${X(r.left)}" y="${Y(r.top)}" width="${num(r.width)}" height="${num(r.height)}" preserveAspectRatio="xMidYMid slice" href="${href}"/>`
        : `<rect x="${X(r.left)}" y="${Y(r.top)}" width="${num(r.width)}" height="${num(r.height)}" fill="#d9d9d9"/>`;
    }

    function walk(el) {
      if (++nodes > MAX_NODES) { counts.skipped++; return ''; }
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return '';
      const r = el.getBoundingClientRect();
      const parts = [];
      if (el.tagName === 'svg' || el instanceof SVGSVGElement) {
        counts.icons++;
        const copy = el.cloneNode(true);
        copy.setAttribute('x', X(r.left)); copy.setAttribute('y', Y(r.top));
        copy.setAttribute('width', num(r.width)); copy.setAttribute('height', num(r.height));
        if (!copy.getAttribute('fill') && cs.fill && !copy.querySelector('[fill]')) copy.setAttribute('fill', cs.color);
        // currentColor means nothing outside the page: use the icon's real color.
        return `<g id="${esc(layerName(el))}">${new XMLSerializer().serializeToString(copy).replace(/ xmlns="[^"]*"/, '').replace(/currentColor/g, esc(cs.color))}</g>`;
      }
      parts.push(...box(el, cs, r));
      if (el.tagName === 'IMG') parts.push(image(el, r));
      for (const child of el.childNodes) {
        if (child.nodeType === 3 && child.textContent.trim()) parts.push(...textOf(child, cs));
        else if (child.nodeType === 1 && !child.closest('mochi-companion')) parts.push(walk(child));
      }
      const op = Number(cs.opacity) < 1 ? ` opacity="${cs.opacity}"` : '';
      return parts.filter(Boolean).length ? `<g id="${esc(layerName(el))}"${op}>${parts.join('')}</g>` : '';
    }

    const body = walk(root);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${body}</svg>`;
    return { svg, width: W, height: H, counts };
  }

  async function open(ctx, opts = {}) {
    const { companion, panel } = ctx;
    const { h, copyText, downloadText } = Mochi.ui;
    Mochi.menuInstance?.close();
    if (panel.isOpen) panel.close();
    let el = opts.el || null;
    if (!el) {
      const picker = new Mochi.Picker(companion);
      if (picker.hint?.firstChild) picker.hint.firstChild.textContent = T('svg.title');
      companion.say(T('svg.pickHint'), 2400);
      el = await picker.pick();
      if (!el) { ctx.engine.pickCancel?.(); return null; }
    }
    const out = build(el);
    await copyText(out.svg, companion.shadow);
    const preview = h('div', { class: 'svg-preview' });
    const img = h('img', { alt: '', src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(out.svg)}` });
    preview.append(img);
    panel.open(T('svg.title'), `${out.width}×${out.height}px`, h('div', { class: 'svg-out' },
      h('p', { text: T('svg.copied') }), preview,
      h('p', { class: 'note', text: T('svg.counts', out.counts) }),
      h('p', { class: 'note', text: T('svg.approx') })),
    h('div', { class: 'row' },
      h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'svg-copy', onclick: async () => { await copyText(out.svg, companion.shadow); ctx.actions.copied('SVG'); } }, `⧉ ${T('svg.copy')}`),
      h('button', { class: 'px-btn', type: 'button', 'data-act': 'svg-download', onclick: () => { downloadText(`${(el.id || el.tagName).toLowerCase()}.svg`, out.svg, companion.shadow, 'image/svg+xml'); ctx.actions.downloaded('.svg'); } }, '⤓ .svg'),
      h('button', { class: 'px-btn', type: 'button', 'data-act': 'svg-again', onclick: () => open(ctx) }, `⌖ ${T('panel.pickAnother')}`)));
    panel.view = 'svg';
    companion.play('hop');
    companion.say(T('svg.ready'), 2600);
    Mochi.svgExport.last = out;
    return out;
  }

  Mochi.svgExport = { build, open };
  Mochi.toolImpl.svg = { open, close: () => {}, get isOpen() { return false; } };
})();
