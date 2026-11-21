/*
 * Mochi — vibe classification. Rule-based, no AI: each style below scores
 * a scan with a few simple checks; the best one or two win.
 *
 * Edit VIBES to tune it: every rule is [points, test(f), reason] (points may be
 * negative to rule a style out), where f is
 * the set of facts computed from the scan in facts() (dark, neon, mono,
 * serif, radius, hardShadows, …). `do` / `dont` become notes in the AI
 * prompt and DESIGN.md.
 *
 * Works in the page and in Node (no DOM needed), so it is easy to test.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  const VIBES = [
    {
      id: 'soft-modern', label: 'soft modern',
      rules: [
        [2, f => f.radius >= 8 && f.radius <= 24, 'rounded corners'],
        [2, f => f.softShadows >= 1, 'soft, blurred shadows'],
        [1, f => !f.dark, 'light background'],
        [1, f => f.sans, 'clean sans-serif type'],
        [1, f => f.saturatedCount >= 1 && f.saturatedCount <= 3, 'one or two calm accent colors'],
        [0.5, f => f.gradients >= 1 && !f.glass, 'gentle gradients'],
      ],
      do: ['Use generous rounded corners and soft, low-opacity shadows', 'Keep one clear primary color', 'Leave comfortable spacing between sections'],
      dont: ['No hard black shadows or thick outlines', 'Avoid sharp 0px corners on cards and buttons'],
    },
    {
      id: 'minimal', label: 'minimal / clean',
      rules: [
        [2, f => f.saturatedCount <= 1, 'almost no color'],
        [1.5, f => f.shadowCount === 0 || f.softShadows === f.shadowCount && f.shadowCount <= 1, 'flat or nearly flat surfaces'],
        [1, f => f.radius <= 8, 'small or no corner radius'],
        [1, f => f.sans, 'plain sans-serif type'],
        [1, f => f.whitespace, 'lots of whitespace'],
        [0.5, f => !f.gradients && !f.glass, 'no decorative effects'],
        [-2, f => f.serifHeading, 'serif headlines read as editorial, not minimal'],
      ],
      do: ['Use a near-monochrome palette with one accent at most', 'Let whitespace and typography do the work', 'Keep borders hairline-thin'],
      dont: ['No gradients, glows or heavy shadows', 'Avoid more than two font weights'],
    },
    {
      id: 'glassmorphism', label: 'glassmorphism',
      rules: [
        [4, f => f.glass, 'frosted glass (backdrop blur)'],
        [1.5, f => f.translucent >= 3, 'translucent surfaces'],
        [1.5, f => f.gradients >= 1, 'colorful gradient backdrop'],
        [0.5, f => f.radius >= 12, 'large rounded panels'],
      ],
      do: ['Put translucent panels with backdrop-filter: blur() over a colorful gradient', 'Use thin light borders (1px, ~20% white) on glass', 'Keep text high-contrast on the glass'],
      dont: ['No opaque flat cards', 'Avoid busy content behind the glass where text sits'],
    },
    {
      id: 'neo-brutalist', label: 'neo-brutalist / punk',
      rules: [
        [3, f => f.hardShadows >= 1, 'hard offset shadows'],
        [2, f => f.thickBorders, 'thick dark outlines'],
        [1, f => f.radius <= 2, 'square corners'],
        [1.5, f => f.saturatedCount >= 2 && !f.dark, 'loud flat colors'],
        [1, f => f.heavyType, 'very bold type'],
      ],
      do: ['Use 2–4px solid black borders and hard offset shadows (e.g. 4px 4px 0 #000)', 'Flat, loud fills; no gradients', 'Big, heavy headings'],
      dont: ['No blur, soft shadows or glass', 'Avoid subtle pastel-only palettes'],
    },
    {
      id: 'tech-lab', label: 'tech lab / cyber',
      rules: [
        [2, f => f.dark, 'dark page'],
        [2.5, f => f.neon, 'neon accents'],
        [2, f => f.mono, 'monospace type'],
        [1, f => f.glow, 'glowing shadows'],
        [0.5, f => f.radius <= 6, 'sharp, technical corners'],
      ],
      do: ['Dark background with 1–2 neon accents (cyan, green, magenta)', 'Monospace for labels, headings or data', 'Thin grid lines and subtle glows'],
      dont: ['No warm pastel palettes', 'Avoid big rounded bubbly shapes'],
    },
    {
      id: 'retro-pixel', label: 'retro / pixel',
      rules: [
        [4, f => f.pixel, 'pixel font'],
        [1, f => f.radius === 0, 'square pixel corners'],
        [1, f => f.hardShadows >= 1, 'blocky drop shadows'],
        [0.5, f => f.mono, 'monospace text'],
      ],
      do: ['Pixel or bitmap fonts for headings', 'Square corners, chunky 2–4px borders, stepped shadows', 'A small limited palette'],
      dont: ['No smooth gradients or blur', 'Avoid thin modern sans for headings'],
    },
    {
      id: 'corporate', label: 'corporate / enterprise',
      rules: [
        [2, f => f.blueish, 'trustworthy blue primary'],
        [1, f => f.radius >= 2 && f.radius <= 6, 'modest corner radius'],
        [1, f => f.sans, 'neutral sans-serif'],
        [1, f => !f.dark, 'light background'],
        [1, f => f.componentKinds >= 4, 'many standard components (nav, buttons, inputs, cards)'],
        [0.5, f => f.denseSpacing, 'compact spacing'],
      ],
      do: ['Blue or navy primary on white/grey surfaces', 'Clear hierarchy, consistent 4–6px radius', 'Predictable forms, tables and navigation'],
      dont: ['No playful shapes, neon or decorative fonts', 'Avoid strong gradients'],
    },
    {
      id: 'playful', label: 'playful / bubbly',
      rules: [
        [2, f => f.radius >= 16 || f.pills, 'big round, pill shapes'],
        [2, f => f.saturatedCount >= 3, 'many bright colors'],
        [1.5, f => f.rounded, 'rounded friendly font'],
        [0.5, f => f.heavyType, 'chunky bold type'],
        [0.5, f => f.animations, 'motion and bounce'],
      ],
      do: ['Pill buttons, big radii and bouncy hover states', 'Several cheerful colors', 'Rounded, friendly typefaces'],
      dont: ['No sharp corners or austere monochrome', 'Avoid tiny, thin text'],
    },
    {
      id: 'editorial', label: 'editorial / magazine',
      rules: [
        [2.5, f => f.serifHeading, 'serif headlines'],
        [1.5, f => f.bigScale, 'large headline scale'],
        [1, f => f.saturatedCount <= 2, 'restrained color'],
        [0.5, f => f.columns >= 2, 'multi-column layout'],
        [0.5, f => !f.dark, 'paper-like background'],
      ],
      do: ['Large serif headlines with tight line-height', 'Readable body columns (60–75 characters)', 'Hairline rules between sections'],
      dont: ['No heavy shadows or rounded app-like cards', 'Avoid more than one accent color'],
    },
    {
      id: 'luxury', label: 'luxury / elegant',
      rules: [
        [2, f => f.serifHeading || f.serifBody, 'serif type'],
        [1.5, f => f.whitespace, 'lots of whitespace'],
        [1.5, f => f.saturatedCount === 0, 'muted palette'],
        [1, f => f.wideTracking, 'wide letter-spacing'],
        [1, f => f.lightHeadings, 'light-weight headings'],
        [0.5, f => f.dark || f.cream, 'black or cream backdrop'],
      ],
      do: ['Thin serif headings with wide tracking', 'Muted neutrals (black, ivory, champagne)', 'Very generous whitespace'],
      dont: ['No bright saturated colors or emoji', 'Avoid crowded layouts and chunky buttons'],
    },
  ];

  // ——— facts from a scan (pure; no DOM) ———
  const rgb = h => { const n = parseInt(String(h).slice(1, 7), 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; };
  const hsl = ({ r, g, b }) => {
    const R = r / 255, G = g / 255, B = b / 255, max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    return { h: h * 60, s, l };
  };
  const saturated = h => { const c = hsl(rgb(h)); return c.s > 0.38 && c.l > 0.18 && c.l < 0.86; };

  /** Parses a CSS box-shadow list into its first layer's numbers. */
  function shadowParts(css) {
    return String(css).split(/,(?![^(]*\))/).map(layer => {
      const color = (layer.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}|oklch\([^)]*\)/i) || [''])[0];
      const nums = layer.replace(color, '').match(/-?[\d.]+px|\b0\b/g) || [];
      const [x = 0, y = 0, blur = 0] = nums.map(n => parseFloat(n));
      const alpha = (color.match(/rgba?\([^)]*[,/]\s*([\d.]+)\s*\)/) || [])[1];
      const ch = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
      const colorful = ch ? saturated(`#${[ch[1], ch[2], ch[3]].map(v => (+v).toString(16).padStart(2, '0')).join('')}`) : false;
      return { x, y, blur, alpha: alpha === undefined ? 1 : +alpha, colorful, inset: /inset/.test(layer) };
    });
  }

  function facts(scan) {
    const colors = scan.colors || [];
    const sat = colors.filter(c => c.role !== 'background' && saturated(c.hex));
    const primary = colors.find(c => c.role === 'primary');
    const radii = scan.shape?.radii || [];
    const radiusMain = radii.filter(r => r.px !== 9999).sort((a, b) => b.count - a.count)[0]?.px ?? 0;
    const layers = (scan.shape?.shadows || []).flatMap(shadowParts).filter(l => !l.inset);
    const t = scan.typography || {};
    const kinds = t.kinds || {};
    const bg = colors.find(c => c.role === 'background');
    const bgHsl = bg ? hsl(rgb(bg.hex)) : { h: 0, s: 0, l: 1 };
    const spacingScale = scan.spacing?.scale || [];
    const comps = scan.components || {};
    return {
      dark: scan.theme === 'dark',
      cream: bgHsl.l > 0.88 && bgHsl.s > 0.2 && bgHsl.h >= 30 && bgHsl.h <= 60,
      saturatedCount: sat.length,
      neon: scan.theme === 'dark' && sat.some(c => { const x = hsl(rgb(c.hex)); return x.s > 0.75 && x.l > 0.45 && x.l < 0.75; }),
      blueish: !!primary && (() => { const x = hsl(rgb(primary.hex)); return x.h >= 195 && x.h <= 235 && x.s > 0.4; })(),
      radius: radiusMain,
      pills: radii.some(r => r.px === 9999 && r.count >= 2),
      shadowCount: layers.length,
      softShadows: layers.filter(l => l.blur >= 6 && l.alpha <= 0.35 && !l.colorful).length,
      hardShadows: layers.filter(l => l.blur <= 1 && (Math.abs(l.x) >= 2 || Math.abs(l.y) >= 2) && l.alpha >= 0.6).length,
      glow: layers.some(l => l.colorful && l.blur >= 6),
      thickBorders: (scan.shape?.borderWidths || []).some(w => w >= 2) && colors.some(c => c.role === 'border' && hsl(rgb(c.hex)).l < 0.2),
      glass: !!scan.effects?.glass,
      translucent: scan.effects?.translucentSurfaces || 0,
      gradients: (scan.effects?.gradients || []).length,
      animations: !!scan.effects?.animations,
      mono: !!kinds.mono || !!t.mono && (t.mono === t.heading?.family || t.mono === t.body?.family),
      pixel: !!kinds.pixel,
      rounded: !!kinds.rounded,
      sans: !!kinds.sans,
      serifHeading: !!kinds.headingSerif,
      serifBody: !!kinds.bodySerif,
      heavyType: (t.heading?.weights || []).some(w => w >= 800),
      lightHeadings: (t.heading?.weights || []).length > 0 && (t.heading.weights).every(w => w <= 400),
      wideTracking: parseFloat(t.heading?.letterSpacing) >= 0.04,
      bigScale: (t.heading?.maxSize || 0) >= (t.body?.size || 16) * 3,
      whitespace: spacingScale.filter(v => v >= 48).length >= 2,
      denseSpacing: spacingScale.length > 0 && Math.max(...spacingScale) <= 32,
      columns: scan.layout?.columns || 1,
      componentKinds: Object.values(comps).filter(Boolean).length,
    };
  }

  /** The best one or two vibes: [{ id, label, score, reason, do, dont }]. */
  function classifyVibe(scan) {
    const f = facts(scan);
    const scored = VIBES.map(v => {
      const hits = v.rules.filter(([, test]) => { try { return test(f); } catch (_) { return false; } });
      // Negative rules lower the score; only positive ones become reasons.
      return { v, score: hits.reduce((s, [p]) => s + p, 0), reasons: hits.filter(([p]) => p > 0).sort((a, b) => b[0] - a[0]).map(([, , r]) => r) };
    }).sort((a, b) => b.score - a.score);
    const [first, second] = scored;
    const picked = [first];
    if (second && second.score >= 3 && second.score >= first.score * 0.8) picked.push(second);
    return picked.map(({ v, score, reasons }) => ({
      id: v.id, label: v.label, score: Math.round(score * 10) / 10,
      reason: reasons.slice(0, 3).join(', ') || 'a mix of styles',
      do: v.do, dont: v.dont,
    }));
  }

  Mochi.VIBES = VIBES;
  Mochi.vibeFacts = facts;
  Mochi.classifyVibe = classifyVibe;
})();
