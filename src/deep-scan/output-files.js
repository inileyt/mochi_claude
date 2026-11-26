/*
 * Mochi — Deep Scan output, part 2: PROMPT.md (the master prompt for an AI
 * coding agent), tokens.css, tailwind.config.js, the screenshot placeholders
 * (texts and pictures painted over, unless "this is my own site"), and the short
 * "paste" version for the pocket and claude.ai.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const D = Mochi.deepScan;
  const kebab = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const GENERIC = /^(system-ui|-apple-system|ui-sans-serif|ui-serif|ui-monospace|sans-serif|serif|monospace|cursive|fantasy)$/i;
  const q = s => (GENERIC.test(s) ? s : JSON.stringify(s)); // generic font families must not be quoted
  /** The text family, and the one used (mostly) for headings. */
  const familiesOf = fams => ({
    body: fams.find(f => f.usedFor.includes('text')) || fams[0],
    heading: fams.find(f => f.usedFor.includes('headings') && !f.usedFor.includes('text')) || fams.find(f => f.usedFor.includes('headings')),
  });

  // ——— tokens.css ———
  function tokensCss(scan) {
    const t = scan.spec.tokens || {};
    const lines = ['/* Design tokens from Mochi Deep Scan. Names by role; the site\'s own variables are kept below. */', ':root {'];
    const roles = new Map();
    for (const c of t.colors?.roles || []) { let name = `--color-${kebab(c.role)}`; let i = 2; while (roles.has(name)) name = `--color-${kebab(c.role)}-${i++}`; roles.set(name, c.hex); }
    for (const [n, v] of roles) lines.push(`  ${n}: ${v};`);
    (t.colors?.backgrounds || []).slice(0, 8).forEach((c, i) => lines.push(`  --surface-${i + 1}: ${c.value.split(' / ')[0]};`));
    const { body: bodyF, heading: head } = familiesOf(t.typography?.families || []);
    if (bodyF) lines.push(`  --font-body: ${q(bodyF.family)}, ${q(bodyF.freeAlternative)}, system-ui, sans-serif;`);
    if (head) lines.push(`  --font-heading: ${q(head.family)}, ${q(head.freeAlternative)}, system-ui, sans-serif;`);
    for (const [i, s] of (t.typography?.scale || []).entries()) lines.push(`  --text-${kebab(s.name)}-${i + 1}: ${s.weight} ${s.size}/${s.lineHeight} ${q(s.family)};`);
    (t.spacing?.scale || []).forEach(v => lines.push(`  --space-${v}: ${v}px;`));
    (t.radius || []).forEach((r, i) => lines.push(`  --radius-${i + 1}: ${r.value};`));
    (t.shadows || []).forEach((s, i) => lines.push(`  --shadow-${i + 1}: ${s.value};`));
    (t.gradients || []).forEach((g, i) => lines.push(`  --gradient-${i + 1}: ${g.value};`));
    if (scan.spec.geometry?.contentColumn) lines.push(`  --container-max: ${scan.spec.geometry.contentColumn.maxWidth};`, `  --container-padding: ${scan.spec.geometry.contentColumn.sidePadding};`);
    const own = t.customProperties || {};
    if (Object.keys(own).length) { lines.push('', '  /* the site\'s own custom properties */'); for (const [k, v] of Object.entries(own)) lines.push(`  ${k}: ${v};`); }
    lines.push('}', '');
    for (const f of t.typography?.fontFaces || []) lines.push(`/* @font-face "${f.family}" ${f.weight} ${f.style}: ${f.sources.map(s => `${s.kind} ${s.name}${s.format ? ` (${s.format})` : ''}`).join(', ')}. Check the licence, or use "${f.freeAlternative}" from Google Fonts. */`);
    lines.push('', '/* Type scale */');
    for (const [i, s] of (t.typography?.scale || []).entries()) lines.push(`.text-${kebab(s.name)}-${i + 1} { font: var(--text-${kebab(s.name)}-${i + 1});${s.letterSpacing ? ` letter-spacing: ${s.letterSpacing};` : ''}${s.transform ? ` text-transform: ${s.transform};` : ''} }`);
    const kf = scan.css?.keyframes || {};
    const used = new Set((scan.spec.motion?.animations || []).map(a => a.name));
    const frames = Object.entries(kf).filter(([n]) => used.has(n));
    if (frames.length) { lines.push('', '/* Keyframes the page uses */'); for (const [n, body] of frames) lines.push(`@keyframes ${n} { ${body} }`); }
    if (scan.spec.motion?.reducedMotion?.rules?.length) { lines.push('', '@media (prefers-reduced-motion: reduce) {'); for (const r of scan.spec.motion.reducedMotion.rules) lines.push(`  ${r.selector} { ${r.sets} }`); lines.push('}'); }
    return lines.join('\n') + '\n';
  }

  // ——— tailwind.config.js ———
  function tailwindConfig(scan) {
    const t = scan.spec.tokens || {};
    const colors = {};
    for (const c of t.colors?.roles || []) { let k = kebab(c.role); let i = 2; while (colors[k]) k = `${kebab(c.role)}-${i++}`; colors[k] = c.hex; }
    for (const [k, v] of Object.entries(t.customProperties || {})) if (/^(#|rgb|hsl)/.test(v)) colors[kebab(k)] = v;
    const fontFamily = {};
    const { body, heading: head } = familiesOf(t.typography?.families || []);
    if (body) fontFamily.sans = [body.family, body.freeAlternative, 'system-ui', 'sans-serif'];
    if (head) fontFamily.heading = [head.family, head.freeAlternative, 'system-ui', 'sans-serif'];
    const fontSize = {};
    for (const s of t.typography?.scale || []) { let k = kebab(s.name); let i = 2; while (fontSize[k]) k = `${kebab(s.name)}-${i++}`; fontSize[k] = [s.size, { lineHeight: s.lineHeight, fontWeight: s.weight, ...(s.letterSpacing ? { letterSpacing: s.letterSpacing } : {}) }]; }
    const spacing = Object.fromEntries((t.spacing?.scale || []).map(v => [String(v / 4).replace(/\.0$/, ''), `${v}px`]));
    const borderRadius = Object.fromEntries((t.radius || []).map((r, i) => [i === 0 ? 'DEFAULT' : `r${i + 1}`, r.value]));
    const boxShadow = Object.fromEntries((t.shadows || []).map((s, i) => [i === 0 ? 'DEFAULT' : `s${i + 1}`, s.value]));
    const screens = Object.fromEntries((scan.spec.responsive?.breakpoints || []).map(b => [`${b.kind}-${b.px}`, b.kind === 'max' ? { max: `${b.px}px` } : `${b.px}px`]));
    const keyframes = {}, animation = {};
    for (const a of scan.spec.motion?.animations || []) {
      if (!a.keyframes?.length || keyframes[a.name]) continue;
      keyframes[a.name] = Object.fromEntries(a.keyframes.map(k => [`${Math.round((k.offset ?? 0) * 100)}%`, Object.fromEntries(Object.entries(k).filter(([p]) => p !== 'offset'))]));
      animation[a.name] = `${a.name} ${a.duration}ms ${a.easing || 'ease'}${a.iterations === 'infinite' ? ' infinite' : ''}`;
    }
    const container = scan.spec.geometry?.contentColumn ? { center: true, padding: scan.spec.geometry.contentColumn.sidePadding, screens: { DEFAULT: scan.spec.geometry.contentColumn.maxWidth } } : undefined;
    const config = { content: ['./**/*.{html,js,jsx,ts,tsx}'], theme: { ...(container ? { container } : {}), extend: { colors, fontFamily, fontSize, spacing, borderRadius, boxShadow, screens, keyframes, animation } }, plugins: [] };
    return `/** Tailwind config from Mochi Deep Scan (design tokens of the scanned page). */\nmodule.exports = ${JSON.stringify(config, null, 2)};\n`;
  }

  // ——— PROMPT.md ———
  function promptMd(scan) {
    const s = scan.spec;
    const own = s.source.ownSite;
    const regions = (s.structure?.regions || []).filter(r => !['overlay', 'floating'].includes(r.kind));
    const states = s.states?.interactive || [], clicks = (s.states?.clicks || []).filter(c => c.opens?.length || c.effect && c.effect !== 'nothing visible changed');
    const bp = s.responsive?.breakpoints || [];
    const out = [
      '# Rebuild this page — instructions for an AI coding agent', '',
      'You are given a **Rebuild Spec** made by Mochi Deep Scan (a browser extension that measured the page locally):', '',
      '- `SPEC.md` — the page, region by region, with exact layout, sizes, styles, states, motion and scroll behaviour. **Read it completely before writing code.**',
      '- `spec.json` — the same data, machine-readable (schema: https://github.com/inileyt/mochi_claude/blob/main/docs/rebuild-spec.schema.md).',
      '- `tokens.css`, `tailwind.config.js` — the design tokens.',
      ...(scan.sourceRaw?.css ? ['- `source.css`' + (scan.sourceRaw?.html ? ', `source.html`' : '') + " — the page's **own source files, verbatim** (not a reconstruction). This is the source of truth for exact rules, **all `@keyframes`** (including ones the live scan never triggered), hover/state rules and media-query rules. Read it, and prefer it over guessing from the screenshots or the measured spec."] : []),
      ...(scan.sourceRaw?.fonts?.length ? [`- \`fonts/\` — the **real font files** the \`@font-face\` rules point at (${scan.sourceRaw.fonts.length}). Use them directly (copy them in and keep the \`@font-face\` \`src\` from \`source.css\`); don't swap in a lookalike.`] : []),
      '- `screenshots/` — `full-1440.png`, `full-1024.png`, `full-768.png`, `full-390.png`, `sections/…`, `states/…`.', '',
      `**Goal:** rebuild the page as close to 1:1 as possible — layout, sizes, spacing, colours, type, every state, animation and scroll behaviour — ${own ? 'using the original texts and images (the owner scanned their own site).' : 'with **placeholder branding and content** (see step 6).'}`, '',
      "**Nothing in this spec is optional. The motion is part of the design, not decoration: recreate EVERY animation, scroll reveal, hover transition and the hero's own entrance/looping motion. Do NOT ship a static version. If something is marked approximate, make your best faithful recreation of it — never drop it. A rebuild that leaves the page still is incomplete.**", '',
      `**This page at a glance:** ${regions.length} regions, ${(s.structure?.components || []).length} repeated components, ${(s.media?.images || []).length} images and ${(s.media?.videos || []).length} videos, ${(s.motion?.animations || []).length} CSS animations + ${(s.motion?.js || []).length} JavaScript motions, ${(s.scroll?.timeline || []).length} scroll effects, ${states.length} components with states. Account for every one of them — tick each off against SPEC.md as you go.`, '',
      '## 1. Pick the stack', '',
      '- **Default:** semantic HTML + CSS + vanilla JS — `index.html`, `styles.css` (start from `tokens.css`), `script.js`. No framework, no build step.',
      '- **Alternative (if asked):** React + Tailwind — use `tailwind.config.js`, one component per region and per repeated component in SPEC.md.', '',
      '## 2. Build it section by section, in this order', '',
      ...regions.map(r => `${r.order}. **${r.name}**${r.type && r.type !== r.name ? ` (${r.type})` : ''} — ${r.layout?.grid ? `grid \`${r.layout.grid.template}\`` : r.layout?.flex ? `flex ${r.layout.flex.direction}` : 'block'}${r.layout?.gap ? `, gap ${r.layout.gap}` : ''}, ${r.geometry?.w}×${r.geometry?.h}px${r.position?.position && r.position.position !== 'relative' ? `, ${r.position.position}` : ''}${r.components?.length ? `, ${r.components.map(c => `${c.name} ×${c.count}`).join(', ')}` : ''}`),
      '', `(Sizes are at the ${s.source.viewport?.width}px window the scan ran in; SPEC.md gives them relative to the parent and the viewport too.) Then the overlays and floating elements listed in SPEC.md. Use the exact sizes, gaps and paddings from SPEC.md, the colours/fonts/spacing/radii from \`tokens.css\`, and the content column (${s.geometry?.contentColumn ? `max-width ${s.geometry.contentColumn.maxWidth}, side padding ${s.geometry.contentColumn.sidePadding}` : 'see SPEC.md'}).`, '',
      '## 3. Implement every state, animation and scroll behaviour', '',
      `- **Hover / focus / active:** ${states.length} components have states in SPEC.md → "Components and their states" (with transition timings). Implement all of them.`,
      `- **Clicks:** ${clicks.length} behaviours in "What clicking does" (${[...new Set(clicks.map(c => c.kind))].join(', ')}): what opens, where, how it animates in, and every way it closes.`,
      `- **Animations (required):** ${(s.motion?.animations || []).length} CSS animations (keyframes in \`tokens.css\` / SPEC.md) and ${(s.motion?.js || []).length} JavaScript-driven motion${(s.motion?.js || []).length === 1 ? '' : 's'}. Recreate every one of them with the listed name, duration, delay and easing. For the JavaScript-driven ones, match the motion as described (it's approximate — reproduce the effect, don't skip it). Include the **hero's own motion** — any entrance, floating, looping or background animation on the top section is part of the page and must play.`,
      `- **Scroll:** follow "Scroll timeline" exactly (sticky changes at their px thresholds, reveal thresholds and stagger, parallax speeds, snap, smooth scrolling).`,
      ...((s.pointer?.effects || []).length ? [`- **Pointer effects (measured — ${s.pointer.effects.length}):** ${s.pointer.effects.map(e => `\`${e.selector}\` ${e.kind} (${e.detail})`).join('; ')}. These are **JavaScript mouse effects** — they are *not* in \`source.css\`. Recreate each with a \`pointermove\` handler.`] : []),
      `- **Reduced motion:** ${s.motion?.reducedMotion?.handled ? 'the site turns motion off under `prefers-reduced-motion: reduce` — keep those rules.' : 'add `prefers-reduced-motion: reduce` rules that turn off loops, parallax and reveals.'}`,
      ...(s.sourceFiles ? [`- **From the source${s.sourceFiles.available ? ' (`source.css`)' : ''}:** ${s.sourceFiles.keyframes?.defined || 0} \`@keyframes\` are defined${(s.sourceFiles.keyframes?.unused || []).length ? ` — **${s.sourceFiles.keyframes.unused.length} were not playing during the scan** (${s.sourceFiles.keyframes.unused.slice(0, 6).join(', ')}${s.sourceFiles.keyframes.unused.length > 6 ? '…' : ''}); find where they are attached and keep them` : ''}. ${(s.sourceFiles.scripts || []).length} script${(s.sourceFiles.scripts || []).length === 1 ? '' : 's'} drive behaviour the rendered DOM can't show${s.sourceFiles.available ? ' — read them (and `source.html`) for interactions, carousels and scroll logic' : ' — rebuild those interactions, carousels and scroll effects yourself'}.`] : []), '',
      '## 4. Make it responsive', '',
      `Breakpoints: ${bp.length ? bp.map(b => `\`${b.kind}-width: ${b.px}px\``).join(', ') : 'none found — keep the layout fluid'}. Check the page at **1440, 1024, 768 and 390 px** and make the changes listed in SPEC.md → "Responsive behaviour" (columns, the burger menu, hidden elements, heading sizes).`, '',
      '## 5. Compare with the screenshots and fix the differences', '',
      'Open your page next to `screenshots/full-<width>.png` at each width (and `sections/…` for details, `states/…` for hover/open states). Fix anything off by more than a few pixels: sizes, gaps, line breaks, colours, radii, shadows.', '',
      '## 6. Branding and content', '',
      ...(own ? ['This is the owner\'s own site: the original texts and image file names in the spec may be used as they are. Fonts still need their licences.', 'For every image, SPEC.md gives its **role** (hero / feature / background / logo / icon), size, ratio, `object-fit`, radius and its **alt text** — use a picture that matches that subject and role (e.g. a real product or food photo where the alt/role says so), at the exact size and crop. Do not substitute grey boxes or unrelated stock for the hero and feature images.'] : [
        '- Use **placeholder branding**: the name "Brand", a neutral logo mark, generic icons of the same size and style.',
        '- **Do not reproduce** the original logos, trademarks, brand names, mascots, illustrations, photos or copy text. The screenshots have them painted over on purpose.',
        '- Texts: use the placeholder text in SPEC.md (same length, lines and style), or write your own.',
        '- Pictures: grey boxes or your own images with the exact size, ratio, `object-fit` and radius from SPEC.md.',
        '- Fonts: check licences; otherwise use the free alternatives named in SPEC.md.',
      ]), '',
      '## Acceptance criteria', '',
      `- At **1440px** the layout matches \`screenshots/full-1440.png\` within a few px per section: every region's height within ±4px of SPEC.md, columns, gaps and paddings exact.`,
      '- At **1024, 768 and 390px** every change listed in SPEC.md happens (and nothing else breaks).',
      `- All ${states.length} hover/focus states and all ${clicks.length} click behaviours in SPEC.md work, including how each thing closes.`,
      '- **Every** animation, scroll reveal and the hero\'s motion from the spec is present and visibly playing (a static rebuild fails this); animations use the listed names, durations, delays and easings; the scroll timeline behaves as described; reduced motion is respected.',
      ...(own ? [] : ['- No original branding, photos or copy appear anywhere.']),
      ...((s.approximations || []).length ? [`- The approximate parts (${s.approximations.map(a => a.what).join(', ')}) have a reasonable stand-in.`] : []),
      '',
    ];
    return out.join('\n');
  }

  // ——— the short version (pocket, claude.ai) ———
  D.pasteText = scan => {
    const s = scan.spec;
    const t = s.tokens || {};
    return [
      `Rebuild spec for ${scan.host} (made by Mochi Deep Scan). The full spec is in the attached zip "${D.zipName(scan)}" — start with PROMPT.md, then SPEC.md.`,
      '',
      `Outline: ${s.structure?.outline || ''}`,
      t.colors ? `Colours: ${t.colors.roles.map(c => `${c.role} ${c.hex}`).join(', ')}` : '',
      t.typography ? `Type: ${t.typography.families.map(f => f.family).join(', ')}; ${t.typography.scale.slice(0, 4).map(x => `${x.name} ${x.size}/${x.lineHeight}`).join(', ')}` : '',
      s.responsive?.breakpoints?.length ? `Breakpoints: ${s.responsive.breakpoints.map(b => `${b.kind}-width ${b.px}px`).join(', ')}` : '',
      `Behaviour: ${(s.states?.interactive || []).length} components with states, ${(s.states?.clicks || []).filter(c => c.opens?.length).length} click behaviours, ${(s.motion?.animations || []).length} animations, ${(s.scroll?.timeline || []).length} scroll effects.`,
      s.source.ownSite ? '' : 'Use placeholder branding and content (no original logos, names, photos or copy).',
      '',
      'Please rebuild this page from the attached spec (semantic HTML + CSS + vanilla JS unless I say otherwise), section by section, then check it against the screenshots at 1440, 1024, 768 and 390 px.',
    ].filter(x => x !== '').join('\n');
  };
  const prevPrompt = Mochi.promptFor;
  Mochi.promptFor = entry => (entry?.kind === 'deep' ? entry.paste : prevPrompt(entry));

  // ——— screenshot placeholders: paint texts and pictures over (unless own site) ———
  async function redact(shot) {
    if (!shot.redact || typeof OffscreenCanvas === 'undefined') return shot.data;
    try {
      const bmp = await createImageBitmap(new Blob([shot.data], { type: 'image/png' }));
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const g = cv.getContext('2d');
      g.drawImage(bmp, 0, 0);
      const sx = bmp.width / shot.clip.width, sy = bmp.height / shot.clip.height;
      for (const im of shot.redact.images) {
        const x = im.x * sx, y = im.y * sy, w = im.w * sx, h = im.h * sy;
        g.fillStyle = im.kind === 'icon' ? '#b9bcc4' : '#d5d8de';
        g.fillRect(x, y, w, h);
        if (im.kind !== 'icon' && w > 24 && h > 24) { g.strokeStyle = '#b4b8c1'; g.lineWidth = Math.max(1, Math.min(w, h) / 120); g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y + h); g.moveTo(x + w, y); g.lineTo(x, y + h); g.stroke(); }
      }
      for (const tb of shot.redact.texts) {
        const x = tb.x * sx, y = tb.y * sy, w = tb.w * sx, h = tb.h * sy;
        g.fillStyle = tb.color || '#888';
        g.globalAlpha = 0.28;
        const bar = Math.max(2, h * 0.55);
        g.fillRect(x, y + (h - bar) / 2, w, bar);
        g.globalAlpha = 1;
      }
      // Paint the bars over the real glyphs: first clear the glyph area with the colour just above it.
      const blob = await cv.convertToBlob({ type: 'image/png' });
      return new Uint8Array(await blob.arrayBuffer());
    } catch (_) { return shot.data; }
  }
  /** The text is still readable under a 28% bar: cover it first with the background behind it. */
  async function redactSolid(shot) {
    if (!shot.redact || typeof OffscreenCanvas === 'undefined') return shot.data;
    try {
      const bmp = await createImageBitmap(new Blob([shot.data], { type: 'image/png' }));
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      const sx = bmp.width / shot.clip.width, sy = bmp.height / shot.clip.height;
      for (const tb of shot.redact.texts) {
        const x = Math.round(tb.x * sx), y = Math.round(tb.y * sy), w = Math.max(1, Math.round(tb.w * sx)), h = Math.max(1, Math.round(tb.h * sy));
        if (x >= bmp.width || y >= bmp.height || x + w <= 0 || y + h <= 0) continue;
        const px = g.getImageData(Math.max(0, Math.min(bmp.width - 1, x - 2)), Math.max(0, Math.min(bmp.height - 1, y + Math.floor(h / 2))), 1, 1).data; // the background just left of the text
        g.fillStyle = `rgb(${px[0]}, ${px[1]}, ${px[2]})`;
        g.fillRect(x - 1, y, w + 2, h);
      }
      const base = await cv.convertToBlob({ type: 'image/png' });
      return redact({ ...shot, data: new Uint8Array(await base.arrayBuffer()) });
    } catch (_) { return shot.data; }
  }

  D.writers.push(scan => [
    { name: 'PROMPT.md', data: promptMd(scan) },
    { name: 'tokens.css', data: tokensCss(scan) },
    { name: 'tailwind.config.js', data: tailwindConfig(scan) },
    // The page's own source, verbatim — the files, not just the render (see src/deep-scan/source.js).
    ...(scan.sourceRaw?.css ? [{ name: 'source.css', data: scan.sourceRaw.css }] : []),
    ...(scan.sourceRaw?.html ? [{ name: 'source.html', data: scan.sourceRaw.html }] : []),
    // The real font files the @font-face rules point at (own site only).
    ...(scan.sourceRaw?.fonts || []).map(f => ({ name: `fonts/${f.name}`, data: f.data })),
  ]);
  D.redactShot = shot => redactSolid(shot);
  Mochi.deepOutputFiles = { tokensCss, tailwindConfig, promptMd, redact: redactSolid };
})();
