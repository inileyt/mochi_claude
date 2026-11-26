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
    scan.sourceRaw = own ? { css, html } : null;

    scan.spec.sourceFiles = {
      available: own, cssBytes: own ? bytes : 0, hasHtml: own && !!html,
      stylesheets: sheets.map(s => ({ url: (s.url || '(inline)').replace(/^https?:\/\/[^/]+/, '') || '(inline)', origin: s.origin || 'page', bytes: s.text.length })),
      keyframes: { defined: allKf.length, unused },
      fontFaces: (scan.css?.fontFaces || []).length,
      scripts,
      note: own
        ? "Your own site: the CSS (and HTML, where readable) is included verbatim as source.css / source.html — the exact source of truth, with every rule, all @keyframes (including ones the live scan never triggered) and the media-query rules. JavaScript behaviour lives in the listed scripts."
        : "A site that isn't yours: the raw source isn't included (it holds the original copy and branding). The @keyframes names, counts and script list below still say what motion and behaviour exist, so you can rebuild it with your own content.",
    };
  }

  D.addPhase({ id: 'source', order: 78, cdp: false, label: 'deep.step.source', budget: 8000, weight: 0.5, run });
})();
