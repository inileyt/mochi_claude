/*
 * Mochi — Deep Scan, Task 1: the structure map.
 *
 * Walks the page (document order, up to MAX_NODES elements, in small slices so
 * the page never freezes), finds its regions (landmarks first, then full-width
 * bands for "div soup"), describes each region's layout system and positioning,
 * finds repeated patterns (cards, nav items, logos, slides…) and writes the
 * page outline in reading order.
 *
 * No copy text is kept: only how long a text is and how many lines it takes
 * (the original text only when you ticked "this is my own site").
 *
 * Writes scan.spec.structure and keeps live element references in scan.nodes /
 * scan.regions for the later phases (geometry, states, motion, scroll).
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const D = Mochi.deepScan;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'BR', 'WBR', 'SOURCE', 'TRACK', 'PARAM']);
  const STATE_CLASS = /^(is-|has-|js-|active$|open$|show$|visible$|hidden$|selected$|current$|in-view|aos-|animate)/;
  const round = n => Math.round(n);
  const px = v => (v === 'auto' || v === 'none' || v === 'normal' || v === '' ? v : v);

  // ——— 1) collect ———
  const KEEP = ['display', 'position', 'top', 'right', 'bottom', 'left', 'zIndex', 'gridTemplateColumns', 'gridTemplateRows', 'gridTemplateAreas', 'gridAutoFlow', 'flexDirection', 'flexWrap',
    'justifyContent', 'alignItems', 'rowGap', 'columnGap', 'maxWidth', 'minHeight', 'marginLeft', 'marginRight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'overflowX', 'overflowY',
    'scrollSnapType', 'visibility', 'opacity', 'transform', 'backgroundColor', 'backgroundImage', 'borderTopLeftRadius', 'boxShadow', 'borderTopWidth', 'fontSize', 'lineHeight', 'fontWeight'];

  const HIDDEN_KEEP = 'dialog, [role="dialog"], [hidden][id], nav, button, [role="button"], [aria-controls], [aria-expanded], a[href]';
  const HIDDEN_OPEN = 'dialog, [role="dialog"], [hidden][id], nav';

  async function collect(scan, { limit = D.MAX_NODES } = {}) {
    const nodes = [];
    let total = 0, skipped = 0;
    let slice = performance.now();
    const sx = scrollX, sy = scrollY;
    const walk = async (el, parent, depth) => {
      if (el === scan.ignore || SKIP.has(el.tagName)) return;
      total++;
      if (performance.now() - slice > 12) { await scan.breathe(); slice = performance.now(); }
      const cs = getComputedStyle(el);
      // Hidden now: keep controls and menus (a burger hidden on desktop, a closed drawer) but not their whole subtree.
      let descend = true;
      if (cs.display === 'none') {
        if (!el.matches(HIDDEN_KEEP)) { skipped++; return; }
        descend = el.matches(HIDDEN_OPEN);
      }
      if (nodes.length >= limit) { skipped++; return; }
      const r = el.getBoundingClientRect();
      const style = {};
      for (const k of KEEP) style[k] = cs[k];
      const n = {
        i: nodes.length, el, tag: el.tagName.toLowerCase(), parent, depth, children: [],
        id: el.id || null,
        cls: [...el.classList].filter(c => !STATE_CLASS.test(c)).slice(0, 4),
        role: el.getAttribute('role') || null,
        label: el.getAttribute('aria-label') ? 'yes' : null,
        rect: { x: round(r.left + sx), y: round(r.top + sy), w: round(r.width), h: round(r.height) },
        hidden: cs.display === 'none' || cs.visibility === 'hidden' || r.width * r.height === 0,
        style,
        text: ownText(el),
      };
      nodes.push(n);
      if (parent !== null) nodes[parent].children.push(n.i);
      if (descend) for (const child of el.children) await walk(child, n.i, depth + 1);
    };
    await walk(document.body, null, 0);
    return { nodes, total, skipped };
  }

  /** The element's own text (not its children's): length and words only. */
  function ownText(el) {
    let len = 0;
    for (const c of el.childNodes) if (c.nodeType === 3) len += c.nodeValue.trim().length;
    return len;
  }

  // ——— 2) regions ———
  const isLandmark = n => {
    const role = n.role;
    if (['header', 'footer', 'nav', 'main', 'aside'].includes(n.tag) || ['banner', 'contentinfo', 'navigation', 'main', 'complementary', 'dialog', 'region'].includes(role)) return true;
    if (n.tag === 'dialog' || n.el.getAttribute('aria-modal') === 'true') return true;
    if (n.tag === 'section' || n.tag === 'form' && n.rect.w > innerWidth * 0.8) return true;
    return false;
  };
  const kindOf = n => {
    if (n.tag === 'dialog' || n.role === 'dialog' || n.el.getAttribute('aria-modal') === 'true') return 'modal';
    if (n.tag === 'header' || n.role === 'banner') return 'header';
    if (n.tag === 'footer' || n.role === 'contentinfo') return 'footer';
    if (n.tag === 'nav' || n.role === 'navigation') return 'nav';
    if (n.tag === 'aside' || n.role === 'complementary') return 'sidebar';
    if (n.tag === 'main' || n.role === 'main') return 'main';
    return 'section';
  };

  /** Top-level bands: the page's direct building blocks (unwrapping single-child wrappers). */
  function bandsOf(nodes, rootIndex) {
    const out = [];
    const visit = idx => {
      const n = nodes[idx];
      const kids = n.children.map(i => nodes[i]).filter(k => !k.hidden || kindOf(k) === 'modal' || k.tag === 'nav');
      for (const k of kids) {
        const wide = k.rect.w >= innerWidth * 0.85 || k.rect.w >= nodes[rootIndex].rect.w * 0.95;
        const pos = k.style.position;
        if (k.tag === 'main' || k.role === 'main') { out.push(k); continue; }
        // A tall full-width wrapper made of full-width bands (header, content, footer…): look inside.
        const bandKids = k.children.map(i => nodes[i]).filter(c => !c.hidden && c.rect.w >= k.rect.w * 0.85 && c.rect.h >= 32);
        if (!isLandmark(k) && k.tag !== 'header' && k.tag !== 'footer' && bandKids.length >= 2 && k.rect.h > innerHeight * 1.2 && pos !== 'fixed' && pos !== 'sticky') { visit(k.i); continue; }
        if (isLandmark(k) || (wide && k.rect.h >= 32) || pos === 'fixed' || pos === 'sticky' || kindOf(k) === 'modal') out.push(k);
        else if (k.children.length && !k.text) visit(k.i); // a wrapper: look inside
      }
    };
    visit(rootIndex);
    return out;
  }

  // ——— 3) layout description ———
  /** "7fr 5fr" from "644px 460px": small whole-number ratio (≤ 12 parts) or equal columns. */
  function fitColumns(list) {
    const cols = list.map(parseFloat).filter(n => n > 0);
    if (cols.length < 2) return null;
    const min = Math.min(...cols), max = Math.max(...cols);
    if (max - min <= 2) return `repeat(${cols.length}, 1fr)`;
    const total = cols.reduce((a, b) => a + b, 0);
    for (const parts of [12, 10, 8, 6, 5, 4, 3, 16, 24]) {
      const fr = cols.map(c => (c / total) * parts);
      if (fr.every(f => Math.abs(f - Math.round(f)) < 0.08 && Math.round(f) > 0)) return fr.map(f => `${Math.round(f)}fr`).join(' ');
    }
    return cols.map(c => `${Math.round(c)}px`).join(' ');
  }
  function layoutOf(n) {
    const s = n.style;
    const out = { display: s.display };
    if (s.display.includes('grid')) {
      const cols = s.gridTemplateColumns === 'none' ? [] : s.gridTemplateColumns.split(' ').filter(Boolean);
      out.grid = { columns: cols.length, template: fitColumns(cols) || s.gridTemplateColumns, px: cols.map(c => Math.round(parseFloat(c))), rows: s.gridTemplateRows === 'none' ? null : s.gridTemplateRows.split(' ').length, areas: s.gridTemplateAreas !== 'none' ? s.gridTemplateAreas : null, autoFlow: s.gridAutoFlow };
    }
    if (s.display.includes('flex')) out.flex = { direction: s.flexDirection, wrap: s.flexWrap, justify: s.justifyContent, align: s.alignItems };
    const gap = [s.rowGap, s.columnGap].filter(g => g && g !== 'normal');
    if (gap.length) out.gap = gap[0] === gap[1] ? gap[0] : `${s.rowGap} ${s.columnGap}`;
    if (s.scrollSnapType && s.scrollSnapType !== 'none') out.scrollSnap = s.scrollSnapType;
    if (s.overflowX === 'auto' || s.overflowX === 'scroll') out.scrollsX = true;
    return out;
  }
  function positionOf(n) {
    const s = n.style;
    if (s.position === 'static') return null;
    // relative without offsets or z-index only anchors children: not worth a line.
    if (s.position === 'relative' && s.zIndex === 'auto' && ['top', 'right', 'bottom', 'left'].every(k => s[k] === 'auto' || s[k] === '0px')) return null;
    const p = { position: s.position };
    for (const k of ['top', 'right', 'bottom', 'left']) if (s[k] !== 'auto') p[k] = s[k];
    if (s.zIndex !== 'auto') p.zIndex = Number(s.zIndex);
    return p;
  }

  /** The element that sets the layout of a region: itself, or the first descendant with a grid/flex layout and real children (through containers). */
  function layoutRoot(nodes, n) {
    // Breadth-first, up to 4 levels: the first grid/flex element with ≥ 2 visible children
    // that spans at least half the region (the region's own layout, or its main grid).
    const queue = [n];
    while (queue.length) {
      const c = queue.shift();
      const kids = c.children.map(i => nodes[i]).filter(k => !k.hidden);
      const d = c.style.display;
      if ((d.includes('grid') || d.includes('flex')) && kids.length >= 2 && c.rect.w >= n.rect.w * 0.5) return c;
      if (c.depth - n.depth < 4) queue.push(...kids);
    }
    return n;
  }
  /** The centred content column (a container with max-width and auto margins). */
  function containerOf(nodes, n) {
    const queue = [n];
    while (queue.length) {
      const c = queue.shift();
      if (c.style.maxWidth !== 'none' && c.rect.w < innerWidth - 2 && Math.abs((c.rect.x - n.rect.x) - (n.rect.x + n.rect.w - c.rect.x - c.rect.w)) <= 2) {
        return { maxWidth: c.style.maxWidth, width: c.rect.w, padding: `${c.style.paddingTop} ${c.style.paddingRight} ${c.style.paddingBottom} ${c.style.paddingLeft}`, centred: true, selector: sel(c) };
      }
      if (c.depth - n.depth < 3) queue.push(...c.children.map(i => nodes[i]));
    }
    return null;
  }
  const sel = n => `${n.tag}${n.id ? `#${n.id}` : ''}${n.cls.slice(0, 2).map(c => `.${c}`).join('')}`;

  // ——— 4) repeated patterns ———
  /** A shape fingerprint: tag, stable classes, and the tags of its children. */
  const shapeOf = (nodes, n) => `${n.tag}|${n.cls.filter(c => !/\d/.test(c) || c.length < 4).sort().join('.')}|${n.children.map(i => nodes[i].tag).slice(0, 8).join(',')}`;
  const loose = (nodes, n) => `${n.tag}|${n.children.map(i => nodes[i].tag).slice(0, 8).join(',')}`;

  function nameFor(nodes, group, regionKind) {
    const n = group[0];
    const shared = n.cls.find(c => group.every(g => g.cls.includes(c)) && !/^(col|row|w-|h-|p-|m-|flex|grid|d-|text-|bg-)/.test(c));
    const pascal = s => s.replace(/(^|[-_\s]+)(\w)/g, (_, __, c) => c.toUpperCase()).replace(/[^\w]/g, '');
    if (n.role === 'tab') return 'Tab';
    if (n.tag === 'button' || n.role === 'button') return 'Button';
    if (n.tag === 'img' || (n.children.length === 1 && nodes[n.children[0]].tag === 'img' && regionKind !== 'nav')) return group.every(g => g.rect.h <= 80) ? 'Logo' : 'Image';
    if (shared) return pascal(shared);
    if (regionKind === 'nav' || regionKind === 'header') return n.tag === 'li' ? 'NavItem' : 'NavLink';
    if (n.tag === 'li') return 'ListItem';
    if (n.tag === 'article') return 'Card';
    return pascal(n.tag === 'div' ? 'Item' : n.tag);
  }

  function findPatterns(nodes, regionOf) {
    const found = [];
    for (const n of nodes) {
      const kids = n.children.map(i => nodes[i]).filter(k => !k.hidden && k.rect.w > 4 && k.rect.h > 4);
      if (kids.length < 2) continue;
      const groups = new Map();
      for (const k of kids) { const key = shapeOf(nodes, k); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(k); }
      // Siblings with the same structure but different modifier classes are variants of one component.
      const byLoose = new Map();
      for (const k of kids) { const key = loose(nodes, k); if (!byLoose.has(key)) byLoose.set(key, []); byLoose.get(key).push(k); }
      for (const [, list] of byLoose) {
        if (list.length < 3 && !(list.length === 2 && list[0].tag === 'button')) continue;
        if (list.some(k => k.rect.w >= innerWidth * 0.9) || ['body', 'main'].includes(n.tag)) continue; // page bands, not a component
        const sizes = list.map(k => k.rect.w);
        const similar = Math.max(...sizes) - Math.min(...sizes) <= Math.max(24, Math.min(...sizes) * 0.35) || n.style.display.includes('grid');
        if (!similar) continue;
        const region = regionOf(n);
        const variants = [...new Set(list.map(k => k.cls.join('.')))];
        found.push({ parent: n, items: list, region, variants });
      }
    }
    // Keep the outermost occurrence of each shape (a card's inner list isn't a separate pattern of the page).
    const seen = new Set();
    return found.filter(p => { const k = shapeOf(nodes, p.items[0]); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // ——— 5) naming regions and the outline ———
  const GENERIC = /^(section|container|wrapper|wrap|inner|outer|block|row|col|content|main|page|box|area|region|module|component|elementor|wp-block|sc-|css-|jsx-|_|[a-z]{1,2}\d|\w*\d{3,})/i;
  const titleCase = s => s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\w/, c => c.toUpperCase());
  function describeRegion(nodes, n, index, components) {
    const kind = kindOf(n);
    const inside = sub => { const out = []; const q = [n]; while (q.length) { const c = q.shift(); if (sub(c)) out.push(c); q.push(...c.children.map(i => nodes[i])); } return out; };
    const has = s => inside(c => c.el.matches?.(s)).length;
    let type = { header: 'Header', footer: 'Footer', nav: 'Navigation', sidebar: 'Sidebar', modal: 'Modal', main: 'Main' }[kind];
    const mine = components.filter(c => c.regionIndex === n.i);
    if (!type) {
      if (has('h1') && index === 0) type = 'Hero';
      else if (mine.some(c => c.name === 'Logo')) type = 'Logos strip';
      else if (has('[role="tablist"]')) type = 'Tabs';
      else if (has('form') && has('input, textarea')) type = 'Form';
      else if (has('canvas')) type = 'Canvas';
      else if (inside(c => (c.style.scrollSnapType && c.style.scrollSnapType !== 'none') || c.style.overflowX === 'auto').length && mine.length) type = 'Carousel';
      else if (mine.some(c => c.count >= 3)) type = `${mine.find(c => c.count >= 3).name} grid`;
      else if (inside(c => c.text > 0).length <= 2) type = 'Band';
      else type = 'Section';
    }
    const hint = n.id ? `#${n.id}` : n.cls[0] ? `.${n.cls[0]}` : '';
    // The developer's own name for it (an id or class, not page text) when it means something.
    const word = (n.id || n.cls[0] || '').toLowerCase();
    const named = word && !GENERIC.test(word) && word.length <= 24 && !['header', 'footer', 'nav', 'top', 'hero'].includes(word) ? titleCase(word) : null;
    const name = type === 'Hero' || kind !== 'section' ? type : named || type;
    return { kind, name, type, hint };
  }

  function outlineText(all) {
    const regions = all.filter(r => r.kind !== 'overlay' && r.kind !== 'floating');
    const extra = all.filter(r => r.kind === 'overlay' || r.kind === 'floating').map(r => `${r.name}${r.initiallyHidden ? ' (hidden until opened)' : r.position ? ` (${r.position.position})` : ''}`);
    return regions.map(r => {
      const bits = [];
      if (r.name !== r.type && !/grid$/.test(r.type)) bits.push(r.type.toLowerCase());
      if (r.position?.position === 'sticky' || r.position?.position === 'fixed') bits.push(r.position.position);
      if (r.kind === 'header' || r.kind === 'footer' || r.box.h < 120) bits.push(`${r.box.h}px`);
      const l = r.layout;
      const comp = r.components.slice().sort((a, b) => b.count - a.count)[0];
      const grid = l.grid?.columns >= 2 ? `${l.grid.columns}-col grid${!l.grid.template.startsWith('repeat') && l.grid.template.includes('fr') ? ` ${l.grid.template.replace(/fr/g, '').replace(/ /g, '/')}` : ''}` : null;
      if (comp && grid && comp.layout?.startsWith(`${l.grid.columns}-col`)) bits.push(comp.count >= l.grid.columns ? `${grid} of ${comp.name} ×${comp.count}` : `${grid}, ${comp.name} ×${comp.count}`);
      else {
        if (grid) bits.push(grid);
        else if (l.flex?.direction?.startsWith('row') && !comp) bits.push('row');
        if (comp) bits.push(`${comp.layout === 'flex row' ? 'row of ' : comp.layout ? `${comp.layout} of ` : ''}${comp.name} ×${comp.count}`);
      }
      return `${r.name}${bits.length ? ` (${bits.join(', ')})` : ''}`;
    }).join(' → ') + (extra.length ? `. Also: ${extra.join(', ')}.` : '');
  }

  // ——— the phase ———
  async function run(scan) {
    const { nodes, total, skipped } = await collect(scan);
    scan.nodes = nodes;
    scan.progress(0.4);
    // Deep mode: Chrome's own snapshot gives the true node count (iframes, shadow roots).
    let snapshotNodes = null;
    try {
      const snap = await scan.cdp.send('DOMSnapshot.captureSnapshot', { computedStyles: [], includeDOMRects: false });
      snapshotNodes = snap.documents.reduce((a, d) => a + d.nodes.nodeName.length, 0);
    } catch (_) { /* quick mode or an older Chrome */ }
    scan.check();

    const bodyIndex = 0;
    let bands = bandsOf(nodes, bodyIndex);
    // main → its own bands
    const flat = [];
    for (const b of bands) {
      if (kindOf(b) === 'main') { const inner = bandsOf(nodes, b.i); if (inner.length) { flat.push(...inner.map(x => ({ n: x, inMain: true }))); continue; } }
      flat.push({ n: b, inMain: false });
    }
    // Overlays (closed dialogs/drawers) and floating elements (small fixed things: back-to-top, chat bubbles)
    // are listed after the page flow, not in it.
    for (const f of flat) {
      const n = f.n;
      if (kindOf(n) === 'modal' || (n.hidden && (n.style.position === 'fixed' || n.style.position === 'absolute' || kindOf(n) === 'nav'))) f.overlay = true;
      else if (n.style.position === 'fixed' && n.rect.w < innerWidth * 0.6) f.floating = true;
    }
    const regionSet = new Set(flat.map(f => f.n.i));
    const floating = nodes.filter(n => n.style.position === 'fixed' && !regionSet.has(n.i) && !flat.some(f => isInside(nodes, n, f.n)) && n.rect.w > 0);
    for (const f of floating) flat.push({ n: f, inMain: false, floating: true });
    flat.sort((a, b) => (a.overlay || a.floating ? 1 : 0) - (b.overlay || b.floating ? 1 : 0)); // page flow first, stable

    const regionOfIndex = new Map();
    flat.forEach((f, idx) => { const stack = [f.n.i]; while (stack.length) { const i = stack.pop(); if (!regionOfIndex.has(i)) regionOfIndex.set(i, idx); stack.push(...nodes[i].children); } });
    const patterns = findPatterns(nodes, n => regionOfIndex.get(n.i));
    const components = patterns.map((p, k) => {
      const region = flat[p.region]?.n;
      const kind = region ? kindOf(region) : 'section';
      const name = nameFor(nodes, p.items, kind);
      const parentLayout = layoutOf(p.parent);
      const first = p.items[0];
      return {
        id: `c${k + 1}`, name, count: p.items.length, regionIndex: region?.i,
        selector: sel(first), parentSelector: sel(p.parent),
        layout: parentLayout.grid ? `${parentLayout.grid.columns}-col grid` : parentLayout.flex ? `flex ${parentLayout.flex.direction}` : null,
        variants: p.variants.length > 1 ? p.variants.map(v => v || '(no class)') : [],
        size: { w: first.rect.w, h: first.rect.h },
        items: p.items, // live (not serialised)
      };
    });

    let flowIndex = 0;
    const regions = flat.map((f, index) => {
      const n = f.n;
      const d = describeRegion(nodes, n, f.overlay || f.floating ? -1 : (kindOf(n) === 'section' ? flowIndex++ : flowIndex), components);
      const lr = layoutRoot(nodes, n);
      const r = {
        id: `r${index + 1}`, kind: f.floating ? 'floating' : f.overlay ? 'overlay' : d.kind, name: f.floating ? floatName(n) : f.overlay ? overlayName(n) : d.name, type: d.type, hint: d.hint, selector: sel(n),
        order: index + 1, inMain: f.inMain, initiallyHidden: n.hidden,
        box: { x: n.rect.x, y: n.rect.y, w: n.rect.w, h: n.rect.h },
        layout: layoutOf(lr), layoutSelector: lr === n ? null : sel(lr),
        position: positionOf(n),
        container: containerOf(nodes, n),
        components: components.filter(c => c.regionIndex === n.i).map(c => ({ id: c.id, name: c.name, count: c.count, layout: c.layout })),
        children: summariseChildren(nodes, lr),
        el: n.el, node: n, layoutEl: lr.el,
      };
      return r;
    });
    scan.regions = regions;
    scan.components = components;

    scan.spec.structure = {
      nodes: { domNodes: snapshotNodes, elements: total, analysed: nodes.length, skipped, cap: D.MAX_NODES },
      outline: outlineText(regions),
      regions: regions.map(({ el, node, layoutEl, ...r }) => r),
      components: components.map(({ items, regionIndex, ...c }) => ({ ...c, region: regions.find(r => r.node.i === regionIndex)?.id || null })),
    };
    if (nodes.length >= D.MAX_NODES) scan.spec.notes.push(`Large page: ${D.MAX_NODES} elements were analysed in detail; the rest (${skipped}) is only summarised.`);
  }

  const floatName = n => (n.tag === 'button' || n.el.querySelector?.('button') ? 'Floating button' : 'Floating element');
  const overlayName = n => (kindOf(n) === 'modal' ? 'Modal dialog' : kindOf(n) === 'nav' ? 'Navigation drawer' : 'Overlay');

  function isInside(nodes, n, ancestor) {
    for (let p = n.parent; p !== null; p = nodes[p].parent) if (p === ancestor.i) return true;
    return false;
  }

  /** The visible children of a layout element, as short descriptors (what sits in each column/cell). */
  function summariseChildren(nodes, n) {
    return n.children.map(i => nodes[i]).filter(k => !k.hidden).slice(0, 12).map(k => ({
      selector: sel(k), w: k.rect.w, h: k.rect.h,
      role: k.tag.match(/^h[1-6]$/) ? 'heading' : k.tag === 'img' || k.tag === 'picture' ? 'image' : k.tag === 'canvas' ? 'canvas' : k.tag === 'form' ? 'form' : k.tag === 'nav' ? 'nav' : k.tag === 'ul' || k.tag === 'ol' ? 'list' : k.tag === 'a' || k.tag === 'button' ? 'control' : 'block',
    }));
  }

  Mochi.deepStructure = { collect, fitColumns, layoutOf, kindOf, bandsOf, findPatterns, sel };
  D.addPhase({ id: 'structure', order: 10, cdp: true, label: 'deep.step.structure', budget: 25000, weight: 2, run });
})();
