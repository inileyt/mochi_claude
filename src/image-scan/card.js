/*
 * Mochi — Image Scan: the result card (in Mochi's panel, pixel style, light and dark).
 *   thumbnail (with the text areas outlined) · palette · text · font style · what it shows ·
 *   AI prompts (Universal / Midjourney / SD / DALL·E) + alt text · save to pocket · Ask Claude
 *
 *   Mochi.imageCard.show(result, ctx)      after a scan
 *   Mochi.imageCard.showEntry(entry, ctx)  a scan saved in the pocket
 * Everything is built with DOM APIs and textContent (never innerHTML with scanned data).
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const T = (k, v) => Mochi.t(k, v);
  const CASES = { 'all caps': 'allCaps', lowercase: 'lower', 'title case': 'title', mixed: 'mixed' };
  const TABS = [['universal', 'img.tab.universal'], ['midjourney', 'Midjourney'], ['sd', 'SD / SDXL'], ['dalle', 'DALL·E · GPT · Imagen']];

  // The pocket's "AI prompt" for an image scan is its universal prompt (or the Ask-Claude question).
  const prev = Mochi.promptFor;
  Mochi.promptFor = entry => (entry?.kind === 'image' ? entry.paste : prev(entry));

  /** The part of a result the pocket keeps (no big images; the thumbnail only). */
  function compact(r) {
    return {
      width: r.width, height: r.height, thumb: r.thumb,
      palette: r.palette, description: r.description || null,
      ocr: r.ocr ? { found: r.ocr.found, text: r.ocr.text, confidence: r.ocr.confidence, language: r.ocr.language } : null,
      fonts: r.fonts || [], source: r.source,
    };
  }
  function entryFor(r, { ask = false, paste } = {}) {
    const prompts = Mochi.imagePrompt.build(r);
    return {
      v: 1, id: `img_${Date.now().toString(36)}`, kind: 'image', ask,
      url: r.source?.url, host: r.source?.host || 'image', title: `${T('img.title')} · ${prompts.aspect.label}`,
      at: new Date().toISOString(), thumb: r.thumb,
      colors: (r.palette?.colors || []).map(c => ({ hex: c.hex, role: c.role })),
      vibe: [{ id: 'image', label: T(ask ? 'img.askChip' : 'img.pocketChip') }],
      paste: paste || prompts.universal,
      scan: compact(r),
    };
  }

  function show(result, ctx, { saved = false } = {}) {
    const { companion, panel, engine } = ctx;
    const { h, copyText } = Mochi.ui;
    const copy = async (text, label) => { await copyText(text, companion.shadow); engine.copied(label); };
    const section = (title, id, ...kids) => h('section', { class: 'blk img-sec', 'data-sec': id }, h('h4', { text: title }), ...kids);
    const r = result;
    const pal = r.palette || { colors: [] };
    let prompts = Mochi.imagePrompt.build(r);

    // ——— the thumbnail, with the text areas outlined ———
    const boxes = (r.ocr?.lines || []).map(l => h('i', { class: 'img-box', style: {
      left: `${(l.bbox.x0 / r.width) * 100}%`, top: `${(l.bbox.y0 / r.height) * 100}%`,
      width: `${((l.bbox.x1 - l.bbox.x0) / r.width) * 100}%`, height: `${((l.bbox.y1 - l.bbox.y0) / r.height) * 100}%`,
    } }));
    const thumb = h('figure', { class: 'img-thumb' }, h('div', { class: 'img-frame' }, h('img', { src: r.thumb, alt: prompts.alt }), ...boxes));
    const o = pal.overall || {};
    const chips = h('div', { class: 'vibes' },
      h('span', { class: 'chip main', text: prompts.aspect.label }),
      o.tone ? h('span', { class: 'chip ghost', text: T(`img.tone.${o.tone}`) }) : null,
      o.temperature ? h('span', { class: 'chip ghost', text: T(`img.temp.${o.temperature}`) }) : null,
      o.saturation ? h('span', { class: 'chip ghost', text: T(`img.sat.${o.saturation}`) }) : null,
      r.ocr?.found ? h('span', { class: 'chip ghost', text: T('img.hasText') }) : null);
    const top = h('div', { class: 'img-top' }, thumb, h('div', { class: 'img-meta' }, chips,
      h('p', { class: 'note', text: `${r.source?.css?.w || r.width}×${r.source?.css?.h || r.height} px · ${r.source?.host || ''}` }),
      r.source?.partial ? h('p', { class: 'deep-warn', text: T('img.partial') }) : null));

    // ——— palette ———
    const swatches = h('div', { class: 'swatches img-swatches' }, ...pal.colors.map(c => h('button', {
      class: 'swatch', type: 'button', title: `${c.name} · rgb(${c.rgb.join(', ')}) · hsl(${c.hsl[0]} ${c.hsl[1]}% ${c.hsl[2]}%) · ${T('panel.copyThis', { what: c.hex })}`,
      'aria-label': `${c.name}, ${c.hex}, ${c.share}%, ${c.role}`, 'data-hex': c.hex,
      onclick: () => copy(c.hex, c.hex),
    }, h('i', { style: { background: c.hex } }), h('span', { class: 'sw-role', text: `${c.role} · ${c.share}%` }), h('span', { class: 'sw-hex', text: c.hex }), h('span', { class: 'sw-name', text: c.name }))));
    const gradient = pal.gradient ? h('button', { class: 'kv img-grad', type: 'button', title: T('panel.copyThis', { what: 'CSS' }), onclick: () => copy(pal.gradient.css, T('img.gradient')) },
      h('i', { class: 'img-grad-bar', style: { background: pal.gradient.css } }), h('span', { class: 'k', text: T('img.gradient') }), h('span', { class: 'v', text: pal.gradient.direction })) : null;
    const colorActions = h('div', { class: 'row' },
      h('button', { class: 'px-btn', type: 'button', 'data-act': 'img-css', onclick: () => copy(Mochi.palette.asCss(pal.colors), T('img.cssVars')) }, `⧉ ${T('img.cssVars')}`),
      h('button', { class: 'px-btn', type: 'button', 'data-act': 'img-tailwind', onclick: () => copy(Mochi.palette.asTailwind(pal.colors), 'Tailwind') }, `⧉ ${T('img.tailwind')}`));

    // ——— text ———
    const textSec = r.ocr?.found
      ? [h('pre', { class: 'img-text', text: r.ocr.text }),
        h('p', { class: 'note', text: T('img.textMeta', { lang: r.ocr.language === 'ru' ? 'Русский' : r.ocr.language === 'en+ru' ? 'English + Русский' : 'English', conf: r.ocr.confidence }) }),
        h('div', { class: 'row' }, h('button', { class: 'px-btn', type: 'button', 'data-act': 'img-copy-text', onclick: () => copy(r.ocr.text, T('img.theText')) }, `⧉ ${T('img.copyText')}`))]
      : [h('p', { class: 'note', 'data-empty': 'text', text: T('img.noText') })];

    // ——— font style ———
    const fontSec = (r.fonts || []).length ? [
      ...r.fonts.map(f => h('div', { class: 'img-font' },
        h('p', { class: 'img-font-text', text: `“${f.text}”` }),
        h('div', { class: 'vibes' }, ...[T(`img.cat.${f.category}`), `${T(`img.w.${f.weight.label}`)} ${f.weight.value}`, T(`img.width.${f.width}`), T(`img.case.${CASES[f.case] || 'mixed'}`), T(`img.sp.${f.letterSpacing.label}`)].map(x => h('span', { class: 'chip ghost', text: x }))),
        h('p', { class: 'note' }, h('i', { class: 'dot', style: { background: f.color.hex } }), ` ${f.color.name} ${f.color.hex} · ${T('img.size', { pct: f.size.capPct, px: f.size.px })}`),
        h('p', { class: 'img-like' }, `${T('img.looksLike')} `, ...f.matches.flatMap((m, i) => [i ? ' · ' : '', h('b', { text: m.family }), ` ${m.score}%`])))),
      h('p', { class: 'deep-warn', text: T('img.fontApprox') }),
    ] : [h('p', { class: 'note', text: r.ocr?.found ? T('img.fontNone') : T('img.noText') })];

    // ——— what it shows (on-device AI, or Ask Claude) ———
    const descBox = h('div', { class: 'img-desc', 'aria-live': 'polite' });
    const askBtn = () => h('button', { class: 'px-btn', type: 'button', 'data-act': 'img-ask', onclick: () => Mochi.imageScan?.askClaude?.(r, ctx) }, `✎ ${T('img.askClaude')}`);
    function renderDescription(state, d) {
      if (d) {
        const rows = [['img.d.style', d.style], ['img.d.setting', d.setting], ['img.d.objects', (d.objects || []).join(', ')], ['img.d.composition', d.composition], ['img.d.camera', d.camera], ['img.d.lighting', d.lighting], ['img.d.mood', d.mood]].filter(([, v]) => v);
        descBox.replaceChildren(
          h('p', { class: 'img-caption', text: d.caption || d.subject }),
          h('div', { class: 'kvs' }, ...rows.map(([k, v]) => h('div', { class: 'kv static' }, h('span', { class: 'k', text: T(k) }), h('span', { class: 'v', text: v })))),
          h('p', { class: 'note', text: T('img.onDevice') }),
          h('div', { class: 'row' }, askBtn()));
        return;
      }
      if (state === 'checking' || state === 'describing') { descBox.replaceChildren(h('p', { class: 'note', text: T(state === 'checking' ? 'img.aiChecking' : 'img.aiDescribing') })); return; }
      if (state === 'downloadable' || state === 'downloading') {
        descBox.replaceChildren(h('p', { class: 'note', text: T(state === 'downloading' ? 'img.aiDownloading' : 'img.aiDownloadable') }),
          h('div', { class: 'row' },
            h('button', { class: 'px-btn', type: 'button', 'data-act': 'img-ai-download', onclick: () => Mochi.imageTarget.send({ op: 'openAiModel' }).catch(() => {}) }, `⤓ ${T('img.aiGet')}`),
            askBtn()));
        return;
      }
      // Unavailable (or failed): only the button.
      descBox.replaceChildren(h('div', { class: 'row' }, askBtn()), h('p', { class: 'note', text: T('img.askNote') }));
    }

    // ——— prompts ———
    const box = h('textarea', { class: 'export img-prompt', readonly: true, spellcheck: 'false', 'aria-label': T('img.prompt') });
    let tab = 'universal';
    const tabText = id => (id === 'sd' ? `${prompts.sd.prompt}\n\nNegative prompt: ${prompts.sd.negative}\n\nSize: ${prompts.sd.size}` : prompts[id]);
    const tabs = h('div', { class: 'tabs', role: 'tablist' }, ...TABS.map(([id, label]) => h('button', {
      class: 'px-btn tab', type: 'button', role: 'tab', 'data-format': id, onclick: () => setTab(id),
    }, label.includes('.') ? T(label) : label)));
    const altText = h('p', { class: 'img-alt' });
    function setTab(id) {
      tab = id;
      for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.format === id));
      box.value = tabText(id);
      box.scrollTop = 0;
      altText.textContent = prompts.alt;
    }
    const promptActions = h('div', { class: 'row' },
      h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'img-copy-prompt', onclick: () => copy(box.value, T('img.prompt')) }, `⧉ ${T('panel.copy')}`),
      ctx.actions.paste ? h('button', { class: 'px-btn', type: 'button', 'data-act': 'img-paste', onclick: () => ctx.actions.paste({ kind: 'image', paste: box.value }) }, `✎ ${T('panel.pasteToClaude')}`) : null);
    const altRow = h('div', { class: 'img-alt-row' }, h('b', { text: T('img.alt') }), altText,
      h('button', { class: 'px-btn', type: 'button', 'data-act': 'img-copy-alt', onclick: () => copy(prompts.alt, T('img.alt')) }, `⧉ ${T('panel.copy')}`));

    const refreshPrompts = () => { prompts = Mochi.imagePrompt.build(r); setTab(tab); };

    // ——— footer ———
    let savedEntry = null;
    const save = h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'img-save', onclick: async () => {
      if (!Mochi.pocket) return;
      savedEntry = await Mochi.pocket.add(entryFor(r), { offered: ctx.isClaude });
      save.disabled = true;
      save.textContent = `▣ ${T('panel.savedToPocket')}`;
      engine.saved();
    } }, `▣ ${T('img.save')}`);
    if (saved) { save.disabled = true; save.textContent = `▣ ${T('panel.savedToPocket')}`; }
    const footer = h('div', { class: 'img-foot' }, h('div', { class: 'row' }, save), h('p', { class: 'note', text: T('img.respect') }));

    panel.open(T('img.title'), `${prompts.aspect.label} · ${r.source?.host || ''}`, h('div', { class: 'img-card' },
      top,
      section(T('panel.colors'), 'colors', swatches, gradient, h('p', { class: 'note', text: T('panel.swatchHint') }), colorActions),
      section(T('img.text'), 'text', ...textSec),
      section(T('img.font'), 'font', ...fontSec),
      section(T('img.shows'), 'describe', descBox),
      section(T('img.prompt'), 'prompt', tabs, box, promptActions, altRow),
    ), footer);
    panel.view = 'image';
    setTab('universal');

    // The description: on-device when Chrome has the model (asked once per scan).
    if (r.description) renderDescription('done', r.description);
    else if (r.job && !saved) describe();
    else renderDescription('unavailable');
    async function describe() {
      renderDescription('checking');
      let s = null;
      try { s = await Mochi.imageTarget.send({ op: 'aiStatus' }); } catch (_) { s = { available: 'unavailable' }; }
      if (panel.view !== 'image') return;
      if (s.available !== 'available') { renderDescription(s.available); return; }
      renderDescription('describing');
      let out = null;
      try { out = await Mochi.imageTarget.send({ op: 'describe', job: r.job }); } catch (_) { out = null; }
      if (panel.view !== 'image') return;
      if (out?.description) {
        r.description = out.description;
        renderDescription('done', out.description);
        refreshPrompts();
        ctx.emit('imageDescribed', r);
      } else renderDescription('unavailable');
    }
    api.redescribe = () => { if (panel.view === 'image' && !r.description && r.job) describe(); };
    return { refreshPrompts, get entry() { return savedEntry; } };
  }

  /** A saved scan from the pocket: the same card (no new description, no re-scan). */
  function showEntry(entry, ctx) {
    const r = { ...(entry.scan || {}), thumb: entry.thumb || entry.scan?.thumb };
    if (!r.palette) return;
    return show(r, ctx, { saved: true });
  }

  const api = (Mochi.imageCard = { show, showEntry, entryFor, compact, redescribe: () => {} });

  // The on-device model finished downloading (pages/ai-model.html): describe the open card now.
  if (globalThis.chrome?.runtime?.onMessage) {
    try { chrome.runtime.onMessage.addListener(msg => { if (msg?.type === 'mochi-image-ai-ready') api.redescribe(); return false; }); } catch (_) { /* no extension */ }
  }
})();
