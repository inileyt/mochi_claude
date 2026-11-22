/*
 * Mochi — Deep Scan results panel: the page outline, a tokens preview, the
 * components, the states gallery (screenshots), the motion and scroll
 * timeline, and what's approximate. (Download / copy buttons: output.js.)
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const D = Mochi.deepScan;
  const urls = [];
  const imgUrl = data => { const u = URL.createObjectURL(new Blob([data], { type: 'image/png' })); urls.push(u); setTimeout(() => URL.revokeObjectURL(u), 10 * 60 * 1000); return u; };

  D.views.push((scan, h, t) => {
    const regions = (scan.spec.structure?.regions || []).filter(r => !['overlay', 'floating'].includes(r.kind));
    return h('section', { class: 'deep-sec', 'data-sec': 'outline' },
      h('h4', { text: t('deep.h.outline') }),
      h('ol', { class: 'deep-outline' }, ...regions.map(r => h('li', { text: `${r.name}${r.layout?.grid?.columns > 1 ? ` · ${r.layout.grid.template}` : ''}${r.components?.[0] ? ` · ${r.components[0].name} ×${r.components[0].count}` : ''}${r.position?.position === 'sticky' || r.position?.position === 'fixed' ? ` · ${r.position.position}` : ''}` }))));
  });

  D.views.push((scan, h, t) => {
    const tk = scan.spec.tokens;
    if (!tk) return null;
    const swatches = (tk.colors?.roles || []).map(c => h('i', { title: `${c.role} ${c.hex}`, style: { background: c.hex } }));
    const type = (tk.typography?.scale || []).slice(0, 4).map(s => h('li', { text: `${s.name} ${s.size}/${s.lineHeight} ${s.weight} · ${s.family}` }));
    return h('section', { class: 'deep-sec', 'data-sec': 'tokens' },
      h('h4', { text: t('deep.h.tokens') }),
      h('div', { class: 'deep-swatches' }, ...swatches),
      h('ul', { class: 'deep-outline' }, ...type,
        tk.spacing?.base ? h('li', { text: `spacing ${tk.spacing.base}px · radius ${(tk.radius || []).slice(0, 3).map(r => r.value).join(', ')}` }) : null));
  });

  D.views.push((scan, h, t) => {
    const comps = scan.spec.components || [];
    if (!comps.length) return null;
    return h('section', { class: 'deep-sec', 'data-sec': 'components' },
      h('h4', { text: `${t('deep.h.components')} (${comps.length})` }),
      h('ul', { class: 'deep-outline' }, ...comps.slice(0, 14).map(c => h('li', { text: `${c.name || c.type}${c.variant ? ` · ${c.variant}` : ''}${c.size?.name ? ` (${c.size.name})` : ''} ×${c.count}` }))));
  });

  D.views.push((scan, h, t) => {
    const shots = scan.shots.filter(s => s.name.startsWith('states/')).slice(0, 12);
    const states = scan.spec.states?.pageStates || [];
    if (!shots.length && !states.length) return null;
    return h('section', { class: 'deep-sec', 'data-sec': 'states' },
      h('h4', { text: t('deep.h.states') }),
      states.length ? h('p', { class: 'note', text: states.map(s => s.name).join(' · ') }) : null,
      h('div', { class: 'deep-shots' }, ...shots.map(s => h('figure', {}, h('img', { src: imgUrl(s.data), alt: '', loading: 'lazy' }), h('figcaption', { text: s.name.replace(/^states\/|\.png$/g, '') })))));
  });

  D.views.push((scan, h, t) => {
    const lines = [
      ...(scan.spec.motion?.animations || []).slice(0, 6).map(a => `${a.name} · ${a.duration}ms ${a.easing}${a.iterations === 'infinite' ? ' · ∞' : ''} · ${a.target}`),
      ...(scan.spec.motion?.js || []).slice(0, 3).map(j => `JS: ${j.target} ${j.description}`),
      ...(scan.spec.scroll?.timeline || []).slice(0, 8),
    ];
    if (!lines.length) return null;
    return h('section', { class: 'deep-sec', 'data-sec': 'motion' }, h('h4', { text: t('deep.h.motion') }), h('pre', { text: lines.join('\n') }));
  });

  D.views.push((scan, h, t) => {
    const a = scan.spec.approximations || [];
    const partial = scan.spec.source?.partial || [];
    if (!a.length && !partial.length) return null;
    return h('section', { class: 'deep-sec', 'data-sec': 'approx' }, h('h4', { text: t('deep.h.approx') }),
      ...a.slice(0, 6).map(x => h('p', { class: 'deep-warn', text: `${x.what} (${x.where}): ${x.note}` })),
      partial.length ? h('p', { class: 'deep-warn', text: `⏱ ${partial.join(', ')}` }) : null);
  });
})();
