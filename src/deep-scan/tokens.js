/*
 * Mochi — Deep Scan, Task 3a: design tokens for the whole page (not just the
 * first screen): colours by role, the type scale, font families (with their
 * @font-face sources: names and formats only, plus a free look-alike), the
 * spacing scale, radii, shadows, borders, gradients, backdrop filters, opacity
 * and z-index layers, and the site's own CSS custom properties.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const D = Mochi.deepScan;
  const C = () => Mochi.color;

  // Free fonts that look close to common commercial ones (a suggestion, not a promise).
  const FREE = [
    [/circular|cerebri|gilroy|manrope/i, 'Manrope'], [/sf pro|-apple-system|system-ui|segoe|helvetica|arial|neue haas|aktiv|graphik|söhne|sohne|untitled sans|suisse/i, 'Inter'],
    [/proxima|gotham|montserrat|avenir|museo sans|nunito/i, 'Montserrat'], [/futura|jost|century gothic/i, 'Jost'], [/gt walsheim|dm sans|euclid|sharp sans|apercu/i, 'DM Sans'],
    [/brandon|josefin/i, 'Josefin Sans'], [/founders|druk|tusker|anton|bebas/i, 'Anton'], [/space grotesk|grotesk|grotesque/i, 'Space Grotesk'],
    [/canela|tiempos|freight|georgia|times|garamond|caslon|lyon|playfair|recoleta/i, 'Fraunces'], [/mono|menlo|consolas|courier|fira code|jetbrains/i, 'JetBrains Mono'],
  ];
  const freeFor = family => (FREE.find(([re]) => re.test(family)) || [null, /serif/i.test(family) && !/sans/i.test(family) ? 'Source Serif 4' : 'Inter'])[1];
  const firstFamily = stack => (stack || '').split(',')[0].replace(/["']/g, '').trim();

  function tally(map, key, weight = 1, extra) {
    if (key === undefined || key === null || key === '') return;
    const v = map.get(key) || { value: key, count: 0, weight: 0, where: new Set() };
    v.count++; v.weight += weight; if (extra) v.where.add(extra);
    map.set(key, v);
  }
  const top = (map, n = 12, by = 'count') => [...map.values()].sort((a, b) => b[by] - a[by]).slice(0, n).map(v => ({ value: v.value, count: v.count, ...(v.where.size ? { where: [...v.where].slice(0, 4) } : {}) }));

  /** The site's own CSS variables on :root / html / body (their names say what they are for). */
  function customProperties(scan) {
    const vars = {};
    for (const s of scan.sheets || []) {
      for (const m of s.text.matchAll(/(?:^|})\s*(?::root|html|body)(?:\s*,\s*(?::root|html|body))*\s*\{([^}]*)\}/g)) {
        for (const [, name, value] of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) if (Object.keys(vars).length < 200) vars[name] = value.trim();
      }
    }
    // The values as the page resolves them now.
    const cs = getComputedStyle(document.documentElement);
    for (const k of Object.keys(vars)) { const now = cs.getPropertyValue(k).trim(); if (now) vars[k] = now; }
    return vars;
  }

  async function run(scan) {
    const color = C();
    const nodes = scan.nodes || [];
    const bgs = new Map(), texts = new Map(), borders = new Map(), type = new Map(), families = new Map(), spacing = new Map(), radii = new Map(),
      shadows = new Map(), gradients = new Map(), backdrops = new Map(), opacities = new Map(), zs = new Map(), borderStyles = new Map();
    let k = 0;
    for (const n of nodes) {
      if (n.hidden || !n.el.isConnected) continue;
      const cs = getComputedStyle(n.el);
      const area = n.rect.w * n.rect.h;
      const bg = color.parseColor(cs.backgroundColor);
      if (bg) tally(bgs, color.hex(bg) + (bg.a < 0.99 ? ` / ${Math.round(bg.a * 100)}%` : ''), area, n.tag);
      if (n.text > 0) {
        const c = color.parseColor(cs.color);
        if (c) tally(texts, color.hex(c), n.text, n.tag);
        const fam = firstFamily(cs.fontFamily);
        tally(families, fam, n.text, /^h[1-6]$/.test(n.tag) ? 'headings' : n.tag === 'code' || n.tag === 'pre' ? 'code' : 'text');
        tally(type, `${cs.fontSize}/${cs.lineHeight}/${cs.fontWeight}/${fam}${cs.letterSpacing !== 'normal' ? `/${cs.letterSpacing}` : ''}${cs.textTransform !== 'none' ? `/${cs.textTransform}` : ''}`, n.text, n.tag);
      }
      if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') {
        const bc = color.parseColor(cs.borderTopColor);
        if (bc) { tally(borders, color.hex(bc), 1, n.tag); tally(borderStyles, `${cs.borderTopWidth} ${cs.borderTopStyle} ${color.hex(bc)}`, 1, n.tag); }
      }
      for (const prop of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginBottom', 'rowGap', 'columnGap']) {
        const v = parseFloat(cs[prop]);
        if (v > 0 && v <= 200 && Number.isFinite(v)) tally(spacing, Math.round(v), 1);
      }
      if (cs.borderTopLeftRadius !== '0px') tally(radii, cs.borderTopLeftRadius, 1, n.tag);
      if (cs.boxShadow !== 'none') tally(shadows, cs.boxShadow, 1, n.cls[0] ? `.${n.cls[0]}` : n.tag);
      if (cs.backgroundImage.includes('gradient(')) tally(gradients, cs.backgroundImage, 1, n.cls[0] ? `.${n.cls[0]}` : n.tag);
      if (cs.backdropFilter && cs.backdropFilter !== 'none') tally(backdrops, cs.backdropFilter, 1, n.cls[0] ? `.${n.cls[0]}` : n.tag);
      if (cs.opacity !== '1' && cs.opacity !== '0') tally(opacities, cs.opacity, 1, n.cls[0] ? `.${n.cls[0]}` : n.tag);
      if (cs.zIndex !== 'auto' && cs.position !== 'static') tally(zs, Number(cs.zIndex), 1, n.cls[0] ? `.${n.cls[0]}` : n.tag);
      if (++k % 300 === 0) await scan.breathe();
    }

    // Roles: the quick scan's role logic (it knows a primary button from a link colour).
    let roles = [];
    try { const quick = await Mochi.scanUI({ ignore: scan.ignore }); roles = quick.colors; scan.quick = quick; } catch (_) { /* fine without */ }

    // The type scale, largest first, named by where it's used.
    const scale = [...type.values()].sort((a, b) => parseFloat(b.value) - parseFloat(a.value) || b.weight - a.weight).slice(0, 14).map(v => {
      const [size, lineHeight, weight, family, ...rest] = v.value.split('/');
      const where = [...v.where];
      return { size, lineHeight, weight, family, letterSpacing: rest.find(x => /px|em/.test(x)) || null, transform: rest.find(x => /^(uppercase|lowercase|capitalize)$/.test(x)) || null, usedBy: where.slice(0, 5), chars: Math.round(v.weight) };
    });
    const named = scale.map((s, i) => ({ name: s.usedBy.find(t => /^h[1-6]$/.test(t)) || (parseFloat(s.size) >= 40 ? 'display' : parseFloat(s.size) <= 13 ? 'caption' : i === scale.length - 1 ? 'small' : 'text'), ...s }));
    const bodyStyle = [...type.values()].sort((a, b) => b.weight - a.weight)[0]?.value.split('/');

    const fontFaces = (scan.css?.fontFaces || []).map(f => ({ ...f, freeAlternative: freeFor(f.family) }));
    const usedFamilies = top(families, 8, 'weight').map(f => ({ family: f.value, usedFor: f.where || [], declared: fontFaces.some(ff => ff.family === f.value), freeAlternative: freeFor(f.value) }));

    const spaceValues = [...spacing.values()].filter(v => v.count >= 2).map(v => v.value).sort((a, b) => a - b);
    const base = [8, 4, 6, 5].find(b => spaceValues.length && spaceValues.filter(v => v % b === 0).length / spaceValues.length >= 0.75) || null;

    scan.spec.tokens = {
      colors: {
        roles: roles.map(c => ({ role: c.role, hex: c.hex })),
        backgrounds: top(bgs, 12, 'weight'),
        text: top(texts, 10, 'weight'),
        borders: top(borders, 6),
      },
      customProperties: customProperties(scan),
      typography: {
        families: usedFamilies,
        fontFaces,
        body: bodyStyle ? { size: bodyStyle[0], lineHeight: bodyStyle[1], weight: bodyStyle[2], family: bodyStyle[3] } : null,
        scale: named,
        licenceNote: 'Check each font\'s licence before using it. If you can\'t use a font, take the suggested free alternative (Google Fonts) or the closest system font.',
      },
      spacing: { base, scale: spaceValues.slice(0, 16) },
      radius: top(radii, 8),
      shadows: top(shadows, 8),
      borders: top(borderStyles, 8),
      gradients: top(gradients, 6),
      backdropFilters: top(backdrops, 4),
      opacity: top(opacities, 6),
      zIndex: [...zs.values()].sort((a, b) => b.value - a.value).map(v => ({ value: v.value, where: [...v.where].slice(0, 3) })),
      theme: scan.quick?.theme || null,
    };
  }

  Mochi.deepTokens = { freeFor };
  D.addPhase({ id: 'tokens', order: 40, cdp: false, label: 'deep.step.tokens', budget: 15000, weight: 1, run });
})();
