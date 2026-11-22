/*
 * Mochi — Deep Scan, Task 3b: the UI components (buttons and their variants,
 * inputs, badges, tabs, accordions, dropdowns, modals, nav items, cards…):
 * for each, only the styles that differ from the browser's defaults (no
 * noise), the tokens they use, and their icons (size, stroke/fill, placement;
 * the icon itself becomes a placeholder unless "this is my own site").
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const D = Mochi.deepScan;
  const PROPS = ['display', 'height', 'minHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'backgroundColor', 'backgroundImage', 'color',
    'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius',
    'boxShadow', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textTransform', 'textAlign', 'textDecorationLine', 'whiteSpace',
    'columnGap', 'alignItems', 'justifyContent', 'opacity', 'transform', 'transition', 'cursor', 'outlineStyle', 'outlineWidth', 'outlineColor', 'outlineOffset', 'overflow', 'backdropFilter', 'filter'];
  const INHERITED = new Set(['color', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textTransform', 'textAlign', 'whiteSpace', 'cursor']);
  const kebab = s => s.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);

  // ——— browser defaults, from a blank frame inside Mochi's own layer (the page is not touched) ———
  let frame = null;
  const defaults = new Map();
  function defaultsFor(tag, scan) {
    if (defaults.has(tag)) return defaults.get(tag);
    let out = {};
    try {
      if (!frame) {
        frame = document.createElement('iframe');
        frame.setAttribute('aria-hidden', 'true');
        frame.style.cssText = 'position:fixed;left:-9999px;top:0;width:400px;height:300px;border:0;visibility:hidden';
        (scan.ignore.shadowRoot || Mochi.debug?.companion?.shadow || scan.ignore).append(frame);
        frame.contentDocument.open(); frame.contentDocument.write('<!doctype html><html><body></body></html>'); frame.contentDocument.close();
      }
      const doc = frame.contentDocument;
      const el = doc.createElement(tag);
      if (tag === 'button' || tag === 'a') el.textContent = 'x';
      doc.body.append(el);
      const cs = frame.contentWindow.getComputedStyle(el);
      for (const p of PROPS) out[p] = cs[p];
      el.remove();
    } catch (_) { out = {}; }
    defaults.set(tag, out);
    return out;
  }
  function dropFrame() { frame?.remove(); frame = null; defaults.clear(); }

  /** The styles that make this element look like it does: not defaults, not just inherited. */
  function styleDiff(el, scan) {
    const cs = getComputedStyle(el);
    const parent = el.parentElement ? getComputedStyle(el.parentElement) : null;
    const def = defaultsFor(el.tagName.toLowerCase(), scan);
    const out = {};
    for (const p of PROPS) {
      const v = cs[p];
      if (v === def[p]) continue;
      if (INHERITED.has(p) && parent && parent[p] === v && el.tagName !== 'BUTTON' && el.tagName !== 'INPUT') continue;
      if (p === 'height' && (cs.display === 'inline' || v === 'auto')) continue;
      if (p === 'minHeight' && v === 'auto') continue;
      // A running animation's in-between value is not the component's style (the motion section has it).
      if ((p === 'transform' || p === 'opacity') && el.getAnimations?.().some(a => a.playState === 'running' && !(a instanceof CSSTransition))) continue;
      if (p === 'transition' && /^all 0s/.test(v)) continue;
      if ((p.startsWith('border') && p.endsWith('Width')) && v === '0px') continue;
      if (p === 'borderTopStyle' && v === 'none') continue;
      if (p === 'borderTopColor' && parseFloat(cs.borderTopWidth) === 0) continue;
      if (p.startsWith('outline') && cs.outlineStyle === 'none') continue;
      out[kebab(p)] = v;
    }
    // Shorten 4-sided values (if one side differs from the default, show all four).
    const camel = k => k.replace(/-(\w)/g, (_, c) => c.toUpperCase());
    const four = (name, keys) => { if (keys.some(k => out[k] !== undefined)) keys.forEach(k => { if (out[k] === undefined) out[k] = cs[camel(k)]; }); const v = keys.map(k => out[k]); if (v.every(x => x !== undefined)) { keys.forEach(k => delete out[k]); out[name] = v.every(x => x === v[0]) ? v[0] : v[0] === v[2] && v[1] === v[3] ? `${v[0]} ${v[1]}` : v.join(' '); } };
    four('padding', ['padding-top', 'padding-right', 'padding-bottom', 'padding-left']);
    four('border-radius', ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius']);
    if (out['border-top-width'] && ['border-right-width', 'border-bottom-width', 'border-left-width'].every(k => out[k] === out['border-top-width'] || out[k] === undefined && false)) {
      out.border = `${out['border-top-width']} ${out['border-top-style'] || cs.borderTopStyle} ${out['border-top-color'] || cs.borderTopColor}`;
      ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-top-style', 'border-top-color'].forEach(k => delete out[k]);
    }
    return out;
  }

  /** Which of the site's CSS variables a component's values are (value → var name). */
  function tokenLinks(styles, scan) {
    const vars = scan.spec.tokens?.customProperties || {};
    const isColor = v => /^(#|rgb|hsl|oklch|oklab|lab\(|lch\(|color\()/i.test(String(v).trim());
    const norm = v => { if (!isColor(v)) return String(v).trim(); const c = Mochi.color.parseColor(v); return c ? Mochi.color.hex(c) : String(v).trim(); };
    const byValue = new Map(Object.entries(vars).map(([k, v]) => [norm(v), k]));
    const links = {};
    for (const [prop, v] of Object.entries(styles)) {
      // A colour anywhere in the value (a border's or a shadow's colour), or the exact length —
      // but a length only links to a variable whose name fits the property (--radius ↔ border-radius).
      const colorHit = String(v).match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}\b/gi)?.map(norm).map(c => byValue.get(c)).find(Boolean);
      const exact = byValue.get(norm(v));
      const fits = name => {
        if (!name) return false;
        if (isColor(vars[name])) return true;
        const family = /radius/.test(prop) ? /radius|round|corner/ : /padding|margin|gap/.test(prop) ? /space|gap|pad|gutter|margin|size/ : /font|line-height|letter/.test(prop) ? /font|text|type|size|leading|tracking|line/ : /shadow/.test(prop) ? /shadow|elev/ : /^(width|height|max-width|min-height)$/.test(prop) ? /width|height|size|container|max/ : null;
        return !!family && family.test(name);
      };
      const hit = (exact && fits(exact) && exact) || colorHit;
      if (hit) links[prop] = `var(${hit})`;
    }
    return links;
  }

  function iconOf(el) {
    const icon = el.querySelector('svg, i[class*="icon"], span[class*="icon"], img[width="16"], img[width="20"], img[width="24"]');
    if (!icon) return null;
    const r = icon.getBoundingClientRect(), host = el.getBoundingClientRect();
    if (r.width > 48 || r.width === 0) return null;
    const cs = getComputedStyle(icon);
    const path = icon.querySelector?.('path, circle, rect, line, polyline');
    const pcs = path ? getComputedStyle(path) : cs;
    const stroke = pcs.stroke && pcs.stroke !== 'none' ? { stroke: pcs.stroke, strokeWidth: pcs.strokeWidth } : null;
    const textBefore = [...el.childNodes].indexOf(icon) > 0 && el.textContent.trim().length > 0;
    return {
      size: `${Math.round(r.width)}×${Math.round(r.height)}`,
      style: stroke ? `outline (stroke ${stroke.strokeWidth})` : 'filled',
      color: stroke ? stroke.stroke : pcs.fill || cs.color,
      placement: !el.textContent.trim() ? 'icon only' : textBefore ? 'after the text' : r.top - host.top > host.height * 0.4 ? 'below' : 'before the text / top-left',
      offset: { x: Math.round(r.left - host.left), y: Math.round(r.top - host.top) },
      placeholder: 'a generic icon of the same size and style',
    };
  }

  // ——— finding components ———
  const sigOf = cs => [cs.backgroundColor, cs.color, cs.borderTopWidth, cs.borderTopColor, cs.borderTopLeftRadius, Math.round(parseFloat(cs.height) / 4), cs.fontSize, cs.fontWeight].join('|');
  function variantName(cs) {
    const bg = Mochi.color.parseColor(cs.backgroundColor);
    const border = parseFloat(cs.borderTopWidth) > 0;
    if (bg && Mochi.color.isSaturated(bg)) return 'primary';
    if (bg && Mochi.color.luminance(bg) < 0.12) return 'dark';
    if (border) return 'secondary (outlined)';
    if (!bg) return cs.textDecorationLine.includes('underline') ? 'link' : 'ghost';
    return 'secondary';
  }

  const KINDS = [
    ['button', 'button:not([role="tab"]):not(.accordion-trigger), a.btn, a[class*="button"], a[class*="btn"], [role="button"], input[type="submit"], input[type="button"]'],
    ['input', 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea, select'],
    ['checkbox', 'input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="switch"]'],
    ['tab', '[role="tab"]'],
    ['accordion', 'button[aria-expanded][aria-controls]:not([aria-haspopup]), summary'],
    ['dropdown', '[aria-haspopup]:not([aria-haspopup="dialog"])'],
    ['modal', 'dialog, [role="dialog"], [aria-modal="true"]'],
    ['badge', '[class*="badge"], [class*="chip"], [class*="tag"]:not(html):not(body), [class*="pill"]'],
    ['navItem', 'nav a, [role="navigation"] a, header nav a'],
  ];

  async function run(scan) {
    const out = [];
    const used = new Set();
    let k = 0;
    try {
      for (const [type, selector] of KINDS) {
        const els = [...document.querySelectorAll(selector)].filter(el => !scan.ignore.contains(el) && !used.has(el));
        const groups = new Map();
        for (const el of els) {
          const cs = getComputedStyle(el);
          const visible = el.getBoundingClientRect().width > 0 || type === 'modal' || type === 'dropdown';
          if (!visible) continue;
          const key = type === 'button' ? sigOf(cs) : type;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(el);
        }
        for (const [, list] of groups) {
          const el = list.find(e => e.getBoundingClientRect().width > 0) || list[0];
          list.forEach(e => used.add(e));
          const cs = getComputedStyle(el);
          const styles = styleDiff(el, scan);
          const r = el.getBoundingClientRect();
          out.push({
            id: `ui${out.length + 1}`, type, variant: type === 'button' ? variantName(cs) : null,
            selector: Mochi.deepStructure.sel({ tag: el.tagName.toLowerCase(), id: el.id || null, cls: [...el.classList].filter(c => !/^(is-|has-|active|open|show)/.test(c)).slice(0, 3) }),
            count: list.length, size: { w: Math.round(r.width), h: Math.round(r.height) },
            styles, tokens: tokenLinks(styles, scan), icon: iconOf(el),
            text: scan.opts.ownSite ? el.textContent.trim().replace(/\s+/g, ' ').slice(0, 60) : `[${el.textContent.trim().length} chars]`,
            els: list, // live (not serialised)
          });
          if (++k % 10 === 0) await scan.breathe();
        }
      }
      // Cards and other repeated components from the structure map get their styles too.
      for (const c of scan.components || []) {
        const el = c.items[0]?.el;
        if (!el || used.has(el)) continue;
        const styles = styleDiff(el, scan);
        if (!Object.keys(styles).length) continue;
        out.push({ id: `ui${out.length + 1}`, type: 'repeated', name: c.name, variant: null, selector: Mochi.deepStructure.sel(c.items[0]), count: c.count, size: { w: c.size.w, h: c.size.h }, styles, tokens: tokenLinks(styles, scan), icon: iconOf(el), els: c.items.map(i => i.el), structureId: c.id });
      }
    } finally { dropFrame(); }
    // Several sizes of the same button variant: name them small / medium / large.
    const byVariant = new Map();
    for (const c of out.filter(c => c.type === 'button')) { if (!byVariant.has(c.variant)) byVariant.set(c.variant, []); byVariant.get(c.variant).push(c); }
    for (const list of byVariant.values()) {
      if (list.length < 2) continue;
      const hs = [...new Set(list.map(c => c.size.h))].sort((a, b) => a - b);
      if (hs.length < 2) continue;
      for (const c of list) c.size.name = hs.length === 2 ? (c.size.h === hs[0] ? 'small' : 'large') : ['small', 'medium', 'large'][Math.min(2, hs.indexOf(c.size.h))];
    }
    scan.ui = out;
    scan.spec.components = out.map(({ els, ...c }) => c);
  }

  Mochi.deepComponents = { styleDiff, tokenLinks, iconOf, variantName };
  D.addPhase({ id: 'components', order: 45, cdp: false, label: 'deep.step.components', budget: 15000, weight: 1, run });
})();
