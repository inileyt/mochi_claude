/*
 * Mochi — Deep Scan output: spec.json (the data) and SPEC.md (the same, readable
 * by people and AI agents): page outline → each region in order with its exact
 * layout, sizes and responsive rules → components with every state → what
 * clicking does → motion → scroll timeline → responsive → media → what's
 * approximate or missing. Schema: docs/rebuild-spec.schema.md.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const D = Mochi.deepScan;
  const css = (styles, indent = '  ') => Object.entries(styles || {}).map(([k, v]) => `${indent}${k}: ${v};`).join('\n');
  const list = (items, f) => (items || []).map(f).filter(Boolean).join('\n');
  const ms = n => (n || n === 0 ? `${n}ms` : '');
  const tr = t => `${t.property} ${ms(t.duration)} ${t.easing}${t.delay ? ` ${ms(t.delay)} delay` : ''}`;

  function layoutLine(l, geo) {
    const bits = [];
    if (l?.grid) bits.push(`CSS grid, ${l.grid.columns} column${l.grid.columns > 1 ? 's' : ''}: \`grid-template-columns: ${l.grid.template}\` (${l.grid.px.join(' / ')} px)${l.grid.areas ? `, areas ${l.grid.areas}` : ''}`);
    else if (l?.flex) bits.push(`flex ${l.flex.direction}${l.flex.wrap !== 'nowrap' ? ` ${l.flex.wrap}` : ''}, justify ${l.flex.justify}, align ${l.flex.align}`);
    else bits.push(`display ${l?.display || 'block'}`);
    if (l?.gap) bits.push(`gap ${l.gap}`);
    if (l?.scrollSnap) bits.push(`scroll-snap ${l.scrollSnap}`);
    if (l?.scrollsX) bits.push('scrolls horizontally');
    return bits.join('; ');
  }

  function regionMd(r, spec) {
    const g = r.geometry || {};
    const out = [`### ${r.order}. ${r.name}${r.type && r.type !== r.name ? ` — ${r.type}` : ''}`, ''];
    out.push(`- Element: \`${r.selector}\`${r.layoutSelector ? ` (layout on \`${r.layoutSelector}\`)` : ''}`);
    out.push(`- Size at ${spec.source.viewport?.width || ''}px: ${g.w}×${g.h}px (${g.wOfViewport}, ${g.hOfViewport}); padding ${g.padding}; margin ${g.margin}${g.border ? `; border ${g.border}` : ''}${g.radius ? `; radius ${g.radius}` : ''}`);
    if (r.position) out.push(`- Position: ${r.position.position}${['top', 'right', 'bottom', 'left'].filter(k => r.position[k]).map(k => ` ${k} ${r.position[k]}`).join('')}${r.position.zIndex !== undefined ? `, z-index ${r.position.zIndex}` : ''}`);
    if (r.container) out.push(`- Content column: max-width ${r.container.maxWidth}, centred, padding ${r.container.padding}`);
    out.push(`- Layout: ${layoutLine(r.layout, r.layoutGeometry)}`);
    if (r.children?.length) out.push(`- Inside, in order: ${r.children.map(c => `${c.role} ${c.w}×${c.h}`).join(' · ')}`);
    if (r.components?.length) out.push(`- Repeated: ${r.components.map(c => `${c.name} ×${c.count}${c.layout ? ` (${c.layout})` : ''}`).join(', ')}`);
    // Only what's new at each width (a column change at 1024 isn't repeated at 768 and 390).
    let prev = [];
    const resp = (spec.responsive?.widths || []).map(w => { const c = w.changes.filter(x => x.target === r.name && !prev.includes(x.text)); prev = w.changes.filter(x => x.target === r.name).map(x => x.text); return { w: w.width, c }; }).filter(x => x.c.length);
    if (resp.length) out.push(`- Responsive: ${resp.map(x => `≤${x.w}px: ${x.c.map(c => c.text.replace(`${r.name}: `, '')).join(', ')}`).join('; ')}`);
    if (r.content?.length) {
      out.push('- Text (placeholders keep length, lines and style):');
      for (const b of r.content.slice(0, 16)) out.push(`  - ${b.role}: ${b.text ? `“${b.text}”` : `“${b.placeholder}”`} — ${b.chars} chars, ${b.lines} line${b.lines > 1 ? 's' : ''}, ${b.style}, ${b.color}${b.align && !['start', 'left'].includes(b.align) ? `, ${b.align}` : ''}${b.transform ? `, ${b.transform}` : ''}`);
      if (r.content.length > 16) out.push(`  - … ${r.content.length - 16} more text blocks (see spec.json)`);
    }
    if (r.screenshot) out.push(`- Screenshot: \`${r.screenshot}\``);
    return out.join('\n');
  }

  function componentMd(c, spec) {
    const st = (spec.states?.interactive || []).find(s => s.component === c.id);
    const out = [`### ${c.name || c.type}${c.variant ? ` — ${c.variant}` : ''}${c.size?.name ? ` (${c.size.name})` : ''} ×${c.count}`, '', `\`${c.selector}\` — ${c.size.w}×${c.size.h}px${c.text ? `, label ${c.text}` : ''}`, '', '```css', `${c.selector} {`, css(c.styles), '}'];
    if (st) {
      for (const [state, v] of Object.entries(st.states)) {
        const decl = Object.entries(v.changes).map(([k, x]) => `  ${k}: ${x.to}; /* was ${x.from} */`).join('\n');
        out.push(`${c.selector}:${state} {`, decl);
        for (const ch of v.children || []) out.push(`  /* inside: ${ch.selector} → ${Object.entries(ch.changes).map(([k, x]) => `${k}: ${x.to}`).join('; ')} */`);
        out.push('}');
      }
    }
    out.push('```');
    if (Object.keys(c.tokens || {}).length) out.push(`Tokens: ${Object.entries(c.tokens).map(([k, v]) => `${k} → ${v}`).join(', ')}`);
    if (st?.transitions?.length) out.push(`Transitions: ${st.transitions.map(tr).join(', ')}`);
    if (c.icon) out.push(`Icon: ${c.icon.size}, ${c.icon.style}, ${c.icon.color}, ${c.icon.placement} — ${c.icon.placeholder}`);
    if (st?.shots) out.push(`Screenshots: \`${st.shots.default}\`, \`${st.shots.hover}\``);
    return out.join('\n');
  }

  function specMd(scan) {
    const s = scan.spec;
    const own = s.source.ownSite;
    const t = s.tokens || {};
    const out = [];
    out.push(`# Rebuild spec${own ? ` — ${scan.title}` : ''}`, '');
    out.push(`Scanned ${s.source.scannedAt?.slice(0, 10)} at a ${s.source.viewport?.width}×${s.source.viewport?.height} window by Mochi Deep Scan (spec version ${s.version}). ${own ? 'Original text and images are kept (the owner\'s own site).' : 'Logos, brand names, pictures and copy are **placeholders of the same size and shape** — do not reproduce the original branding.'}`, '');
    out.push('## Page outline', '', s.structure?.outline || '(no structure)', '');
    if (s.geometry?.contentColumn) { const c = s.geometry.contentColumn; out.push(`Main content column: max-width ${c.maxWidth}, centred, side padding ${c.sidePadding} (content ${c.contentWidth}px wide at ${c.at}px).`, ''); }
    if (s.responsive?.breakpoints) out.push(`Breakpoints: ${s.responsive.breakpoints.map(b => `${b.kind}-width ${b.px}px`).join(', ') || 'none found'}.`, '');

    out.push('## Design tokens', '', 'Full set: `tokens.css` and `tailwind.config.js`.', '');
    if (t.colors) out.push(`- Colours by role: ${t.colors.roles.map(c => `${c.role} ${c.hex}`).join(', ')}`);
    if (t.customProperties && Object.keys(t.customProperties).length) out.push(`- The site's own CSS variables: ${Object.entries(t.customProperties).slice(0, 24).map(([k, v]) => `\`${k}: ${v}\``).join(', ')}`);
    if (t.typography) {
      out.push(`- Fonts: ${t.typography.families.map(f => `${f.family} (${f.usedFor.join(', ')}; free alternative: ${f.freeAlternative})`).join('; ')}`);
      if (t.typography.fontFaces.length) out.push(`- @font-face: ${t.typography.fontFaces.map(f => `${f.family} ${f.weight} ${f.style} — ${f.sources.map(x => `${x.kind === 'local' ? 'local' : x.format || 'file'} ${x.name}`).join(', ')}`).join('; ')}`);
      out.push(`- ${t.typography.licenceNote}`);
      out.push(`- Type scale: ${t.typography.scale.map(x => `${x.name} ${x.size}/${x.lineHeight} ${x.weight}${x.letterSpacing ? ` ${x.letterSpacing}` : ''} ${x.family}`).join(' · ')}`);
    }
    if (t.spacing) out.push(`- Spacing: base ${t.spacing.base || '?'}px; scale ${t.spacing.scale.join(', ')}`);
    if (t.radius?.length) out.push(`- Radius: ${t.radius.map(r => `${r.value} (×${r.count})`).join(', ')}`);
    if (t.shadows?.length) out.push(`- Shadows: ${t.shadows.map(x => `\`${x.value}\``).join(', ')}`);
    if (t.gradients?.length) out.push(`- Gradients: ${t.gradients.map(x => `\`${x.value}\``).join(', ')}`);
    if (t.backdropFilters?.length) out.push(`- Backdrop filters: ${t.backdropFilters.map(x => `\`${x.value}\``).join(', ')}`);
    out.push('');

    const regions = s.structure?.regions || [];
    out.push('## Regions, top to bottom', '');
    for (const r of regions.filter(x => !['overlay', 'floating'].includes(x.kind))) out.push(regionMd(r, s), '');
    const extra = regions.filter(x => ['overlay', 'floating'].includes(x.kind));
    if (extra.length) {
      out.push('## Overlays and floating elements', '');
      for (const r of extra) out.push(regionMd(r, s), '');
    }

    if (s.components?.length) {
      out.push('## Components and their states', '', 'Styles are only what differs from the browser defaults. States were forced with DevTools and read after the transition ended.', '');
      for (const c of s.components) out.push(componentMd(c, s), '');
    }

    const clicks = s.states?.clicks || [];
    if (clicks.length) {
      out.push('## What clicking does (safe controls only)', '');
      for (const c of clicks) {
        if (c.error) continue;
        const opens = (c.opens || []).map(o => `${o.selector} appears ${o.where} (${o.position}, ${o.size.w}×${o.size.h})${o.animation?.length ? `, animates in with ${o.animation.map(a => `${a.name} ${ms(a.duration)} ${a.easing || ''}`.trim()).join(' + ')}` : ''}${o.backdrop ? `, backdrop ${o.backdrop}` : ''}`).join('; ');
        out.push(`- **${c.kind}** \`${c.trigger}\`${c.width ? ` at ${c.width}px` : ''}: ${c.effect || opens || 'no visible change'}.${c.closes?.length ? ` Closes with: ${c.closes.join(', ')}.` : ''}${c.shot ? ` Screenshot \`${c.shot}\`.` : ''}`);
      }
      out.push('', `Page states: ${(s.states.pageStates || []).map(p => p.name).join(' · ')}`, '');
    }

    const m = s.motion || {};
    if (m.animations?.length || m.js?.length || m.transitions?.length) {
      out.push('## Motion', '');
      for (const a of m.animations || []) out.push(`- \`${a.name}\` on \`${a.target}\`${a.count > 1 ? ` (×${a.count})` : ''}: ${ms(a.duration)} ${a.easing}${a.delay ? `, delay ${ms(a.delay)}` : ''}${a.iterations === 'infinite' ? ', infinite' : ''}${a.direction && a.direction !== 'normal' ? `, ${a.direction}` : ''}${a.stagger ? `, stagger ${a.stagger}ms` : ''} — ${a.trigger}${a.css ? `\n  \`\`\`css\n  ${a.css}\n  \`\`\`` : ''}`);
      for (const j of m.js || []) out.push(`- JS motion on \`${j.target}\`: ${j.description} (approximate)`);
      if (m.transitions?.length) out.push(`- Transitions: ${m.transitions.map(x => `\`${x.target}\` ${x.transitions.map(tr).join(', ')}`).join('; ')}`);
      if (m.libraries?.length) out.push(`- Built with (suggestion for the rebuild): ${m.libraries.join(', ')}`);
      if (m.reducedMotion) out.push(`- Reduced motion: ${m.reducedMotion.note}${m.reducedMotion.rules?.length ? ` Rules: ${m.reducedMotion.rules.map(r => `\`${r.selector} { ${r.sets} }\``).join(' ')}` : ''}`);
      out.push('');
    }

    if (s.scroll?.timeline?.length) out.push('## Scroll timeline', '', ...s.scroll.timeline.map(l => `- ${l}`), '');

    if (s.responsive?.widths?.length) {
      out.push('## Responsive behaviour', '', s.responsive.note || '', '');
      let before = [];
      for (const w of s.responsive.widths) {
        const fresh = w.changes.filter(c => !before.includes(c.text));
        before = w.changes.map(c => c.text);
        out.push(`- **${w.width}px** (page ${w.pageHeight}px tall): ${w.width === s.responsive.widths[0].width ? 'the reference layout' : fresh.length ? `${fresh.map(c => c.text).join('; ')}` : 'same as the previous width'} — \`screenshots/full-${w.width}.png\``);
      }
      out.push('');
    }

    if (s.media) {
      out.push('## Pictures and media (placeholders)', '');
      for (const i of s.media.images.slice(0, 30)) out.push(`- ${i.role} \`${i.selector}\`: ${i.placeholder}${i.overlay ? `, ${i.overlay.kind} overlay ${i.overlay.value}` : ''}`);
      for (const v of s.media.videos) out.push(`- video \`${v.selector}\` ${v.w}×${v.h}${v.background ? ' (background: autoplay, muted, loop)' : ''}`);
      out.push('');
    }
    if (s.approximations?.length) out.push('## Approximate — rebuild these by hand', '', ...s.approximations.map(a => `- **${a.what}** (\`${a.where}\`): ${a.note}`), '');
    out.push('## Not captured', '', ...(s.limits || []).map(l => `- ${l}`), '');
    if (s.notes?.length) out.push('## Notes', '', ...s.notes.map(n => `- ${n}`), '');
    return out.join('\n').replace(/\n{3,}/g, '\n\n');
  }

  D.writers.push(scan => [
    { name: 'spec.json', data: JSON.stringify({ $schema: 'https://github.com/inileyt/mochi_claude/blob/main/docs/rebuild-spec.schema.md', ...scan.spec }, null, 2) },
    { name: 'SPEC.md', data: specMd(scan) },
  ]);
  Mochi.deepSpecMd = { specMd };
})();
