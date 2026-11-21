/*
 * Mochi — UI scan. Reads the design of the page you're on: colors,
 * typography, shape, spacing, layout, components and effects.
 *
 * Runs only when you pick "Scan this UI" in Mochi's menu. Everything is
 * computed here, in the page, from getComputedStyle + getBoundingClientRect
 * of visible elements. No text content is collected (only how long a text
 * is, to weigh its color), and nothing is sent anywhere.
 *
 * Fast and gentle: at most MAX_ELEMENTS visible elements, at most
 * CPU_BUDGET ms of work, done in small chunks that yield to the page so it
 * never freezes.
 *
 *   const scan = await Mochi.scanUI({ ignore: hostElement })
 *
 * The result's shape is documented at the bottom of this file (see SHAPE).
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  const MAX_ELEMENTS = 1500;
  const CPU_BUDGET = 250; // ms of real work
  const CHUNK_MS = 12; // work per slice before yielding to the page
  const MERGE_DISTANCE = 26; // RGB distance under which two colors are "the same"
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'BR', 'WBR']);

  // ——— colors ———
  const colorCache = new Map();
  let probe = null;

  /** Any CSS color string → {r,g,b,a} (0–255, a 0–1), or null for transparent / unknown. */
  function parseColor(str) {
    if (!str || str === 'transparent' || str === 'none') return null;
    if (colorCache.has(str)) return colorCache.get(str);
    let out = null;
    const m = str.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
    if (m) {
      let a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      out = { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]), a };
    } else {
      // oklch(), color(display-p3 …), lab() …: let a canvas convert it.
      try {
        probe = probe || document.createElement('canvas').getContext('2d', { willReadFrequently: true });
        probe.clearRect(0, 0, 1, 1);
        probe.fillStyle = '#000';
        probe.fillStyle = str;
        probe.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
        out = { r, g, b, a: a / 255 };
      } catch (_) { out = null; }
    }
    if (out && out.a < 0.02) out = null;
    colorCache.set(str, out);
    return out;
  }
  const hex = ({ r, g, b }) => `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  const dist = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  function hsl({ r, g, b }) {
    const R = r / 255, G = g / 255, B = b / 255;
    const max = Math.max(R, G, B), min = Math.min(R, G, B);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    return { h: h * 60, s, l };
  }
  function luminance({ r, g, b }) {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const isSaturated = c => { const { s, l } = hsl(c); return s > 0.38 && l > 0.18 && l < 0.86; };
  /** Paints a translucent color over a background, as the eye sees it. */
  const over = (c, bg) => (c.a >= 0.99 || !bg ? c : {
    r: Math.round(c.r * c.a + bg.r * (1 - c.a)), g: Math.round(c.g * c.a + bg.g * (1 - c.a)), b: Math.round(c.b * c.a + bg.b * (1 - c.a)), a: 1,
  });

  // ——— small helpers ———
  const px = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  // ——— fonts: the family a page really renders, and its stack ———
  const GENERIC = /^(system-ui|-apple-system|blinkmacsystemfont|sans-serif|serif|monospace|cursive|fantasy|ui-sans-serif|ui-serif|ui-monospace|ui-rounded|emoji|math|fangsong|inherit|initial)$/i;
  /** "__Inter_d65c78, __Inter_Fallback_d65c78, system-ui" → ['Inter', 'system-ui'] (Next.js hashes and "Fallback" faces dropped). */
  function cleanStack(list) {
    const seen = new Set();
    const out = [];
    for (const raw of String(list || '').split(',')) {
      let name = raw.trim().replace(/^["']|["']$/g, '');
      const hashed = name.match(/^__(.+?)_[0-9a-f]{5,8}$/i);
      if (hashed) name = hashed[1].replace(/_/g, ' ');
      if (!name || /fallback/i.test(name)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
      if (out.length >= 5) break;
    }
    return out.length ? out : ['system-ui'];
  }
  const fontAvailable = new Map();
  let fontProbe = null;
  /** True when the browser really has this font (installed or loaded web font): its text measures differently from the fallbacks. */
  function isAvailable(name) {
    if (GENERIC.test(name)) return true;
    if (fontAvailable.has(name)) return fontAvailable.get(name);
    let ok = false;
    // A web font the page has loaded counts right away.
    try {
      for (const face of document.fonts) {
        if (face.status === 'loaded' && face.family.replace(/^["']|["']$/g, '').toLowerCase() === name.toLowerCase()) { fontAvailable.set(name, true); return true; }
      }
    } catch (_) { /* no FontFaceSet: measure instead */ }
    try {
      fontProbe = fontProbe || document.createElement('canvas').getContext('2d');
      const text = 'mmmmmmmmmmlli1WwQq@#&ÆgjÅ';
      for (const base of ['monospace', 'serif', 'sans-serif']) {
        fontProbe.font = `72px ${base}`;
        const plain = fontProbe.measureText(text).width;
        fontProbe.font = `72px "${name.replace(/"/g, '')}", ${base}`;
        if (Math.abs(fontProbe.measureText(text).width - plain) > 0.5) { ok = true; break; }
      }
    } catch (_) { ok = false; }
    fontAvailable.set(name, ok);
    return ok;
  }
  const familyCache = new Map();
  /** { name, stack }: name is the first family in the stack the page can actually render. */
  function familyOf(list) {
    if (familyCache.has(list)) return familyCache.get(list);
    const stack = cleanStack(list);
    const used = stack.find(n => !GENERIC.test(n) && isAvailable(n)) || stack.find(n => GENERIC.test(n)) || stack[0];
    const out = { name: /^(-apple-system|blinkmacsystemfont)$/i.test(used) ? 'system-ui' : used, stack };
    familyCache.set(list, out);
    return out;
  }
  const firstFamily = list => familyOf(list).name;
  const tally = () => new Map();
  const bump = (map, key, w = 1) => map.set(key, (map.get(key) || 0) + w);
  const top = (map, n) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n);
  const round = (v, step = 1) => Math.round(v / step) * step;
  const sleep = () => new Promise(r => setTimeout(r, 0));
  const MONO = /mono|code|courier|consolas|menlo|monaco|fira code|jetbrains|ibm plex mono|sf mono|ui-monospace|monospace/i;
  const SERIF = /serif|georgia|times|garamond|playfair|merriweather|lora|baskerville|didot|bodoni|cormorant|libre caslon|crimson|dm serif|fraunces|newsreader|tiempos|charter|cambria|ui-serif/i;
  const SANS_HINT = /sans|inter|helvetica|arial|roboto|system-ui|segoe|geist|manrope|poppins|nunito|montserrat|open sans|lato/i;
  const PIXEL = /press start|pixel|vt323|silkscreen|8.?bit|retro gaming|pixelify|tiny5|jersey|micro 5|handjet/i;
  const ROUNDED = /nunito|quicksand|fredoka|baloo|varela round|comfortaa|rubik|ui-rounded|sf pro rounded|mplus rounded|chewy|bubblegum/i;
  const isSerif = fam => SERIF.test(fam) && !/sans/i.test(fam);

  function isVisible(el, cs, rect) {
    if (rect.width < 1 || rect.height < 1) return false;
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || +cs.opacity < 0.05) return false;
    if (rect.bottom < 0 || rect.right < 0 || rect.left > innerWidth || rect.top > innerHeight * 2.5) return false;
    return true;
  }
  const directTextLength = el => {
    let n = 0;
    for (const node of el.childNodes) if (node.nodeType === 3) n += node.data.trim().length;
    return n;
  };
  const visibleArea = rect => {
    const w = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
    const h = Math.max(0, Math.min(rect.bottom, innerHeight * 2.5) - Math.max(rect.top, 0));
    return w * h;
  };
  const isButtonLike = (el, cs) =>
    el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' ||
    (el.tagName === 'INPUT' && /^(submit|button|reset)$/i.test(el.type)) ||
    (el.tagName === 'A' && (px(cs.paddingLeft) >= 8 && px(cs.paddingTop) >= 4) && (parseColor(cs.backgroundColor) || px(cs.borderTopWidth) > 0));

  /** One element's style, as the scan keeps it. */
  function styleOf(cs, rect, pageBg) {
    const bg = parseColor(cs.backgroundColor);
    const bw = px(cs.borderTopWidth);
    const bc = bw > 0 && cs.borderTopStyle !== 'none' ? parseColor(cs.borderTopColor) : null;
    const radius = px(cs.borderTopLeftRadius);
    return {
      bg: bg ? hex(over(bg, pageBg)) : 'transparent',
      color: hex(over(parseColor(cs.color) || { r: 0, g: 0, b: 0, a: 1 }, pageBg)),
      radius: radius >= Math.min(rect.width, rect.height) / 2 - 1 && radius > 0 ? '9999px' : `${round(radius)}px`,
      padding: `${round(px(cs.paddingTop))}px ${round(px(cs.paddingRight))}px`,
      shadow: cs.boxShadow === 'none' ? 'none' : cs.boxShadow,
      border: bc ? `${round(bw)}px ${cs.borderTopStyle} ${hex(over(bc, pageBg))}` : 'none',
      font: `${cs.fontWeight} ${round(px(cs.fontSize))}px ${firstFamily(cs.fontFamily)}`,
      height: Math.round(rect.height),
    };
  }
  const signature = s => `${s.bg}|${s.color}|${s.radius}|${s.border}|${s.shadow}`;

  // ——— the scan ———
  async function scanUI({ ignore = null } = {}) {
    const wall0 = performance.now();
    let cpu = 0;
    let slice0 = performance.now();

    const root = document.body || document.documentElement;
    const rootCs = getComputedStyle(root);
    const htmlBg = parseColor(getComputedStyle(document.documentElement).backgroundColor);
    const bodyBg = parseColor(rootCs.backgroundColor);
    // A page painted with a gradient and no flat color: take the gradient's first color.
    const gradientBg = () => {
      for (const image of [rootCs.backgroundImage, getComputedStyle(document.documentElement).backgroundImage]) {
        const first = image && image.includes('gradient(') && image.match(/rgba?\([^)]*\)/);
        if (first) return parseColor(first[0]);
      }
      return null;
    };
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const pageBg = over(bodyBg || htmlBg || gradientBg() || white, htmlBg && htmlBg.a >= 0.99 ? htmlBg : white);

    const bgColors = [];
    const textColors = [];
    const borderColors = [];
    const accentColors = [];
    const fontsBody = tally(), fontsHead = tally(), fontsAll = tally(), fontsCode = tally();
    const stacks = new Map();
    let glassCount = 0, glassHeader = 0, glassArea = 0, glassPanels = 0;
    const sizes = tally(), weights = tally();
    const headWeights = tally();
    let headLine = [], headSpacing = [];
    let bodySize = tally(), bodyLine = tally(), bodyWeight = tally();
    const radii = tally(), shadows = tally(), borderWidths = tally(), spacing = tally(), maxWidths = tally();
    const gradients = tally();
    const buttons = [], cards = [], inputs = [], badges = [];
    let navbar = null, stickyHeader = false;
    let flex = 0, grid = 0, columns = 1;
    let glassBlur = 0, transitions = 0, animations = 0, bgImages = 0, noise = false, translucent = 0;
    let headingMax = 0;
    let count = 0, capped = false, walked = 0;

    // What the eye sees: sample a grid of points and take the first painted
    // background under each (images skipped). This counts each pixel once,
    // so nested boxes don't add up, and a transparent <body> doesn't read as white.
    const painted = [];
    const COLS = 12, ROWS = 8;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = ((c + 0.5) * innerWidth) / COLS;
        const y = ((r + 0.5) * innerHeight) / ROWS;
        let color = null;
        for (const hit of document.elementsFromPoint(x, y)) {
          if (hit === ignore || hit.closest?.('[data-mochi-ignore]')) continue;
          const hcs = getComputedStyle(hit);
          if (/^(IMG|VIDEO|CANVAS|PICTURE|IFRAME)$/.test(hit.tagName) || (hcs.backgroundImage.includes('url(') && !hcs.backgroundImage.includes('gradient('))) { color = 'image'; break; }
          const hb = parseColor(hcs.backgroundColor);
          if (hb && hb.a >= 0.5) { color = over(hb, pageBg); break; }
          const g = hcs.backgroundImage.includes('gradient(') && hcs.backgroundImage.match(/rgba?\([^)]*\)/);
          if (g) { const gc = parseColor(g[0]); if (gc) { color = over(gc, pageBg); break; } }
        }
        painted.push(color || pageBg);
      }
    }
    const cell = (innerWidth * innerHeight) / (COLS * ROWS);
    const paintedColors = painted.filter(c => c !== 'image').map(c => ({ c, w: cell }));
    cpu += performance.now() - slice0;
    await sleep();
    slice0 = performance.now();

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (node === ignore || SKIP_TAGS.has(node.tagName) || node.hasAttribute('data-mochi-ignore')) return NodeFilter.FILTER_REJECT;
        if (node.namespaceURI === 'http://www.w3.org/2000/svg' && node.tagName.toLowerCase() !== 'svg') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let el = root;
    while (el) {
      walked++;
      const cs = getComputedStyle(el);
      if (cs.display === 'none') {
        // Nothing inside a display:none element is visible: skip its subtree.
        let next = walker.nextSibling();
        while (!next && walker.parentNode()) next = walker.nextSibling();
        el = next;
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.top > innerHeight * 2.5 && cs.position !== 'fixed' && cs.position !== 'sticky') {
        // Far below what's on screen: skip this whole section.
        let next = walker.nextSibling();
        while (!next && walker.parentNode()) next = walker.nextSibling();
        el = next;
        continue;
      }
      if (isVisible(el, cs, rect)) {
        count++;
        collect(el, cs, rect);
        if (count >= MAX_ELEMENTS) { capped = true; break; }
      }
      // Yield to the page now and then so it never freezes.
      if ((walked & 31) === 0) {
        const now = performance.now();
        if (now - slice0 > CHUNK_MS) {
          cpu += now - slice0;
          if (cpu > CPU_BUDGET) { capped = true; break; }
          await sleep();
          slice0 = performance.now();
        }
      }
      el = walker.nextNode();
    }
    cpu += performance.now() - slice0;

    function collect(el, cs, rect) {
      const area = visibleArea(rect);
      const tag = el.tagName;
      const fs = px(cs.fontSize);
      const famInfo = familyOf(cs.fontFamily);
      const fam = famInfo.name;
      stacks.set(fam, famInfo.stack);

      // Colors.
      const bg = parseColor(cs.backgroundColor);
      if (bg) {
        if (bg.a < 0.85 && bg.a > 0.04) translucent++;
        bgColors.push({ c: over(bg, pageBg), w: area * (bg.a < 0.5 ? 0.5 : 1), el, cs, rect });
      }
      const textLen = directTextLength(el);
      if (textLen > 0) {
        const fg = parseColor(cs.color);
        if (fg) textColors.push({ c: over(fg, pageBg), w: textLen * fs, fs });
        // Code samples say which mono font a page uses, not its body font.
        const inCode = !!el.closest('pre, code, kbd, samp');
        if (inCode) bump(fontsCode, fam, textLen);
        else {
        bump(sizes, round(fs), textLen);
        bump(weights, +cs.fontWeight || 400, textLen);
        bump(fontsAll, fam, textLen * fs);
        const isHeading = /^H[1-6]$/.test(tag) || (fs >= 22 && (+cs.fontWeight || 400) >= 500);
        if (isHeading) {
          bump(fontsHead, fam, textLen * fs);
          bump(headWeights, +cs.fontWeight || 400, textLen);
          const lh = cs.lineHeight === 'normal' ? 1.2 : px(cs.lineHeight) / fs;
          headLine.push(lh);
          headSpacing.push(cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing) / fs);
          headingMax = Math.max(headingMax, fs);
        } else if (fs >= 12 && fs <= 20) {
          bump(fontsBody, fam, textLen);
          bump(bodySize, round(fs), textLen);
          bump(bodyLine, cs.lineHeight === 'normal' ? 1.4 : Math.round((px(cs.lineHeight) / fs) * 20) / 20, textLen);
          bump(bodyWeight, +cs.fontWeight || 400, textLen);
        }
        }
      }
      const bw = px(cs.borderTopWidth);
      if (bw > 0 && cs.borderTopStyle !== 'none') {
        const bc = parseColor(cs.borderTopColor);
        if (bc) borderColors.push({ c: over(bc, pageBg), w: (rect.width + rect.height) * 2 * bw });
        bump(borderWidths, round(bw), 1);
      }

      const buttonish = isButtonLike(el, cs);
      if (buttonish || tag === 'A') {
        const fg = parseColor(cs.color);
        const candidates = [];
        if (bg) candidates.push(over(bg, pageBg));
        if (fg && (tag === 'A' || !bg)) candidates.push(over(fg, pageBg));
        for (const c of candidates) {
          if (isSaturated(c)) accentColors.push({ c, w: Math.max(area, 400) * (buttonish ? 3 : 1) });
        }
      }

      // Shape.
      const radius = px(cs.borderTopLeftRadius);
      const hasSurface = bg || bw > 0 || cs.boxShadow !== 'none';
      if (hasSurface && radius > 0) bump(radii, radius >= Math.min(rect.width, rect.height) / 2 - 1 ? 9999 : round(radius), 1);
      else if (hasSurface && area > 2500) bump(radii, 0, 0.35);
      if (cs.boxShadow && cs.boxShadow !== 'none') bump(shadows, cs.boxShadow, 1);

      // Spacing.
      for (const v of [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft, cs.marginTop, cs.marginBottom, cs.rowGap, cs.columnGap]) {
        const n = round(px(v));
        if (n > 0 && n <= 128) bump(spacing, n, 1);
      }

      // Layout.
      const display = cs.display;
      if (display.includes('flex')) flex++;
      if (display.includes('grid')) {
        grid++;
        if (rect.width > innerWidth * 0.45) {
          const tracks = cs.gridTemplateColumns.split(/\s+(?![^(]*\))/).filter(t => t && t !== 'none').length;
          if (tracks > 1) columns = Math.max(columns, Math.min(tracks, 12));
        }
      } else if (display.includes('flex') && !cs.flexDirection.startsWith('column') && rect.width > innerWidth * 0.5) {
        const kids = [...el.children].filter(k => { const r = k.getBoundingClientRect(); return r.width > rect.width * 0.18 && r.height > 60; });
        if (kids.length >= 2 && kids.length <= 6) columns = Math.max(columns, kids.length);
      }
      const mw = px(cs.maxWidth);
      if (mw >= 480 && mw <= 2400 && rect.width >= mw * 0.9) bump(maxWidths, round(mw), rect.width);
      if ((cs.position === 'sticky' || cs.position === 'fixed') && rect.top <= 12 && rect.width >= innerWidth * 0.75 && rect.height < 180) stickyHeader = true;

      // Components.
      if (buttonish && rect.height < 90 && rect.width < 480) buttons.push(styleOf(cs, rect, pageBg));
      if (!navbar && (tag === 'NAV' || tag === 'HEADER' || el.getAttribute('role') === 'navigation') && rect.top < 160 && rect.width >= innerWidth * 0.6) {
        navbar = { ...styleOf(cs, rect, pageBg), sticky: cs.position === 'sticky' || cs.position === 'fixed', blur: /blur/.test(cs.backdropFilter || cs.webkitBackdropFilter || '') };
      }
      if ((tag === 'INPUT' && /^(text|email|search|password|url|tel|number)$/i.test(el.type || 'text')) || tag === 'TEXTAREA' || tag === 'SELECT') inputs.push(styleOf(cs, rect, pageBg));
      if (/^(DIV|ARTICLE|SECTION|LI|ASIDE|A)$/.test(tag) && !buttonish && rect.width >= 140 && rect.width <= Math.min(900, innerWidth * 0.9) && rect.height >= 70 && el.children.length >= 2 &&
          (radius > 0 || cs.boxShadow !== 'none') && (bg || bw > 0 || cs.boxShadow !== 'none')) cards.push(styleOf(cs, rect, pageBg));
      if (!buttonish && rect.height <= 30 && rect.width <= 180 && rect.width >= 16 && textLen > 0 && textLen <= 24 && (bg || bw > 0) && (radius >= rect.height / 2 - 2 || fs <= 13) && /inline/.test(display)) badges.push(styleOf(cs, rect, pageBg));

      // Effects.
      const image = cs.backgroundImage;
      if (image && image !== 'none') {
        if (image.includes('gradient(')) bump(gradients, image.length > 220 ? `${image.slice(0, 217)}…` : image, area);
        if (image.includes('url(')) {
          if (area > 40000) bgImages++;
          if (/noise|grain|turbulence/i.test(image)) noise = true;
        }
      }
      const backdrop = cs.backdropFilter || cs.webkitBackdropFilter || '';
      const blur = backdrop.match(/blur\(([\d.]+)px\)/);
      if (blur && +blur[1] > 0) {
        glassBlur = Math.max(glassBlur, +blur[1]);
        glassCount++;
        glassArea += area;
        // A frosted sticky header alone doesn't make a page glassmorphism.
        const isHeader = tag === 'NAV' || tag === 'HEADER' || !!el.closest('header, nav, [role=banner], [role=navigation]') || (rect.top <= 140 && rect.height < 180);
        if (isHeader) glassHeader++;
        // A "panel": a frosted surface big enough to matter (badges and buttons don't count).
        else if (area >= innerWidth * innerHeight * 0.015) glassPanels++;
      }
      if (cs.transitionDuration && cs.transitionDuration.split(',').some(d => px(d) > 0)) transitions++;
      if (cs.animationName && cs.animationName !== 'none') animations++;
    }

    // ——— colors: merge near-duplicates, pick roles ———
    const merge = list => {
      const out = [];
      for (const item of list.sort((a, b) => b.w - a.w)) {
        const twin = out.find(o => dist(o.c, item.c) < MERGE_DISTANCE);
        if (twin) twin.w += item.w; else out.push({ c: item.c, w: item.w, el: item.el, cs: item.cs, rect: item.rect });
      }
      return out.sort((a, b) => b.w - a.w);
    };
    const bgs = merge(paintedColors.length
      ? [...paintedColors, ...bgColors.map(b => ({ ...b, w: b.w * 0.15 }))]
      : [{ c: pageBg, w: innerWidth * innerHeight * 1.2 }, ...bgColors]);
    const texts = merge(textColors);
    const borders = merge(borderColors);
    const accents = merge(accentColors.filter(a => a.c));
    const background = bgs[0]?.c || pageBg;
    // Dark if the background is dark, or the main text is light (e.g. white text on a colorful gradient).
    const bodyText = merge(textColors)[0];
    const dark = luminance(background) < 0.18 || (!!bodyText && luminance(bodyText.c) > 0.6 && luminance(background) < 0.45);

    const palette = [];
    const add = (c, role, w, from) => {
      if (!c || palette.some(p => dist(p.c, c) < MERGE_DISTANCE)) return false;
      palette.push({ c, role, w, from });
      return true;
    };
    add(background, 'background', bgs[0]?.w || 1, ['bg']);
    const surface = bgs.slice(1).find(b => !isSaturated(b.c) && Math.abs(luminance(b.c) - luminance(background)) < 0.35);
    if (surface) add(surface.c, 'surface', surface.w, ['bg']);
    // Main text: the strongest-contrast color among the common ones; muted: a softer common one.
    const common = texts.filter(t => t.w >= (texts[0]?.w || 0) * 0.15);
    const byContrast = list => [...list].sort((a, b) => contrast(b.c, background) - contrast(a.c, background));
    // Neon or brand-colored text is an accent, not the text color: prefer unsaturated ones.
    const mainText = byContrast(common.filter(t => !isSaturated(t.c)))[0] || byContrast(common)[0] || texts[0];
    if (mainText) add(mainText.c, 'text', mainText.w, ['text']);
    const muted = texts.find(t => t !== mainText && !isSaturated(t.c) && mainText && dist(t.c, mainText.c) >= MERGE_DISTANCE && contrast(t.c, background) < contrast(mainText.c, background));
    if (muted) add(muted.c, 'muted', muted.w, ['text']);
    const sat = accents.length ? accents : merge([...bgColors, ...textColors].filter(x => isSaturated(x.c)));
    if (sat[0]) add(sat[0].c, 'primary', sat[0].w, ['accent']);
    const accent = sat.slice(1).find(x => Math.abs(hsl(x.c).h - hsl(sat[0].c).h) > 25 || dist(x.c, sat[0].c) > 80);
    if (accent) add(accent.c, 'accent', accent.w, ['accent']);
    if (borders[0]) add(borders[0].c, 'border', borders[0].w, ['border']);
    for (const extra of [...sat.slice(1), ...bgs.slice(1), ...texts.slice(1)]) {
      if (palette.length >= 8) break;
      add(extra.c, isSaturated(extra.c) ? 'accent' : luminance(extra.c) > 0.5 === !dark ? 'surface' : 'muted', extra.w, ['other']);
    }
    const totalW = palette.reduce((s, p) => s + p.w, 0) || 1;
    const colors = palette.slice(0, 8).map(p => ({ hex: hex(p.c), role: p.role, weight: Math.round((p.w / totalW) * 1000) / 1000, from: p.from }));

    // ——— typography ———
    const headFam = top(fontsHead, 1)[0]?.[0] || top(fontsAll, 1)[0]?.[0] || 'system-ui';
    let bodyFam = top(fontsBody, 1)[0]?.[0] || top(fontsAll, 1)[0]?.[0] || 'system-ui';
    // The <body>'s own font wins a close race (sites set it there on purpose).
    const pageFam = familyOf(rootCs.fontFamily).name;
    if (pageFam !== bodyFam && (fontsBody.get(pageFam) || 0) >= (fontsBody.get(bodyFam) || 0) * 0.5) bodyFam = pageFam;
    stacks.set(pageFam, familyOf(rootCs.fontFamily).stack);
    const monoFam = top(fontsCode, 1)[0]?.[0] || [...fontsAll.keys()].find(f => MONO.test(f) && (fontsAll.get(f) || 0) > 0) || null;
    const median = list => (list.length ? [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] : null);
    const scale = top(sizes, 12).filter(([, w]) => w >= 2).map(([s]) => s).sort((a, b) => a - b);
    const typography = {
      heading: {
        family: headFam,
        stack: stacks.get(headFam) || [headFam],
        weights: top(headWeights, 3).map(([w]) => w).sort((a, b) => a - b),
        lineHeight: median(headLine) ? Math.round(median(headLine) * 100) / 100 : 1.2,
        letterSpacing: `${Math.round((median(headSpacing) || 0) * 1000) / 1000}em`,
        maxSize: Math.round(headingMax) || null,
      },
      body: {
        family: bodyFam,
        stack: stacks.get(bodyFam) || [bodyFam],
        size: top(bodySize, 1)[0]?.[0] || 16,
        weight: top(bodyWeight, 1)[0]?.[0] || 400,
        lineHeight: top(bodyLine, 1)[0]?.[0] || 1.5,
      },
      mono: monoFam,
      monoStack: monoFam ? stacks.get(monoFam) || [monoFam] : null,
      scale: scale.length ? scale : [16],
      weights: top(weights, 6).map(([w]) => w).sort((a, b) => a - b),
      // The kind of type is read from what the site asks for (its first declared
      // font), not from whatever font this computer happens to have.
      kinds: (() => {
        const head = (stacks.get(headFam) || [headFam])[0];
        const body = (stacks.get(bodyFam) || [bodyFam])[0];
        const either = re => re.test(head) || re.test(body) || re.test(headFam) || re.test(bodyFam);
        const serifIntent = name => isSerif(name) || (stacks.get(name === head ? headFam : bodyFam) || []).some(n => /^(serif|ui-serif|georgia|times new roman)$/i.test(n)) && !(stacks.get(name === head ? headFam : bodyFam) || []).some(n => /sans/i.test(n));
        return {
          headingSerif: serifIntent(head), bodySerif: serifIntent(body),
          mono: MONO.test(head) || MONO.test(body), pixel: either(PIXEL), rounded: either(ROUNDED),
          sans: !serifIntent(body) && !MONO.test(body),
        };
      })(),
    };

    // ——— shape & spacing ———
    const shape = {
      radii: top(radii, 5).filter(([, n]) => n >= 1).map(([v, n]) => ({ px: v, count: Math.round(n) })),
      shadows: top(shadows, 4).map(([v]) => v),
      borderWidths: top(borderWidths, 3).map(([v]) => v).sort((a, b) => a - b),
    };
    const spacingValues = top(spacing, 10).map(([v]) => v).sort((a, b) => a - b);
    const spaceTotal = [...spacing.values()].reduce((s, n) => s + n, 0) || 1;
    const share = d => [...spacing].filter(([v]) => v % d === 0).reduce((s, [, n]) => s + n, 0) / spaceTotal;
    const base = share(8) >= 0.65 ? 8 : share(4) >= 0.65 ? 4 : null;

    // ——— components: the most common style of each ———
    const commonest = list => {
      if (!list.length) return null;
      const groups = tally();
      for (const s of list) bump(groups, signature(s), 1);
      const best = top(groups, 1)[0][0];
      const pick = list.find(s => signature(s) === best);
      const { height, ...rest } = pick;
      return { ...rest, count: groups.get(best) };
    };
    const isFilled = s => s.bg !== 'transparent' && isSaturated(parseColor(s.bg) || { r: 0, g: 0, b: 0 });
    const buttonPrimary = commonest(buttons.filter(isFilled));
    // Secondary: an outline/neutral button, or else a filled one in another color.
    const buttonSecondary = commonest(buttons.filter(s => !isFilled(s))) ||
      commonest(buttons.filter(s => isFilled(s) && buttonPrimary && s.bg !== buttonPrimary.bg));
    const components = {
      buttonPrimary,
      buttonSecondary,
      card: commonest(cards),
      navbar: navbar ? (({ height, ...rest }) => rest)(navbar) : null,
      input: commonest(inputs),
      badge: commonest(badges),
    };

    const effects = {
      gradients: top(gradients, 3).map(([g]) => g),
      glass: glassBlur > 0 ? {
        blur: Math.round(glassBlur), count: glassCount, panels: glassPanels,
        coverage: Math.round((glassArea / (innerWidth * innerHeight)) * 100) / 100,
        headerOnly: glassCount === glassHeader,
      } : null,
      translucentSurfaces: translucent,
      transitions: transitions > 0,
      animations: animations > 0,
      bgImages: bgImages > 0,
      noise,
    };

    const scan = {
      v: 1,
      id: `scan_${Date.now().toString(36)}`,
      url: location.href.split('#')[0],
      host: location.hostname || 'local file',
      title: (document.title || location.hostname || 'Untitled').slice(0, 120),
      at: new Date().toISOString(),
      theme: dark ? 'dark' : 'light',
      stats: { elements: count, walked, capped, ms: Math.round(cpu), wallMs: Math.round(performance.now() - wall0) },
      colors,
      typography,
      shape,
      spacing: { scale: spacingValues, base },
      layout: {
        maxWidth: top(maxWidths, 1)[0]?.[0] || null,
        flex, grid, columns,
        stickyHeader,
      },
      components,
      effects,
      vibe: [],
    };
    scan.vibe = Mochi.classifyVibe ? Mochi.classifyVibe(scan) : [];
    return scan;
  }

  Mochi.scanUI = scanUI;
  Mochi.fontFamilyOf = familyOf;
  Mochi.color = { parseColor, hex, hsl, luminance, contrast, isSaturated };

  /* SHAPE — what scanUI() returns:
   * { v, id, url, host, title, at, theme: 'light'|'dark',
   *   stats: { elements, walked, capped, ms, wallMs },
   *   colors: [{ hex, role: background|surface|text|muted|primary|accent|border, weight, from }],
   *   typography: { heading: { family, stack, weights, lineHeight, letterSpacing, maxSize },
   *                 body: { family, stack, size, weight, lineHeight }, mono, monoStack, scale, weights, kinds },
   *     (family: the font the page really renders; stack: its cleaned font-family list)
   *   shape: { radii: [{ px, count }], shadows: [css], borderWidths: [px] },
   *   spacing: { scale: [px], base: 4|8|null },
   *   layout: { maxWidth, flex, grid, columns, stickyHeader },
   *   components: { buttonPrimary, buttonSecondary, card, navbar, input, badge }   // each null or
   *               { bg, color, radius, padding, shadow, border, font, count },
   *   effects: { gradients, glass: { blur, count, panels, coverage, headerOnly }|null, translucentSurfaces, transitions, animations, bgImages, noise },
   *   vibe: [{ id, label, score, reason, do, dont }] }
   */
})();
