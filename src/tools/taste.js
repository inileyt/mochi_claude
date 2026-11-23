/*
 * Mochi — your design taste. From what you already do with Mochi (UI scans, picked elements,
 * image scans, picked colors, fonts you pin in the inspector, Live Edits you keep), Mochi keeps
 * small notes in this browser ("taste events": colors, fonts, vibe, corners, spacing) and turns
 * them into your taste: favorite colors, fonts, vibes and shapes, as a brief for Claude.
 *
 *   T.profile(events, now) → { colors, fonts, vibes, tone, saturation, radius, spacing, sources, total, since }
 *   T.brief(profile) → Markdown ("My design taste")
 * The panel (Menu → Mochi → My design taste) is in this file too; the events are collected by the
 * core (src/tools/tools.js) into taste.events (≤ 300). Settings: collect on/off, forget everything.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const C = Mochi.imageColor || (typeof require === 'function' ? require('../image-scan/colors.js') : null);
  const HALF_LIFE = 30 * 24 * 3600 * 1000; // a month-old note counts half
  const ROLE = { accent: 1.3, dominant: 1.2, primary: 1.2, background: 0.7, text: 0.6, secondary: 0.9, '': 1 };

  function profile(events, now = Date.now()) {
    const ev = (events || []).filter(e => e && typeof e === 'object');
    const w = e => 0.5 ** (Math.max(0, now - (e.at || now)) / HALF_LIFE);
    // Colors: similar ones merge (ΔE 2000 < 10), weighted by recency and role.
    const groups = [];
    for (const e of ev) {
      for (const c of e.colors || []) {
        const rgb = C.fromHex(c.hex || c);
        if (!rgb) continue;
        const lab = C.rgbToLab(rgb);
        const weight = w(e) * (ROLE[c.role || ''] ?? 1);
        const g = groups.find(x => C.deltaE(x.lab, lab) < 10);
        if (g) { g.weight += weight; g.count++; if (weight > g.top) { g.top = weight; g.rgb = rgb; g.lab = lab; } }
        else groups.push({ rgb, lab, weight, top: weight, count: 1 });
      }
    }
    groups.sort((a, b) => b.weight - a.weight);
    const total = groups.reduce((t, g) => t + g.weight, 0) || 1;
    const colors = groups.slice(0, 8).map(g => ({ hex: C.hex(g.rgb), name: C.name(g.rgb), share: Math.round((g.weight / total) * 100), count: g.count }));
    // Fonts, vibes: counted with the same weights.
    const tally = (pick, norm = s => s) => {
      const m = new Map();
      for (const e of ev) for (const x of pick(e) || []) { const k = norm(String(x).trim()); if (k && !/^(system-ui|sans-serif|serif|monospace|-apple-system|blinkmacsystemfont|ui-sans-serif)$/i.test(k)) m.set(k, (m.get(k) || 0) + w(e)); }
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, score]) => ({ name, score: Math.round(score * 10) / 10 }));
    };
    const fonts = tally(e => e.fonts, s => s.replace(/^["']|["']$/g, '')).slice(0, 6);
    const vibes = tally(e => e.vibe, s => s.toLowerCase()).slice(0, 6);
    // Light or dark, how colorful: from the merged colors.
    let L = 0, ch = 0;
    for (const g of groups.slice(0, 12)) { const [l, c] = C.lch(g.lab); L += l * g.weight; ch += c * g.weight; }
    const sum = groups.slice(0, 12).reduce((t, g) => t + g.weight, 0) || 1;
    const themes = ev.map(e => e.theme).filter(Boolean);
    const dark = themes.filter(t => t === 'dark').length, light = themes.filter(t => t === 'light').length;
    const median = xs => { const v = xs.filter(x => Number.isFinite(x)).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
    const sources = {};
    for (const e of ev) sources[e.kind] = (sources[e.kind] || 0) + 1;
    return {
      colors, fonts, vibes,
      tone: dark > light * 1.5 ? 'dark' : light > dark * 1.5 ? 'light' : themes.length ? 'mixed' : (L / sum >= 55 ? 'light' : 'dark'),
      saturation: !groups.length ? null : ch / sum < 15 ? 'muted' : ch / sum < 40 ? 'balanced' : 'vivid',
      radius: median(ev.map(e => e.radius)), spacing: median(ev.map(e => e.spacing)),
      sources, total: ev.length, since: ev.length ? Math.min(...ev.map(e => e.at || now)) : null,
    };
  }

  function brief(p, { title = 'My design taste' } = {}) {
    const lines = [`# ${title}`, '', `What I tend to like, gathered from ${p.total} things I looked at and kept with Mochi.`, ''];
    if (p.colors.length) lines.push('## Colors', ...p.colors.map(c => `- ${c.name} \`${c.hex}\` (${c.share}%)`), '');
    if (p.fonts.length) lines.push('## Typefaces', ...p.fonts.map(f => `- ${f.name}`), '');
    if (p.vibes.length) lines.push('## Vibe', `- ${p.vibes.map(v => v.name).join(', ')}`, '');
    const shape = [p.tone && `mostly ${p.tone} interfaces`, p.saturation && `${p.saturation} colors`, p.radius != null && `corners around ${p.radius}px`, p.spacing && `a ${p.spacing}px spacing grid`].filter(Boolean);
    if (shape.length) lines.push('## Shapes and feel', ...shape.map(s => `- ${s}`), '');
    lines.push('Please design in this direction unless I ask for something else.');
    return lines.join('\n');
  }

  // A painter's beret, worn while showing your taste.
  const BERET = { id: 'taste-beret', name: 'outfit.beret', author: 'Mochi', slot: 'head', hide: ['antenna'], at: [11, 8], pixels: ['.......OO.........', '....OOOBBOOOO.....', '..OOBBBBBBBBBOO...', '.OBBBBBBBBBBBBBO..', 'OBBBBBBBBBBBBBBBO.', '.OOOOOOOOOOOOOOO..'], palette: { O: '#2b1d3a', B: '#e63946' } };

  async function open(ctx) {
    const { h, copyText, downloadText } = Mochi.ui;
    const { panel, companion } = ctx;
    const t = (k, v) => Mochi.t(k, v);
    Mochi.menuInstance?.close();
    const events = (await Mochi.store.get('taste.events', [])) || [];
    const p = profile(events);
    Mochi.outfits.overrides.head = BERET;
    Mochi.outfits.apply(companion);
    const off = () => { if (Mochi.outfits.overrides.head === BERET) { delete Mochi.outfits.overrides.head; Mochi.outfits.apply(companion); } };
    const section = (title, ...kids) => h('section', { class: 'blk' }, h('h4', { text: title }), ...kids);
    const body = p.total ? h('div', { class: 'taste' },
      h('p', { class: 'note', text: t('taste.based', { n: p.total, scans: p.sources.scan || 0, images: p.sources.image || 0, colors: p.sources.color || 0 }) }),
      section(t('taste.colors'), h('div', { class: 'taste-strip' }, ...p.colors.map(c => h('button', { class: 'swatch', type: 'button', 'data-hex': c.hex, title: `${c.name} · ${c.share}%`, onclick: async () => { await copyText(c.hex, companion.shadow); ctx.actions.copied(c.hex); } }, h('i', { style: { background: c.hex } }), h('span', { class: 'sw-hex', text: c.hex }), h('span', { class: 'sw-role', text: c.name }))))),
      p.fonts.length ? section(t('taste.fonts'), h('ul', { class: 'taste-fonts' }, ...p.fonts.map(f => h('li', {}, h('span', { class: 'taste-aa', style: { 'font-family': `"${f.name}", system-ui` }, text: 'Aa' }), ` ${f.name}`)))) : null,
      p.vibes.length ? section(t('taste.vibe'), h('div', { class: 'vibes' }, ...p.vibes.map((v, i) => h('span', { class: `chip${i ? ' ghost' : ' main'}`, text: v.name })))) : null,
      section(t('taste.feel'), h('div', { class: 'vibes' }, ...[p.tone && t(`taste.tone.${p.tone}`), p.saturation && t(`taste.sat.${p.saturation}`), p.radius != null && t('taste.radius', { px: p.radius }), p.spacing && t('taste.spacing', { px: p.spacing })].filter(Boolean).map(x => h('span', { class: 'chip ghost', text: x })))),
    ) : h('div', { class: 'empty' }, h('p', { text: t('taste.empty') }));
    const md = brief(p);
    panel.open(t('taste.title'), p.total ? t('taste.sub', { n: p.total }) : '', body, h('div', { class: 'row' },
      p.total ? (ctx.isClaude
        ? h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'taste-paste', onclick: async () => { panel.close(); off(); ctx.engine.pasted(await Mochi.insertIntoComposer(md)); } }, `✎ ${t('panel.pasteToClaude')}`)
        : h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'taste-copy', onclick: async () => { await copyText(md, companion.shadow); ctx.actions.copied(t('taste.title')); } }, `⧉ ${t('taste.copy')}`)) : null,
      p.total ? h('button', { class: 'px-btn', type: 'button', 'data-act': 'taste-md', onclick: () => { downloadText('TASTE.md', md, companion.shadow); ctx.actions.downloaded('TASTE.md'); } }, '⤓ TASTE.md') : null,
      h('button', { class: 'px-btn danger', type: 'button', 'data-act': 'taste-forget', onclick: async ev => {
        const btn = ev.currentTarget;
        if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = `✕ ${t('notes.sure')}`; return; }
        await Mochi.store.set('taste.events', []);
        companion.say(t('taste.forgot'), 2000);
        open(ctx);
      } }, `✕ ${t('taste.forget')}`)));
    panel.view = 'taste';
    companion.play('hop');
    if (p.total) companion.say(p.vibes[0] ? t('taste.hello', { vibe: p.vibes[0].name }) : t('taste.helloPlain'), 2600);
    // The beret comes off when the panel closes.
    const watch = setInterval(() => { if (panel.view !== 'taste' || !panel.isOpen) { clearInterval(watch); off(); } }, 500);
    return true;
  }

  Mochi.taste = Object.assign(Mochi.taste || {}, { profile, brief });
  if (Mochi.toolImpl) Mochi.toolImpl.taste = { open, close: () => {}, get isOpen() { return false; } };
  if (typeof module !== 'undefined') module.exports = { profile, brief };
})();
