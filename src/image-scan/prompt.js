/*
 * Mochi — Image Scan: AI image prompts that recreate the look of the scanned image,
 * built from everything the scan found (the description when there is one, the palette,
 * the text and its font style, the aspect ratio, light/dark, warm/cool).
 *
 *   Mochi.imagePrompt.build(result) → {
 *     aspect: { w, h, label, orientation },
 *     universal,            a natural-language paragraph (any tool)
 *     midjourney,           with --ar, --style/--stylize and --no
 *     sd: { prompt, negative, size },   Stable Diffusion / SDXL tags + negative prompt
 *     dalle,                DALL·E / GPT-image / Imagen: plain sentences
 *     alt,                  short alt text for the web
 *   }
 *   Mochi.imagePrompt.question(result, lang) → the "Ask Claude" question
 * Prompts are in English (image models follow English best).
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  const RATIOS = [[1, 1], [4, 5], [5, 4], [3, 4], [4, 3], [2, 3], [3, 2], [9, 16], [16, 9], [21, 9], [9, 21], [1, 2], [2, 1], [3, 1], [1, 3]];
  function aspect(w, h) {
    if (!w || !h) return { w: 1, h: 1, label: '1:1', orientation: 'square' };
    const r = w / h;
    let best = RATIOS[0], err = Infinity;
    for (const q of RATIOS) { const e = Math.abs(Math.log(r / (q[0] / q[1]))); if (e < err) { err = e; best = q; } }
    let [a, b] = best;
    if (err > 0.035) {
      // Not a common ratio: the closest small fraction.
      let bestF = [1, 1], bestE = Infinity;
      for (let d = 1; d <= 32; d++) { const n = Math.max(1, Math.round(r * d)); const e = Math.abs(Math.log(r / (n / d))); if (e < bestE - 1e-9) { bestE = e; bestF = [n, d]; } if (e < 0.01) break; }
      [a, b] = bestF;
    }
    return { w: a, h: b, label: `${a}:${b}`, orientation: a === b ? 'square' : a > b ? 'landscape' : 'portrait' };
  }

  /** SDXL likes ~1 megapixel in multiples of 64. */
  function sdSize({ w, h }) {
    const r = w / h;
    const W = Math.round(Math.sqrt(1048576 * r) / 64) * 64, H = Math.round(Math.sqrt(1048576 / r) / 64) * 64;
    return `${W}×${H}`;
  }

  const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const list = xs => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
  const quote = s => `“${String(s).replace(/[“”"]/g, '\'')}”`;

  /** What the scan knows, in words. */
  function facts(r) {
    const d = r.description || null;
    const pal = r.palette || {};
    const colors = (pal.colors || []).slice(0, 6);
    const o = pal.overall || {};
    const text = r.ocr?.found ? r.ocr.text.replace(/\s*\n\s*/g, ' / ').trim().slice(0, 140) : '';
    const font = r.fonts?.[0] || null;
    const size = r.source?.full || r.source?.css || { w: r.width, h: r.height };
    const flat = colors.length && colors.length <= 5 && colors.filter(c => c.exact).length >= Math.min(3, colors.length);
    const styleGuess = pal.gradient ? 'smooth gradient artwork' : flat ? (text ? 'flat graphic design' : 'flat vector illustration') : 'photographic image';
    return {
      d, colors, o, text, font, pal,
      ar: aspect(size.w, size.h),
      // Without the on-device description, the subject is unknown: the page's alt text if it has one.
      subject: d?.subject || r.source?.alt || '',
      style: d?.style || styleGuess,
      fontWords: font ? fontWords(font) : '',
    };
  }

  function fontWords(f) {
    const parts = [f.weight?.label && f.weight.label !== 'regular' ? f.weight.label : '', f.width && f.width !== 'normal' ? f.width : '', f.case === 'all caps' ? 'all-caps' : '', f.category === 'display' ? 'display sans-serif' : f.category === 'script' ? 'script' : f.category].filter(Boolean);
    const like = f.matches?.[0]?.family ? `, similar to ${f.matches[0].family}` : '';
    const spacing = f.letterSpacing?.label === 'wide' ? ', with wide letter spacing' : f.letterSpacing?.label === 'tight' ? ', tightly spaced' : '';
    return `${parts.join(' ')} type${like}${spacing}`;
  }

  const paletteWords = colors => colors.map(c => `${c.name} (${c.hex})`).join(', ');

  function universal(F) {
    const { d, o, colors, text, font, pal, ar } = F;
    const s = [];
    const lead = F.subject ? `${cap(F.style)} of ${F.subject}` : text ? `${cap(F.style)} built around a headline` : cap(F.style);
    s.push(`${lead}${d?.objects?.length ? `, with ${list(d.objects.slice(0, 6))}` : ''}${d?.setting ? `, set in ${d.setting}` : ''}.`);
    const comp = [d?.composition && `Composition: ${d.composition}`, d?.camera && `camera: ${d.camera}`].filter(Boolean);
    if (comp.length) s.push(`${comp.join('; ')}.`);
    const mood = [d?.lighting && `Lighting: ${d.lighting}`, d?.mood && `mood: ${d.mood}`].filter(Boolean);
    if (mood.length) s.push(`${mood.join('; ')}.`);
    if (colors.length) s.push(`Color palette: ${paletteWords(colors)}${o.tone ? ` — ${o.tone} overall, ${o.temperature === 'neutral' ? 'neutral' : `${o.temperature}`} tones, ${o.saturation} saturation` : ''}${pal.gradient ? `, with a gradient ${pal.gradient.direction} from ${pal.gradient.from} to ${pal.gradient.to}` : ''}.`);
    if (text) s.push(`Render the text ${quote(text)}${font ? ` in ${F.fontWords}, colored ${font.color?.name} (${font.color?.hex})` : ''}, spelled exactly.`);
    s.push(`Aspect ratio ${ar.label} (${ar.orientation}).`);
    return s.join(' ');
  }

  function midjourney(F) {
    const { d, colors, text, ar, o } = F;
    const parts = [F.subject, ...(d?.objects || []).slice(0, 5), d?.setting, F.style, d?.lighting, d?.mood && `${d.mood} mood`, d?.composition, d?.camera].filter(Boolean);
    if (colors.length) parts.push(`color palette ${colors.map(c => `${c.name} ${c.hex}`).join(', ')}`);
    if (o.tone) parts.push(`${o.tone}, ${o.temperature === 'neutral' ? 'neutral' : o.temperature} tones`);
    if (text) parts.push(`the text ${quote(text)} in ${F.fontWords.replace(/, similar to .*$/, '')}`);
    const photo = /photo/i.test(F.style);
    const flat = /flat|vector|graphic|illustration|pixel/i.test(F.style);
    const no = ['watermark', 'signature', 'blurry', ...(text ? [] : ['text', 'letters'])];
    return `${parts.join(', ')} --ar ${ar.label}${photo ? ' --style raw' : ''} --stylize ${flat ? 50 : photo ? 100 : 250} --no ${no.join(', ')}`;
  }

  function sd(F) {
    const { d, colors, text, o, ar } = F;
    const tags = [F.subject, ...(d?.objects || []).slice(0, 6), d?.setting, F.style, d?.lighting, d?.mood, d?.composition, d?.camera].filter(Boolean);
    for (const c of colors.slice(0, 5)) tags.push(`${c.name} (${c.hex})`);
    if (o.tone) tags.push(`${o.tone} palette`, `${o.temperature === 'neutral' ? 'neutral' : o.temperature} colors`, `${o.saturation} saturation`);
    if (text) tags.push(`text "${text.replace(/"/g, '\'')}"`, F.fontWords.replace(/, similar to .*$/, '').replace(/ type$/, ' typography'));
    tags.push(/photo/i.test(F.style) ? 'sharp focus, high detail' : 'clean shapes, high detail');
    const negative = ['blurry', 'low quality', 'jpeg artifacts', 'watermark', 'signature', 'deformed', ...(text ? ['misspelled text', 'garbled letters'] : ['text', 'letters', 'logo']), ...(/photo/i.test(F.style) ? ['cartoon', 'illustration'] : ['photo noise'])];
    return { prompt: tags.join(', '), negative: negative.join(', '), size: `${sdSize(ar)} (${ar.label})` };
  }

  function dalle(F) {
    const { d, colors, text, font, o, ar } = F;
    const s = [`Create a ${F.style}${F.subject ? ` of ${F.subject}` : ''}${d?.setting ? ` in ${d.setting}` : ''}.`];
    if (d?.objects?.length) s.push(`Include ${list(d.objects.slice(0, 6))}.`);
    if (d?.composition || d?.camera) s.push(`Frame it ${[d.composition, d.camera && `from a ${d.camera.replace(/^an? /i, '')} point of view`].filter(Boolean).join(', ')}.`);
    if (d?.lighting || d?.mood) s.push(`The lighting is ${d.lighting || 'natural'} and the mood is ${d.mood || 'calm'}.`);
    if (colors.length) s.push(`Use this color palette: ${paletteWords(colors)}${o.tone ? `; keep it ${o.tone} and ${o.temperature === 'neutral' ? 'neutral' : o.temperature}` : ''}.`);
    if (text) s.push(`Write the text ${quote(text)} exactly as given, in ${F.fontWords}${font?.color ? `, in ${font.color.name} (${font.color.hex})` : ''}.`);
    else s.push('Do not add any text.');
    s.push(`Make it ${ar.orientation} with an aspect ratio of ${ar.label}.`);
    return s.join(' ');
  }

  function alt(F, r) {
    if (F.d?.caption) return F.d.caption.slice(0, 160);
    if (r.source?.alt) return r.source.alt.slice(0, 160);
    const colorPart = F.colors.slice(0, 2).map(c => c.name).join(' and ');
    if (F.text) return `${cap(F.style)} with the text ${quote(F.text.slice(0, 80))}${colorPart ? ` in ${colorPart}` : ''}.`.slice(0, 160);
    return `${cap(F.style)}${colorPart ? ` in ${colorPart}` : ''}.`;
  }

  function build(r) {
    const F = facts(r);
    return { aspect: F.ar, universal: universal(F), midjourney: midjourney(F), sd: sd(F), dalle: dalle(F), alt: alt(F, r) };
  }

  const LANGS = { de: 'German', es: 'Spanish', fr: 'French', hy: 'Armenian', it: 'Italian', ja: 'Japanese', pt: 'Portuguese', ru: 'Russian', uk: 'Ukrainian', zh: 'Chinese' };
  /** The question for Claude (option B): a detailed description + prompts in the same format as Mochi's. */
  function question(r, lang = 'en') {
    const F = facts(r);
    const known = [
      F.colors.length ? `- Palette: ${paletteWords(F.colors)}` : null,
      F.text ? `- Text in the image: ${quote(F.text)}${F.font ? ` (${F.fontWords})` : ''}` : '- No text was found in the image.',
      `- Aspect ratio: ${F.ar.label} (${F.ar.orientation})`,
    ].filter(Boolean);
    return [
      'I pasted an image. Please:',
      '1. Describe it in detail: subject, objects, setting, style/medium (photo, 3D render, flat illustration, pixel art, watercolor…), composition, camera angle, lighting, mood and colors.',
      '2. Write an image-generation prompt that recreates its look, in four versions:',
      '   - Universal: one natural-language paragraph (subject, setting, style/medium, composition, camera, lighting, mood, the color palette with names and hex codes, any text to render in quotes with its font style, the aspect ratio).',
      `   - Midjourney: comma-separated, ending with --ar ${F.ar.label}, a --style/--stylize hint and --no for unwanted things.`,
      '   - Stable Diffusion / SDXL: comma-separated tags, plus a negative prompt.',
      '   - DALL·E / GPT-image / Imagen: plain descriptive sentences.',
      '3. A short alt text (one sentence) for the web.',
      '',
      'What I already measured offline:',
      ...known,
      ...(LANGS[lang] ? ['', `Please answer in ${LANGS[lang]} (keep the prompts themselves in English).`] : []),
    ].join('\n');
  }

  Mochi.imagePrompt = { build, question, aspect, sdSize, fontWords };
  if (typeof module !== 'undefined') module.exports = Mochi.imagePrompt;
})();
