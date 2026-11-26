/*
 * Mochi — Deep Scan: read the source, not only the render. The rest of the scan measures the page as
 * it is drawn right now; this phase keeps what lives in the files but may not show on screen: the page's
 * own CSS verbatim (every rule, all @keyframes — including ones the live scan never triggered, and the
 * media-query rules for other widths), its HTML where it can be read same-origin, and a list of the
 * scripts (JavaScript behaviour the render can't reveal). It goes into the zip as source.css / source.html
 * so an AI rebuilding the page works from the real code, not only a reconstruction.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const D = Mochi.deepScan;
  const MAX_CSS = 2 * 1024 * 1024, MAX_HTML = 1 * 1024 * 1024;
  const MAX_FONT_FILES = 16, MAX_FONT_BYTES = 8 * 1024 * 1024;

  /**
   * The real font files the page's @font-face rules point at, so an own-site rebuild uses the exact
   * typeface, not a lookalike. URLs are resolved against the sheet they came from (or the document for
   * inline <style>), deduped, and fetched; cross-origin fonts that can't be read (CORS) are skipped, as
   * are data: URLs (already inline in the CSS). → [{ name, data: Uint8Array, url }].
   */
  async function fontFiles(sheets, scan) {
    const urls = new Map();
    for (const s of sheets) {
      const base = s.url && s.url !== '(inline)' ? s.url : location.href;
      for (const face of s.text.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
        for (const u of face[1].matchAll(/url\(\s*['"]?([^'")]+?)['"]?\s*\)/gi)) {
          const raw = u[1].trim();
          if (/^data:/i.test(raw)) continue;
          let abs; try { abs = new URL(raw, base).href; } catch (_) { continue; }
          if (!/\.(woff2?|ttf|otf)(?:[?#]|$)/i.test(abs) || urls.has(abs)) continue;
          urls.set(abs, (abs.split(/[?#]/)[0].split('/').pop() || 'font').replace(/[^\w.-]/g, '_'));
        }
      }
    }
    const out = []; let total = 0; const names = new Set();
    for (const [url, fname] of urls) {
      if (out.length >= MAX_FONT_FILES || total >= MAX_FONT_BYTES) break;
      try {
        const res = await fetch(url, { credentials: 'omit' });
        if (!res.ok) continue;
        const data = new Uint8Array(await res.arrayBuffer());
        if (!data.length || total + data.length > MAX_FONT_BYTES) continue;
        let name = fname; for (let i = 2; names.has(name); i++) name = fname.replace(/(\.[^.]+)?$/, `-${i}$1`);
        names.add(name); total += data.length;
        out.push({ name, data, url });
      } catch (_) { /* opaque (CORS), blocked, or gone */ }
      scan.check?.();
    }
    return out;
  }

  async function run(scan) {
    const sheets = scan.sheets || [];
    // The page's CSS, verbatim, one labelled block per sheet.
    const parts = []; let bytes = 0;
    for (const s of sheets) {
      if (bytes > MAX_CSS) { parts.push('/* … more stylesheets omitted (size limit) … */'); break; }
      parts.push(`/* ===== ${s.url || '(inline)'}${s.origin && s.origin !== 'page' ? ` [${s.origin}]` : ''} ===== */\n${s.text}`);
      bytes += s.text.length;
    }
    const css = parts.join('\n\n') || null;

    // Every @keyframes defined vs the ones the render was actually using.
    const allKf = Object.keys(scan.css?.keyframes || {});
    const used = new Set((scan.spec.motion?.animations || []).map(a => a.name));
    const unused = allKf.filter(n => !used.has(n));

    // Scripts — the JavaScript behaviour the rendered DOM can't show.
    const scripts = [];
    for (const sc of document.scripts) {
      if (sc.closest?.('mochi-companion')) continue;
      const src = sc.getAttribute('src');
      if (src) scripts.push({ src: src.split(/[?#]/)[0], external: /^https?:\/\//.test(src) && !src.startsWith(location.origin) });
      else { const n = (sc.textContent || '').length; if (n > 0) scripts.push({ inline: true, bytes: n }); }
      if (scripts.length >= 80) break;
    }

    // The original HTML, when it can be read from the same origin (a static copy, or an SSR page).
    let html = null;
    try {
      const res = await fetch(location.href, { credentials: 'omit' });
      if (res.ok) { const t = await res.text(); if (t && t.length <= MAX_HTML && /<html|<!doctype/i.test(t.slice(0, 2000))) html = t; }
    } catch (_) { /* cross-origin, blocked, or a client-rendered app */ }

    // The verbatim source holds the page's own copy and branding, so it only ships when the owner
    // scanned their own site (same rule as the screenshots and placeholders). It is kept OUT of
    // scan.spec (and so out of spec.json) — the zip writer reads it from scan.sourceRaw. Read the
    // flag from scan.opts, which is set at scan start; scan.spec.source isn't written until every
    // phase has finished.
    const own = !!scan.opts?.ownSite;
    // The real font files the @font-face rules point at — only for your own site (a font file is the
    // typeface itself, usually licensed), and only what reads same-origin.
    const fonts = own ? await fontFiles(sheets, scan).catch(() => []) : [];
    scan.sourceRaw = own ? { css, html, fonts } : null;

    scan.spec.sourceFiles = {
      available: own, cssBytes: own ? bytes : 0, hasHtml: own && !!html,
      stylesheets: sheets.map(s => ({ url: (s.url || '(inline)').replace(/^https?:\/\/[^/]+/, '') || '(inline)', origin: s.origin || 'page', bytes: s.text.length })),
      keyframes: { defined: allKf.length, unused },
      fontFaces: (scan.css?.fontFaces || []).length,
      fontsBundled: own ? fonts.map(f => `fonts/${f.name}`) : [],
      scripts,
      note: own
        ? "Your own site: the CSS (and HTML, where readable) is included verbatim as source.css / source.html — the exact source of truth, with every rule, all @keyframes (including ones the live scan never triggered) and the media-query rules. The real font files sit in fonts/ (use them directly); JavaScript behaviour lives in the listed scripts."
        : "A site that isn't yours: the raw source and font files aren't included (they hold the original copy, branding and licensed typefaces). The @keyframes names, counts and script list below still say what motion and behaviour exist, so you can rebuild it with your own content.",
    };
  }

  D.addPhase({ id: 'source', order: 78, cdp: false, label: 'deep.step.source', budget: 8000, weight: 0.5, run });
})();
