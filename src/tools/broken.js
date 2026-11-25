/*
 * Mochi — Broken links & images (loaded the first time it's used; Menu → Tools → Scanners).
 * A quick health check of the page, read locally — nothing is fetched, nothing leaves the browser:
 *   - broken images: an <img> that finished loading with no pixels (naturalWidth 0), or one with no src,
 *   - missing alt: an <img> with a src but no `alt` attribute (an accessibility problem; alt="" is fine),
 *   - dead links: an <a> whose href is empty / "#" / "javascript:…", or an in-page "#id" link whose
 *     target isn't on the page. (Links to other sites aren't fetched, so their 404s can't be seen here.)
 * Click a result and Mochi scrolls to it and outlines it. Copy a report, or hand it to Claude to fix.
 *
 *   Mochi.broken.classify({ images, links, ids }) → { brokenImages, imagesNoAlt, deadLinks, counts }  (pure)
 *   Mochi.broken.scan(document)                   → the same, with the live elements attached
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const T = (k, v) => Mochi.t(k, v);

  /** A short, stable-ish selector for a result row. */
  function selectorFor(el) {
    if (el.id) return `#${el.id}`;
    const cls = (typeof el.className === 'string' ? el.className.trim().split(/\s+/) : []).filter(Boolean).slice(0, 2).map(c => `.${c}`).join('');
    return `${el.tagName.toLowerCase()}${cls}`;
  }
  const short = u => { const s = String(u || '').split(/[?#]/)[0]; return s.length > 60 ? `…${s.slice(-57)}` : s; };

  /** Pure: classify descriptors into issues. images/links/ids are plain data, so this is Node-testable. */
  function classify({ images = [], links = [], ids = [] } = {}) {
    const idset = new Set(ids.filter(Boolean).map(String));
    const brokenImages = [], imagesNoAlt = [], deadLinks = [];
    for (const im of images) {
      if (!im.hasSrc) brokenImages.push({ el: im.el, sel: im.sel, detail: '(no src)' });
      else if (im.complete && im.naturalWidth === 0) brokenImages.push({ el: im.el, sel: im.sel, detail: short(im.srcShort) });
      if (im.hasSrc && !im.hasAlt) imagesNoAlt.push({ el: im.el, sel: im.sel, detail: short(im.srcShort) });
    }
    for (const a of links) {
      const raw = String(a.rawHref == null ? '' : a.rawHref).trim();
      if (raw === '' || raw === '#' || /^javascript:\s*(?:void\(0\))?;?$/i.test(raw)) { deadLinks.push({ el: a.el, sel: a.sel, detail: raw || '(empty)', reason: 'empty' }); continue; }
      if (a.hash && a.samePage) {
        const id = (() => { try { return decodeURIComponent(a.hash.slice(1)); } catch (_) { return a.hash.slice(1); } })();
        if (id && !idset.has(id)) deadLinks.push({ el: a.el, sel: a.sel, detail: a.hash, reason: 'anchor' });
      }
    }
    return { brokenImages, imagesNoAlt, deadLinks, counts: { images: images.length, links: links.length, brokenImages: brokenImages.length, imagesNoAlt: imagesNoAlt.length, deadLinks: deadLinks.length } };
  }

  function descriptorsOf(doc) {
    const images = [...doc.querySelectorAll('img')].map(el => ({
      el, sel: selectorFor(el),
      hasSrc: !!(el.getAttribute('src') || el.getAttribute('srcset') || el.currentSrc),
      complete: el.complete, naturalWidth: el.naturalWidth,
      hasAlt: el.hasAttribute('alt'), srcShort: el.currentSrc || el.getAttribute('src') || '',
    }));
    const links = [...doc.querySelectorAll('a')].map(el => {
      const rawHref = el.getAttribute('href');
      let hash = '', samePage = false;
      try { const u = new URL(el.href, location.href); hash = u.hash; samePage = u.origin === location.origin && u.pathname === location.pathname && u.search === location.search; } catch (_) { /* a weird href */ }
      return { el, sel: selectorFor(el), rawHref, hash, samePage };
    });
    const ids = [...doc.querySelectorAll('[id]')].map(e => e.id).concat([...doc.querySelectorAll('a[name]')].map(e => e.getAttribute('name')));
    return { images, links, ids };
  }

  function scan(doc = document) { return classify(descriptorsOf(doc)); }

  function reportText(r) {
    const lines = [`Page check — ${location.href}`, ''];
    const block = (title, items, fmt) => { if (!items.length) return; lines.push(`${title} (${items.length}):`); for (const i of items) lines.push(`- ${fmt(i)}`); lines.push(''); };
    block('Broken images', r.brokenImages, i => `${i.sel} → ${i.detail}`);
    block('Images missing alt text', r.imagesNoAlt, i => `${i.sel} → ${i.detail}`);
    block('Dead links', r.deadLinks, i => `${i.sel} → ${i.detail}${i.reason === 'anchor' ? ' (no matching element on the page)' : ''}`);
    if (!r.counts.brokenImages && !r.counts.imagesNoAlt && !r.counts.deadLinks) lines.push('No broken images, missing alt text or dead links found. 🎉');
    return lines.join('\n').trim();
  }
  const prompt = r => `${reportText(r)}\n\nPlease explain how to fix each of these and give the corrected HTML where you can.`;

  // ——— UI ———
  let boxEl = null, boxT = 0;
  function flash(ctx, el) {
    if (!el || !el.getBoundingClientRect) return;
    try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); } catch (_) { /* detached */ }
    const r = el.getBoundingClientRect();
    boxEl = boxEl || ctx.companion.shadow.appendChild(Mochi.ui.h('div', { class: 'brk-box', 'aria-hidden': 'true' }));
    Object.assign(boxEl.style, { left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px`, opacity: '1' });
    clearTimeout(boxT); boxT = setTimeout(() => { if (boxEl) boxEl.style.opacity = '0'; }, 1700);
  }

  async function open(ctx, opts = {}) {
    const { companion, panel } = ctx;
    const { h, copyText } = Mochi.ui;
    Mochi.menuInstance?.close();
    if (panel.isOpen) panel.close();
    companion.setMood?.('curious');
    const r = scan(document);
    Mochi.broken.last = r;

    const total = r.counts.brokenImages + r.counts.imagesNoAlt + r.counts.deadLinks;
    const body = h('div', { class: 'brk' });
    body.append(h('p', { class: 'note', text: T('broken.scanned', { images: r.counts.images, links: r.counts.links }) }));

    const section = (titleKey, items, cls) => {
      if (!items.length) return;
      const list = h('div', { class: `brk-list ${cls}` });
      for (const it of items) list.append(h('button', {
        class: 'brk-row', type: 'button', title: T('broken.reveal'),
        onclick: ev => { ev.stopPropagation(); flash(ctx, it.el); },
      }, h('span', { class: 'brk-sel', text: it.sel }), h('span', { class: 'brk-detail', text: it.detail })));
      body.append(h('section', { class: 'blk' }, h('h4', { text: `${T(titleKey)} · ${items.length}` }), list));
    };
    if (!total) body.append(h('p', { class: 'brk-ok', text: T('broken.none') }));
    section('broken.brokenImages', r.brokenImages, 'bad');
    section('broken.deadLinks', r.deadLinks, 'bad');
    section('broken.noAlt', r.imagesNoAlt, 'warn');

    const footer = h('div', { class: 'row' },
      h('button', { class: 'px-btn', type: 'button', 'data-act': 'brk-rescan', onclick: () => open(ctx) }, `⟳ ${T('broken.rescan')}`));
    if (total) {
      footer.prepend(
        h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'brk-copy', onclick: async () => { await copyText(reportText(r), companion.shadow); ctx.actions.copied(T('broken.report')); } }, `⧉ ${T('broken.copy')}`),
        ctx.isClaude
          ? h('button', { class: 'px-btn', type: 'button', 'data-act': 'brk-paste', onclick: async () => { panel.close(); ctx.engine.pasted(await Mochi.insertIntoComposer(prompt(r))); } }, `✎ ${T('panel.pasteToClaude')}`)
          : h('button', { class: 'px-btn', type: 'button', 'data-act': 'brk-ai', onclick: async () => { await copyText(prompt(r), companion.shadow); ctx.actions.copied(T('broken.forClaude')); } }, `⧉ ${T('broken.forClaude')}`));
    }

    panel.open(T('broken.title'), T('broken.sub', { n: total }), body, footer);
    panel.view = 'broken';
    companion.play(total ? 'wiggle' : 'hop');
    companion.say(total ? T('broken.found', { n: total }) : T('broken.clean'), 2800);
    return r;
  }

  Mochi.broken = Object.assign(Mochi.broken || {}, { classify, scan, reportText, prompt, open });
  (Mochi.toolImpl = Mochi.toolImpl || {}).broken = { open, close: () => { if (boxEl) boxEl.style.opacity = '0'; }, get isOpen() { return false; } };
  if (typeof module !== 'undefined') module.exports = Mochi.broken;
})();
