/*
 * Mochi — scan exports. Turns a UI scan (see ui-scan.js) into text you can
 * paste or save:
 *
 *   Mochi.exporters.prompt(scan)    AI prompt: "Build a UI in this exact style: …"
 *   Mochi.exporters.designMd(scan)  DESIGN.md spec for AI agents
 *   Mochi.exporters.css(scan)       :root { --color-primary: … }
 *   Mochi.exporters.tailwind(scan)  tailwind.config.js theme.extend
 *   Mochi.exporters.json(scan)      JSON tokens
 *
 * Pure functions: no DOM, no network. They run in the page and in Node
 * (test/export.test.js).
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  const ROLE_ORDER = ['background', 'surface', 'text', 'muted', 'primary', 'accent', 'border'];

  // ——— tokens: the scan, normalized into names ———
  function tokens(scan) {
    const colors = {};
    const used = {};
    for (const c of [...(scan.colors || [])].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))) {
      used[c.role] = (used[c.role] || 0) + 1;
      colors[used[c.role] === 1 ? c.role : `${c.role}-${used[c.role]}`] = c.hex;
    }
    const t = scan.typography || {};
    // The page's own font stack (cleaned), so a recreation falls back the way the page does.
    const stack = (family, kind, pageStack) => {
      if (!family) return null;
      const fallback = kind === 'mono' ? 'ui-monospace, monospace' : kind === 'serif' ? 'Georgia, serif' : 'system-ui, sans-serif';
      const generic = /^(system-ui|serif|sans-serif|monospace|ui-\w+|-apple-system|blinkmacsystemfont)$/i;
      const named = [family, ...(pageStack || [])].filter((n, i, all) => !generic.test(n) && all.findIndex(m => m.toLowerCase() === n.toLowerCase()) === i).slice(0, 3);
      return named.length ? `${named.map(n => `"${n}"`).join(', ')}, ${fallback}` : fallback;
    };
    const kinds = t.kinds || {};
    const fonts = {
      heading: stack(t.heading?.family, kinds.headingSerif ? 'serif' : kinds.mono && /mono|code/i.test(t.heading?.family) ? 'mono' : 'sans', t.heading?.stack),
      body: stack(t.body?.family, kinds.bodySerif ? 'serif' : 'sans', t.body?.stack),
      mono: stack(t.mono, 'mono', t.monoStack),
    };
    const sizeNames = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl'];
    const scale = [...new Set(t.scale || [])].sort((a, b) => a - b);
    const baseIndex = Math.max(0, scale.indexOf(t.body?.size ?? 16));
    const fontSizes = {};
    scale.forEach((s, i) => {
      const idx = Math.max(0, Math.min(sizeNames.length - 1, 2 + (i - baseIndex)));
      let name = sizeNames[idx];
      while (fontSizes[name]) name = `${name}+`;
      fontSizes[name] = `${s}px`;
    });
    const radiiPx = (scan.shape?.radii || []).map(r => r.px).filter(v => v !== 9999).sort((a, b) => a - b);
    const radius = {};
    ['sm', 'md', 'lg', 'xl'].forEach((n, i) => { if (radiiPx[i] !== undefined && radiiPx[i] > 0) radius[n] = `${radiiPx[i]}px`; });
    if ((scan.shape?.radii || []).some(r => r.px === 9999)) radius.full = '9999px';
    const shadows = {};
    (scan.shape?.shadows || []).forEach((s, i) => { shadows[['sm', 'md', 'lg', 'xl'][i]] = s; });
    const spacing = {};
    (scan.spacing?.scale || []).forEach((v, i) => { spacing[i + 1] = `${v}px`; });
    return { colors, fonts, fontSizes, radius, shadows, spacing, maxWidth: scan.layout?.maxWidth ? `${scan.layout.maxWidth}px` : null };
  }

  const describe = c => !c ? null : [
    c.bg && c.bg !== 'transparent' ? `background ${c.bg}` : 'transparent background',
    `text ${c.color}`,
    `radius ${c.radius}`,
    `padding ${c.padding}`,
    c.border && c.border !== 'none' ? `border ${c.border}` : 'no border',
    c.shadow && c.shadow !== 'none' ? `shadow ${c.shadow}` : null,
    c.font ? `font ${c.font}` : null,
    c.blur ? 'backdrop blur' : null,
    c.sticky ? 'sticky' : null,
  ].filter(Boolean).join(', ');

  const COMPONENT_NAMES = {
    buttonPrimary: 'Primary button', buttonSecondary: 'Secondary button', card: 'Card',
    navbar: 'Navbar', input: 'Input', badge: 'Badge / pill',
  };
  const vibeLine = scan => (scan.vibe || []).map(v => v.label).join(' + ') || 'clean modern';
  const date = scan => (scan.at || '').slice(0, 10);
  const effectsList = scan => {
    const e = scan.effects || {};
    return [
      e.gradients?.length ? `gradients (${e.gradients.slice(0, 2).join(' ; ')})` : null,
      e.glass ? (e.glass.panels !== undefined && e.glass.panels < 2 ? `a few frosted details (backdrop-filter: blur(${e.glass.blur}px))` : `glassmorphism: translucent panels with backdrop-filter: blur(${e.glass.blur}px)`) : null,
      e.transitions ? 'smooth transitions on interactive elements' : null,
      e.animations ? 'some CSS animations' : null,
      e.bgImages ? 'large background images' : null,
      e.noise ? 'subtle noise/grain texture' : null,
    ].filter(Boolean);
  };
  const notes = scan => {
    const dos = [...new Set((scan.vibe || []).flatMap(v => v.do || []))];
    const donts = [...new Set((scan.vibe || []).flatMap(v => v.dont || []))];
    return { dos, donts };
  };
  const layoutLine = scan => {
    const l = scan.layout || {};
    return [
      l.maxWidth ? `max content width ${l.maxWidth}px, centered` : 'fluid width',
      l.columns > 1 ? `${l.columns}-column sections` : 'single-column sections',
      l.grid > l.flex / 4 ? 'CSS grid for sections' : 'flexbox rows',
      l.stickyHeader ? 'sticky header' : null,
    ].filter(Boolean).join(', ');
  };

  // ——— CSS variables ———
  function css(scan) {
    const tk = tokens(scan);
    const lines = [`/* ${scan.title || scan.host} — UI tokens by Mochi (${date(scan)}) · vibe: ${vibeLine(scan)} */`, ':root {'];
    for (const [k, v] of Object.entries(tk.colors)) lines.push(`  --color-${k}: ${v};`);
    if (tk.fonts.heading) lines.push(`  --font-heading: ${tk.fonts.heading};`);
    if (tk.fonts.body) lines.push(`  --font-body: ${tk.fonts.body};`);
    if (tk.fonts.mono) lines.push(`  --font-mono: ${tk.fonts.mono};`);
    for (const [k, v] of Object.entries(tk.fontSizes)) lines.push(`  --text-${k.replace(/\+/g, 'plus')}: ${v};`);
    const t = scan.typography || {};
    if (t.body?.lineHeight) lines.push(`  --leading-body: ${t.body.lineHeight};`);
    if (t.heading?.lineHeight) lines.push(`  --leading-heading: ${t.heading.lineHeight};`);
    if (t.heading?.letterSpacing && parseFloat(t.heading.letterSpacing) !== 0) lines.push(`  --tracking-heading: ${t.heading.letterSpacing};`);
    for (const [k, v] of Object.entries(tk.radius)) lines.push(`  --radius-${k}: ${v};`);
    for (const [k, v] of Object.entries(tk.shadows)) lines.push(`  --shadow-${k}: ${v};`);
    for (const [k, v] of Object.entries(tk.spacing)) lines.push(`  --space-${k}: ${v};`);
    if (tk.maxWidth) lines.push(`  --max-width: ${tk.maxWidth};`);
    if (scan.effects?.glass) lines.push(`  --glass-blur: ${scan.effects.glass.blur}px;`);
    lines.push('}');
    return lines.join('\n');
  }

  // ——— Tailwind ———
  function tailwind(scan) {
    const tk = tokens(scan);
    const split = stack => stack ? stack.split(/,\s*/).map(s => s.replace(/"/g, '')) : undefined;
    const extend = {
      colors: tk.colors,
      fontFamily: Object.fromEntries(Object.entries({ heading: split(tk.fonts.heading), body: split(tk.fonts.body), mono: split(tk.fonts.mono) }).filter(([, v]) => v)),
      fontSize: Object.fromEntries(Object.entries(tk.fontSizes).map(([k, v]) => [k.replace(/\+/g, '-plus'), v])),
      borderRadius: tk.radius,
      boxShadow: tk.shadows,
      spacing: Object.fromEntries(Object.entries(tk.spacing).map(([k, v]) => [`s${k}`, v])),
      ...(tk.maxWidth ? { maxWidth: { content: tk.maxWidth } } : {}),
      ...(scan.effects?.glass ? { backdropBlur: { glass: `${scan.effects.glass.blur}px` } } : {}),
    };
    return [
      `// ${scan.title || scan.host} — Tailwind theme by Mochi (${date(scan)}) · vibe: ${vibeLine(scan)}`,
      `/** @type {import('tailwindcss').Config} */`,
      `module.exports = {`,
      `  darkMode: 'class',`,
      `  theme: {`,
      `    extend: ${JSON.stringify(extend, null, 2).replace(/\n/g, '\n    ')},`,
      `  },`,
      `};`,
    ].join('\n');
  }

  // ——— JSON ———
  function json(scan) {
    const { stats, id, ...rest } = scan;
    return JSON.stringify({
      $schema: 'mochi-ui-scan/v1',
      source: { url: scan.url, title: scan.title, host: scan.host, scannedAt: scan.at },
      theme: scan.theme,
      vibe: (scan.vibe || []).map(({ id: vid, label, reason }) => ({ id: vid, label, reason })),
      tokens: tokens(scan),
      typography: rest.typography,
      shape: rest.shape,
      spacing: rest.spacing,
      layout: rest.layout,
      components: rest.components,
      effects: rest.effects,
    }, null, 2);
  }

  // ——— AI prompt ———
  function prompt(scan) {
    const tk = tokens(scan);
    const t = scan.typography || {};
    const { dos, donts } = notes(scan);
    const comps = Object.entries(COMPONENT_NAMES).map(([k, name]) => scan.components?.[k] ? `- ${name}: ${describe(scan.components[k])}` : null).filter(Boolean);
    const fx = effectsList(scan);
    const vibes = (scan.vibe || []).map(v => `${v.label} (${v.reason})`).join('; ');
    return [
      `Build a UI in this exact style: ${vibeLine(scan)}, like ${scan.host}.`,
      '',
      `Overall feel: ${vibes || 'clean and modern'}. ${scan.theme === 'dark' ? 'Dark' : 'Light'} theme.`,
      '',
      'Colors (use these exact values):',
      ...Object.entries(tk.colors).map(([k, v]) => `- ${k}: ${v}`),
      '',
      'Typography:',
      `- Headings: ${tk.fonts.heading || 'system sans'}, weights ${(t.heading?.weights || [700]).join('/')}, line-height ${t.heading?.lineHeight ?? 1.2}${parseFloat(t.heading?.letterSpacing) ? `, letter-spacing ${t.heading.letterSpacing}` : ''}`,
      `- Body: ${tk.fonts.body || 'system sans'}, ${t.body?.size ?? 16}px, weight ${t.body?.weight ?? 400}, line-height ${t.body?.lineHeight ?? 1.5}`,
      t.mono ? `- Mono: ${tk.fonts.mono}` : null,
      `- Type scale: ${(t.scale || []).map(s => `${s}px`).join(', ')}`,
      '',
      'Shape:',
      `- Corner radius: ${Object.values(tk.radius).join(', ') || '0px (square corners)'}`,
      `- Shadows: ${(scan.shape?.shadows || []).length ? scan.shape.shadows.join(' | ') : 'none (flat)'}`,
      `- Border widths: ${(scan.shape?.borderWidths || []).map(w => `${w}px`).join(', ') || 'none'}`,
      '',
      `Spacing: ${scan.spacing?.base ? `${scan.spacing.base}px base grid; ` : ''}scale ${(scan.spacing?.scale || []).map(v => `${v}px`).join(', ')}`,
      `Layout: ${layoutLine(scan)}`,
      '',
      comps.length ? 'Components:' : null,
      ...comps,
      comps.length ? '' : null,
      fx.length ? `Effects: ${fx.join('; ')}.` : 'Effects: none, keep it flat.',
      '',
      dos.length ? 'Do:' : null,
      ...dos.map(d => `- ${d}`),
      donts.length ? "Don't:" : null,
      ...donts.map(d => `- ${d}`),
      '',
      'Use these CSS variables:',
      '```css',
      css(scan),
      '```',
    ].filter(line => line !== null).join('\n');
  }

  // ——— DESIGN.md ———
  function designMd(scan) {
    const tk = tokens(scan);
    const t = scan.typography || {};
    const { dos, donts } = notes(scan);
    const row = (...cells) => `| ${cells.join(' | ')} |`;
    const comps = Object.entries(COMPONENT_NAMES).filter(([k]) => scan.components?.[k]);
    const fx = effectsList(scan);
    return [
      `# DESIGN.md — ${scan.title || scan.host}`,
      '',
      `> Design spec extracted by Mochi from ${scan.url || scan.host} on ${date(scan)}.`,
      '> Follow it exactly when building UI in this style.',
      '',
      '## Vibe',
      '',
      ...(scan.vibe || []).map(v => `- **${v.label}**: ${v.reason}`),
      `- Theme: **${scan.theme}**`,
      '',
      '## Colors',
      '',
      row('Token', 'Value', 'Role'),
      row('---', '---', '---'),
      ...Object.entries(tk.colors).map(([k, v]) => row(`\`--color-${k}\``, `\`${v}\``, k.replace(/-\d+$/, ''))),
      '',
      '## Typography',
      '',
      `- **Headings:** ${tk.fonts.heading || 'system sans'}; weights ${(t.heading?.weights || []).join(', ') || '700'}; line-height ${t.heading?.lineHeight ?? 1.2}; letter-spacing ${t.heading?.letterSpacing || '0em'}`,
      `- **Body:** ${tk.fonts.body || 'system sans'}; ${t.body?.size ?? 16}px; weight ${t.body?.weight ?? 400}; line-height ${t.body?.lineHeight ?? 1.5}`,
      t.mono ? `- **Mono:** ${tk.fonts.mono}` : null,
      `- **Scale:** ${(t.scale || []).map(s => `${s}px`).join(' · ')}`,
      `- **Weights in use:** ${(t.weights || []).join(', ')}`,
      '',
      '## Shape',
      '',
      `- **Radius:** ${Object.entries(tk.radius).map(([k, v]) => `${k} ${v}`).join(', ') || 'square (0px)'}`,
      `- **Shadows:** ${(scan.shape?.shadows || []).length ? '' : 'none'}`,
      ...(scan.shape?.shadows || []).map((s, i) => `  - \`--shadow-${['sm', 'md', 'lg', 'xl'][i]}\`: \`${s}\``),
      `- **Borders:** ${(scan.shape?.borderWidths || []).map(w => `${w}px`).join(', ') || 'none'}`,
      '',
      '## Spacing',
      '',
      `- **Base unit:** ${scan.spacing?.base ? `${scan.spacing.base}px` : 'no strict grid'}`,
      `- **Scale:** ${(scan.spacing?.scale || []).map(v => `${v}px`).join(' · ')}`,
      '',
      '## Layout',
      '',
      `- ${layoutLine(scan)}`,
      '',
      '## Components',
      '',
      ...(comps.length ? comps.map(([k, name]) => `### ${name}\n\n${describe(scan.components[k])}\n`) : ['_No standard components detected._', '']),
      '## Effects',
      '',
      ...(fx.length ? fx.map(f => `- ${f}`) : ['- None: flat surfaces.']),
      '',
      '## Rules',
      '',
      ...dos.map(d => `- ✅ ${d}`),
      ...donts.map(d => `- ❌ ${d}`),
      '- ✅ Use the tokens above instead of new values; keep spacing on the scale.',
      '',
      '## CSS variables',
      '',
      '```css',
      css(scan),
      '```',
      '',
    ].filter(line => line !== null).join('\n');
  }

  // ——— one picked component (picker.js) ———
  /** Long data: images in markup/CSS become a short note, so a prompt stays about the design. */
  const shortData = text => String(text).replace(/data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]{120,}|data:image\/svg\+xml[^"')\s]{300,}/g, 'data:… (image)');
  const cap = (text, max) => (text.length > max ? `${text.slice(0, max)}\n/* … trimmed by Mochi (${text.length - max} more characters) */` : text);

  function componentStyleCss(cmp) {
    const first = (cmp.css || '').split('\n\n').filter(block => block.startsWith('.mochi-pick {') || block.startsWith('.mochi-pick:hover {') || block.startsWith('@keyframes'));
    return [`/* ${cmp.name} from ${cmp.host} — picked by Mochi (${date(cmp)}) */`, ...first].join('\n\n');
  }

  function componentHtml(cmp) {
    return [
      `<!-- ${cmp.name} from ${cmp.host} (${cmp.selector}) — picked by Mochi on ${date(cmp)} -->`,
      '<style>',
      cmp.css,
      '</style>',
      '',
      cmp.html,
    ].join('\n');
  }

  /** Tailwind arbitrary-value classes for the picked element itself. */
  function componentTailwind(cmp) {
    const s = cmp.style || {};
    const arb = v => String(v).trim().replace(/\s+/g, '_');
    const cls = [];
    if (/flex/.test(s.display)) cls.push(s.display === 'inline-flex' ? 'inline-flex' : 'flex', 'items-center');
    else if (s.display === 'inline-block') cls.push('inline-block');
    if (s.gap) cls.push(`gap-[${arb(s.gap)}]`);
    if (s.background && s.background !== 'transparent') cls.push(`bg-[${arb(s.background)}]`);
    if (s.backgroundImage && /gradient/.test(s.backgroundImage)) cls.push(`bg-[${arb(s.backgroundImage)}]`);
    if (s.color) cls.push(`text-[${arb(s.color)}]`);
    if (s.font?.family) cls.push(`font-['${String(s.font.family).replace(/\s+/g, '_')}']`);
    if (s.font?.size) cls.push(`text-[${s.font.size}]`);
    if (s.font?.weight && s.font.weight !== '400') cls.push(`font-[${s.font.weight}]`);
    if (s.font?.lineHeight && s.font.lineHeight !== 'normal') cls.push(`leading-[${s.font.lineHeight}]`);
    if (s.font?.letterSpacing && s.font.letterSpacing !== 'normal' && parseFloat(s.font.letterSpacing) !== 0) cls.push(`tracking-[${s.font.letterSpacing}]`);
    if (s.font?.transform) cls.push(s.font.transform === 'uppercase' ? 'uppercase' : s.font.transform === 'lowercase' ? 'lowercase' : 'capitalize');
    const pad = String(s.padding || '').split(/\s+/).filter(Boolean);
    if (pad.length && pad.some(p => parseFloat(p) > 0)) {
      const [t, r = t, b = t, l = r] = pad;
      if (t === b && r === l) cls.push(`py-[${t}]`, `px-[${r}]`);
      else cls.push(`pt-[${t}]`, `pr-[${r}]`, `pb-[${b}]`, `pl-[${l}]`);
    }
    if (s.radius && parseFloat(s.radius) > 0) cls.push(parseFloat(s.radius) >= 999 ? 'rounded-full' : `rounded-[${arb(s.radius)}]`);
    if (s.border && s.border !== 'none') {
      const [w, style, ...color] = s.border.split(' ');
      cls.push(`border-[${w}]`, style !== 'solid' ? `border-${style}` : null, `border-[${arb(color.join(' '))}]`);
    }
    if (s.shadow && s.shadow !== 'none') cls.push(`shadow-[${arb(s.shadow)}]`);
    const blur = s.backdrop && s.backdrop.match(/blur\(([^)]+)\)/);
    if (blur) cls.push(`backdrop-blur-[${blur[1]}]`);
    if (s.transition) cls.push('transition');
    const h = cmp.hover || {};
    if (h['background-color']) cls.push(`hover:bg-[${arb(h['background-color'])}]`);
    if (h.color) cls.push(`hover:text-[${arb(h.color)}]`);
    if (h['box-shadow']) cls.push(`hover:shadow-[${arb(h['box-shadow'])}]`);
    if (h['border-color']) cls.push(`hover:border-[${arb(h['border-color'])}]`);
    if (h.transform) cls.push(`hover:[transform:${arb(h.transform)}]`);
    if (h.opacity) cls.push(`hover:opacity-[${h.opacity}]`);
    const classes = cls.filter(Boolean).join(' ');
    const tag = cmp.name === 'button' ? 'button' : cmp.name === 'link' ? 'a' : 'div';
    return [
      `<!-- ${cmp.name} from ${cmp.host}, as Tailwind classes (picked by Mochi) -->`,
      `<${tag} class="${classes}">${cmp.label ? cmp.label.replace(/</g, '&lt;') : cmp.name}</${tag}>`,
      '',
      `class="${classes}"`,
    ].join('\n');
  }

  function componentLook(cmp) {
    const s = cmp.style || {};
    return [
      s.background && s.background !== 'transparent' ? `background ${s.background}` : 'transparent background',
      s.backgroundImage && /gradient/.test(s.backgroundImage) ? `background-image ${s.backgroundImage}` : null,
      `text ${s.color}`,
      s.font ? `font ${s.font.stack || s.font.family} ${s.font.size}, weight ${s.font.weight}, line-height ${s.font.lineHeight}${s.font.letterSpacing && s.font.letterSpacing !== 'normal' ? `, letter-spacing ${s.font.letterSpacing}` : ''}${s.font.transform ? `, ${s.font.transform}` : ''}` : null,
      `padding ${s.padding}`,
      `corner radius ${s.radius}`,
      s.border !== 'none' ? `border ${s.border}` : 'no border',
      s.shadow !== 'none' ? `shadow ${s.shadow}` : 'no shadow',
      s.backdrop ? `backdrop-filter ${s.backdrop}` : null,
      s.transition ? `transition ${s.transition}` : null,
      s.animation ? `animation ${s.animation} (the @keyframes are in the CSS)` : null,
      cmp.media?.length ? `contains ${cmp.media.map(m => m.tag).join(', ')} (snapshot kept by Mochi)` : null,
    ].filter(Boolean);
  }

  function componentPrompt(cmp) {
    const hover = cmp.hover ? Object.entries(cmp.hover).map(([p, v]) => `${p}: ${v}`).join('; ') : null;
    return [
      `Recreate this ${cmp.name} from ${cmp.host} exactly, as a reusable component.`,
      '',
      'Look (use these exact values):',
      ...componentLook(cmp).map(l => `- ${l}`),
      hover ? `- on hover: ${hover}` : '- hover: not found in the page’s own stylesheets; add a subtle one in the same spirit',
      cmp.label ? `- label in the original: "${cmp.label}"` : null,
      cmp.style?.size ? `- size in the original: ${cmp.style.size.width}×${cmp.style.size.height}px` : null,
      '',
      'Original markup and CSS (cleaned by Mochi):',
      '```html',
      cap(shortData(cmp.html || ''), 5000),
      '```',
      '```css',
      cap(shortData(cmp.css || ''), 6000),
      '```',
      '',
      cmp.media?.length ? 'Images, canvas and video: keep the same size and position; use a placeholder where the original picture isn’t available.' : null,
      cmp.style?.animation ? 'Keep the animation (same timing and easing), and turn it off under prefers-reduced-motion.' : null,
      'Keep the values exact, give it a visible :focus-visible state, and make it work at any width.',
    ].filter(line => line !== null).join('\n');
  }

  function componentJson(cmp) {
    const { stats, id, ...rest } = cmp;
    return JSON.stringify({ $schema: 'mochi-component/v1', ...rest }, null, 2);
  }

  // ——— React / Vue: a ready component with the picked element's own styles (scoped to .mochi-pick) ———
  const tagOf = cmp => (cmp.name === 'button' ? 'button' : cmp.name === 'link' ? 'a' : 'div');
  const attrsOf = tag => (tag === 'a' ? ' href="#"' : tag === 'button' ? ' type="button"' : '');
  const safeText = cmp => String(cmp.label || cmp.name || 'Component').replace(/[<>{}]/g, '').slice(0, 120);
  /** A valid PascalCase component name from the picked element (e.g. button → Button). */
  function pascalName(cmp) {
    const pascal = String(cmp.name || 'component').replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    return /^[A-Za-z]/.test(pascal) ? pascal : `Mochi${pascal || 'Component'}`;
  }
  /** Just the .mochi-pick rules (and any @keyframes) of the picked element. */
  function pickRules(cmp) {
    return (cmp.css || '').split('\n\n').filter(b => b.startsWith('.mochi-pick') || b.startsWith('@keyframes')).join('\n\n');
  }

  function componentReact(cmp) {
    const name = pascalName(cmp), tag = tagOf(cmp), rules = pickRules(cmp).replace(/`/g, '\\`');
    return [
      `// ${name} — recreated by Mochi from ${cmp.host} (${date(cmp)}).`,
      '// Styles are scoped to the .mochi-pick class; pass children to change the text.',
      `export default function ${name}({ children = ${JSON.stringify(safeText(cmp))} }) {`,
      '  return (',
      '    <>',
      `      <style>{\`\n${rules}\n      \`}</style>`,
      `      <${tag} className="mochi-pick"${attrsOf(tag)}>{children}</${tag}>`,
      '    </>',
      '  );',
      '}',
    ].join('\n');
  }

  function componentVue(cmp) {
    const name = pascalName(cmp), tag = tagOf(cmp);
    return [
      `<!-- ${name} — recreated by Mochi from ${cmp.host} (${date(cmp)}). Styles scoped to this component. -->`,
      '<template>',
      `  <${tag} class="mochi-pick"${attrsOf(tag)}><slot>${safeText(cmp).replace(/</g, '&lt;')}</slot></${tag}>`,
      '</template>',
      '',
      '<style scoped>',
      pickRules(cmp),
      '</style>',
    ].join('\n');
  }

  Mochi.componentExporters = { style: componentStyleCss, html: componentHtml, tailwind: componentTailwind, react: componentReact, vue: componentVue, prompt: componentPrompt, json: componentJson, look: componentLook };
  Mochi.COMPONENT_FORMATS = [
    { id: 'style', label: 'CSS', file: 'component.css' },
    { id: 'html', label: 'HTML + CSS', file: 'component.html' },
    { id: 'tailwind', label: 'Tailwind', file: 'component.tailwind.html' },
    { id: 'react', label: 'React', file: 'Component.jsx' },
    { id: 'vue', label: 'Vue', file: 'Component.vue' },
    { id: 'prompt', label: 'AI prompt', file: 'component-prompt.txt' },
    { id: 'json', label: 'JSON', file: 'component.json' },
  ];
  /** The AI prompt for any pocket entry: a page scan or a picked component. */
  Mochi.promptFor = entry => (entry.kind === 'component' ? componentPrompt(entry) : prompt(entry));

  Mochi.exporters = { tokens, prompt, designMd, css, tailwind, json, describe };
  Mochi.EXPORT_FORMATS = [
    { id: 'prompt', label: 'AI prompt', file: 'mochi-prompt.txt' },
    { id: 'designMd', label: 'DESIGN.md', file: 'DESIGN.md' },
    { id: 'css', label: 'CSS', file: 'tokens.css' },
    { id: 'tailwind', label: 'Tailwind', file: 'tailwind.config.js' },
    { id: 'json', label: 'JSON', file: 'tokens.json' },
  ];
})();
