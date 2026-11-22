/*
 * Mochi — Deep Scan: the page's stylesheets (through the DevTools CSS domain,
 * so cross-origin sheets can be read too) and what the spec needs from them:
 * @media breakpoints, @keyframes, @font-face. The text stays in memory for the
 * scan only (it's the page's code, not its content).
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const D = Mochi.deepScan;
  const MAX_TEXT = 3 * 1024 * 1024;

  /** Finds a block's matching closing brace (CSS text, ignoring strings and comments well enough). */
  function blockEnd(text, open) {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      const c = text[i];
      if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2); if (i < 0) return text.length; i++; continue; }
      if (c === '"' || c === "'") { const end = text.indexOf(c, i + 1); if (end < 0) return text.length; i = end; continue; }
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return i;
    }
    return text.length;
  }

  function parse(text) {
    const out = { media: [], keyframes: {}, fontFaces: [] };
    const re = /@(media|keyframes|-webkit-keyframes|font-face)\b([^{]*)\{/g;
    let m;
    while ((m = re.exec(text))) {
      const open = m.index + m[0].length - 1;
      const end = blockEnd(text, open);
      const body = text.slice(open + 1, end);
      if (m[1] === 'media') out.media.push({ condition: m[2].trim().replace(/\s+/g, ' '), rules: (body.match(/\{/g) || []).length });
      else if (m[1].endsWith('keyframes')) out.keyframes[m[2].trim()] = body.trim().replace(/\s+/g, ' ');
      else {
        const get = prop => (body.match(new RegExp(`${prop}\\s*:\\s*([^;]+)`, 'i')) || [])[1]?.trim();
        const src = get('src') || '';
        out.fontFaces.push({
          family: (get('font-family') || '').replace(/["']/g, ''),
          weight: get('font-weight') || '400', style: get('font-style') || 'normal', display: get('font-display') || null,
          sources: [...src.matchAll(/(local|url)\(\s*["']?([^"')]+)["']?\s*\)(?:\s*format\(\s*["']?([^"')]+)["']?\s*\))?/g)].map(x => ({
            kind: x[1], name: x[1] === 'local' ? x[2] : x[2].split(/[?#]/)[0].split('/').pop(), format: x[3] || (x[1] === 'url' ? (x[2].match(/\.(woff2?|ttf|otf|eot)(?:[?#]|$)/i) || [])[1] || null : null),
          })),
        });
      }
      re.lastIndex = m[1] === 'media' ? open + 1 : end; // nested rules inside @media are scanned too
    }
    return out;
  }

  /** Width breakpoints from @media conditions: [{ px, kind: 'max'|'min', count }], plus other media features. */
  function breakpoints(media) {
    const widths = new Map(), features = new Map();
    for (const { condition } of media) {
      for (const [, kind, num, unit] of condition.matchAll(/\((max|min)-width\s*:\s*([\d.]+)(px|em|rem)\)/g)) {
        const px = Math.round(parseFloat(num) * (unit === 'px' ? 1 : 16));
        const key = `${kind}:${px}`;
        widths.set(key, { px, kind, count: (widths.get(key)?.count || 0) + 1 });
      }
      for (const [, f, v] of condition.matchAll(/\((prefers-reduced-motion|prefers-color-scheme|hover|pointer|orientation|prefers-contrast)\s*:\s*([\w-]+)\)/g)) features.set(`${f}: ${v}`, (features.get(`${f}: ${v}`) || 0) + 1);
    }
    return { widths: [...widths.values()].sort((a, b) => b.px - a.px), features: [...features].map(([f, count]) => ({ feature: f, count })) };
  }

  async function run(scan) {
    const sheets = [];
    let total = 0;
    try {
      const ids = new Map();
      const off = scan.cdp.on('CSS.styleSheetAdded', ({ header }) => { if (header) ids.set(header.styleSheetId, header); });
      await scan.cdp.send('DOM.enable');
      await scan.cdp.send('CSS.enable');
      await scan.sleep(400); // the events for the sheets already on the page
      off();
      for (const [id, h] of ids) {
        if (total > MAX_TEXT || sheets.length >= 60) break;
        try {
          const { text } = await scan.cdp.send('CSS.getStyleSheetText', { styleSheetId: id });
          if (!text || /--mochi-size|\.mochi-still-|mochi-svg/.test(text)) continue; // Mochi's own styles (its shadow DOM) are not the page's
          total += text.length;
          sheets.push({ id, origin: h.origin, url: h.sourceURL ? h.sourceURL.split(/[?#]/)[0] : '(inline)', text });
        } catch (_) { /* a sheet that went away */ }
        scan.check();
      }
    } catch (_) { /* no CDP: read what the page itself can */ }
    if (!sheets.length) {
      for (const s of document.styleSheets) {
        try { sheets.push({ origin: 'page', url: s.href || '(inline)', text: [...s.cssRules].map(r => r.cssText).join('\n') }); } catch (_) { /* cross-origin */ }
      }
    }
    scan.sheets = sheets;

    const parsed = sheets.map(s => parse(s.text));
    scan.css = {
      media: parsed.flatMap(p => p.media),
      keyframes: Object.assign({}, ...parsed.map(p => p.keyframes)),
      fontFaces: parsed.flatMap(p => p.fontFaces),
    };
    const bp = breakpoints(scan.css.media);
    scan.spec.responsive = { ...(scan.spec.responsive || {}), breakpoints: bp.widths, mediaFeatures: bp.features };
    scan.spec.stylesheets = sheets.map(s => ({ url: s.origin === 'regular' || s.origin === 'page' ? s.url.replace(/^https?:\/\/[^/]+/, '') || '(inline)' : s.url, bytes: s.text.length }));
  }

  Mochi.deepCss = { parse, breakpoints, blockEnd };
  D.addPhase({ id: 'sheets', order: 15, cdp: true, always: true, label: 'deep.step.structure', budget: 15000, weight: 0.5, run });
})();
