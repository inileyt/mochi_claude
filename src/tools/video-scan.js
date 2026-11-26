/*
 * Mochi — Scan a video (loaded the first time it's used; Menu → Tools → Scanners). Pick a <video>
 * and Mochi reads it without changing anything: its real and displayed size, duration, sources
 * (and their types), poster, and the attributes that decide how it plays (autoplay, loop, muted,
 * controls, object-fit…). It grabs a still frame when the browser allows it (a cross-origin video's
 * pixels can't be read, so the poster is used instead), writes clean <video> HTML to recreate it,
 * and a prompt for Claude. Nothing is downloaded; the video isn't touched.
 *
 *   Mochi.videoScan.html(info) / .prompt(info)   — pure, from a plain info object (Node-testable)
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const T = (k, v) => Mochi.t(k, v);

  function selectorFor(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const cls = [...el.classList].filter(c => !/^(is-|has-|active|open|show|playing)/.test(c)).slice(0, 2).map(c => `.${CSS.escape(c)}`).join('');
    return `${el.tagName.toLowerCase()}${cls}`;
  }
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const secs = s => (s == null ? null : s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${Math.round(s * 10) / 10}s`);

  /** Read a <video> into a plain, serialisable info object (no pixels here). */
  function gather(v) {
    const cs = getComputedStyle(v);
    const r = v.getBoundingClientRect();
    const sources = [];
    const add = (src, type, media) => { if (src && !sources.some(s => s.src === src)) sources.push({ src, type: type || '', media: media || '' }); };
    add(v.getAttribute('src') ? v.src : '', '');
    for (const s of v.querySelectorAll('source')) add(s.src || s.getAttribute('src'), s.type, s.media);
    if (v.currentSrc) add(v.currentSrc, '');
    const dur = isFinite(v.duration) ? v.duration : null;
    return {
      selector: selectorFor(v), host: location.hostname || 'local',
      videoW: v.videoWidth || null, videoH: v.videoHeight || null,
      boxW: Math.round(r.width), boxH: Math.round(r.height),
      duration: dur, live: v.duration === Infinity || (!dur && !!v.currentSrc),
      poster: v.getAttribute('poster') || null,
      attrs: { autoplay: v.autoplay, loop: v.loop, muted: v.muted, controls: v.controls, playsinline: v.playsInline || v.hasAttribute('playsinline'), preload: v.preload || null },
      objectFit: cs.objectFit, radius: cs.borderRadius !== '0px' ? cs.borderRadius : null,
      sources, crossOrigin: v.crossOrigin || null,
    };
  }

  /** A grabbed still frame as a data URL, or null if the pixels can't be read (cross-origin taint). */
  function frameOf(v) {
    try {
      if (!v.videoWidth) return null;
      const c = document.createElement('canvas');
      const scale = Math.min(1, 640 / v.videoWidth);
      c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    } catch (_) { return null; } // tainted: a cross-origin video
  }

  /** Clean <video> HTML that recreates the player. */
  function html(info) {
    const a = info.attrs || {};
    const flags = [a.controls && 'controls', a.autoplay && 'autoplay', a.loop && 'loop', a.muted && 'muted', a.playsinline && 'playsinline'].filter(Boolean).join(' ');
    const style = [info.objectFit && info.objectFit !== 'fill' ? `object-fit: ${info.objectFit}` : '', info.radius ? `border-radius: ${info.radius}` : '', 'max-width: 100%'].filter(Boolean).join('; ');
    const src = (info.sources || []).filter(s => s.src);
    const lines = [`<video ${flags}${info.poster ? ` poster="${esc(info.poster)}"` : ''}${style ? ` style="${esc(style)}"` : ''}${a.preload && a.preload !== 'auto' ? ` preload="${esc(a.preload)}"` : ''}>`];
    for (const s of src) lines.push(`  <source src="${esc(s.src)}"${s.type ? ` type="${esc(s.type)}"` : ''}${s.media ? ` media="${esc(s.media)}"` : ''}>`);
    lines.push('</video>');
    return lines.join('\n');
  }

  function prompt(info) {
    const a = info.attrs || {};
    return [
      `Recreate this HTML5 video player from ${info.host || 'a web page'} (\`${info.selector}\`).`,
      '',
      `Native size ${info.videoW || '?'}×${info.videoH || '?'}, shown at ${info.boxW}×${info.boxH}px. ${info.duration ? `Duration ${secs(info.duration)}.` : info.live ? 'Live / streaming (no fixed duration).' : ''}`,
      `Plays: ${[a.autoplay && 'autoplay', a.loop && 'loops', a.muted && 'muted', a.controls && 'with controls', a.playsinline && 'inline'].filter(Boolean).join(', ') || 'default'}. object-fit: ${info.objectFit}.`,
      info.sources?.length ? `Sources:\n${info.sources.map(s => `- ${s.src}${s.type ? ` (${s.type})` : ''}`).join('\n')}` : 'No readable source URLs.',
      '',
      '```html',
      html(info),
      '```',
      '',
      'Keep the same sizing, object-fit and play behaviour. If a source is cross-origin, note it may need CORS or its own hosting.',
    ].filter(l => l !== '').join('\n');
  }

  async function open(ctx, opts = {}) {
    const { companion, panel } = ctx;
    const { h, copyText } = Mochi.ui;
    Mochi.menuInstance?.close();
    if (panel.isOpen) panel.close();
    let el = opts.el || null;
    if (!el) {
      const picker = new Mochi.Picker(companion);
      if (picker.hint?.firstChild) picker.hint.firstChild.textContent = T('video.title');
      companion.say(T('video.pickHint'), 2400);
      el = await picker.pick();
      if (!el) { ctx.engine.pickCancel?.(); return null; }
    }
    if (el.tagName !== 'VIDEO') { el = el.closest?.('video') || el.querySelector?.('video') || el; }
    if (!el || el.tagName !== 'VIDEO') { companion.say(T('video.notVideo'), 2600); return null; }
    const info = gather(el);
    const frame = frameOf(el);
    info.frame = !!frame;
    Mochi.videoScan.last = info;

    const body = h('div', { class: 'vid' });
    const shot = frame || info.poster;
    if (shot) body.append(h('div', { class: 'svg-preview' }, h('img', { class: 'anim-shot', alt: '', src: shot })));
    body.append(h('p', { class: 'note', text: T(frame ? 'video.gotFrame' : info.poster ? 'video.posterOnly' : 'video.noFrame') }));
    const kv = (k, v) => h('div', { class: 'srow' }, h('span', { class: 'k', text: k }), h('span', { class: 'v', text: v }));
    const a = info.attrs;
    body.append(h('section', { class: 'blk' },
      kv(T('video.size'), `${info.videoW || '?'}×${info.videoH || '?'} → ${info.boxW}×${info.boxH}px`),
      info.duration ? kv(T('video.duration'), secs(info.duration)) : (info.live ? kv(T('video.duration'), T('video.live')) : null),
      kv(T('video.plays'), [a.autoplay && 'autoplay', a.loop && 'loop', a.muted && 'muted', a.controls && 'controls', a.playsinline && 'inline'].filter(Boolean).join(' · ') || '—'),
      kv('object-fit', info.objectFit),
      kv(T('video.sources'), String(info.sources.length))));
    const box = h('textarea', { class: 'export', readonly: true, spellcheck: 'false', 'aria-label': 'HTML' });
    box.value = html(info);
    body.append(h('section', { class: 'blk' }, h('h4', { text: 'HTML' }), box));

    const forClaude = ctx.isClaude
      ? h('button', { class: 'px-btn', type: 'button', 'data-act': 'video-paste', onclick: async () => { panel.close(); ctx.engine.pasted(await Mochi.insertIntoComposer(prompt(info))); } }, `✎ ${T('panel.pasteToClaude')}`)
      : h('button', { class: 'px-btn', type: 'button', 'data-act': 'video-ai', onclick: async () => { await copyText(prompt(info), companion.shadow); ctx.actions.copied(T('video.forClaude')); } }, `⧉ ${T('video.forClaude')}`);
    const footer = h('div', { class: 'row' },
      h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'video-copy', onclick: async () => { await copyText(html(info), companion.shadow); ctx.actions.copied('HTML'); } }, `⧉ ${T('panel.copy')}`),
      forClaude,
      h('button', { class: 'px-btn', type: 'button', 'data-act': 'video-again', onclick: () => open(ctx) }, `⌖ ${T('panel.pickAnother')}`));
    panel.open(T('video.title'), info.selector, body, footer);
    panel.view = 'video';
    companion.play('hop');
    companion.say(T('video.done'), 2600);
    return info;
  }

  Mochi.videoScan = Object.assign(Mochi.videoScan || {}, { gather, frameOf, html, prompt, open });
  (Mochi.toolImpl = Mochi.toolImpl || {}).video = { open, close: () => {}, get isOpen() { return false; } };
  if (typeof module !== 'undefined') module.exports = Mochi.videoScan;
})();
