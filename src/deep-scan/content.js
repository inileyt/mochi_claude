/*
 * Mochi — Deep Scan: the text on the page, as placeholders. For each region,
 * its text blocks (headings, paragraphs, buttons, links, list items…) with
 * their role, length, line count and type style — and, unless "this is my own
 * site", a neutral filler of the same length instead of the real words. The
 * brand name (the logo's text) becomes "Brand".
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const D = Mochi.deepScan;
  const BLOCKS = 'h1, h2, h3, h4, h5, h6, p, li, a, button, label, summary, blockquote, figcaption, th, td, dt, dd, span, small, strong, em, div';
  const FILLER = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat ';
  /** Neutral text of exactly n characters (words kept whole where possible). */
  function filler(n, { title = false } = {}) {
    let s = '';
    while (s.length < n) s += FILLER;
    s = s.slice(0, n).replace(/\s+$/, '');
    while (s.length < n) s += '.';
    return title ? s.replace(/^\w/, c => c.toUpperCase()) : s.charAt(0).toUpperCase() + s.slice(1);
  }
  /** How many lines the element's own text really takes (distinct line positions of its text). */
  function linesOf(el) {
    const tops = new Set();
    const range = document.createRange();
    for (const c of el.childNodes) {
      if (c.nodeType !== 3 || !c.nodeValue.trim()) continue;
      range.selectNodeContents(c);
      for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top / 4));
    }
    return Math.max(1, tops.size);
  }
  const ownLen = el => [...el.childNodes].filter(c => c.nodeType === 3).reduce((a, c) => a + c.nodeValue.trim().length, 0);
  const roleOf = el => {
    const t = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(t)) return t;
    if (t === 'a') return Mochi.color.parseColor(getComputedStyle(el).backgroundColor) || /btn|button/i.test(el.className) ? 'button label' : el.closest('nav, header') ? 'nav link' : 'link';
    if (t === 'button' || el.getAttribute('role') === 'button') return 'button label';
    if (t === 'li') return 'list item';
    if (t === 'p' || t === 'div' || t === 'span') return el.closest('button, a') ? 'button label' : 'text';
    return t;
  };

  function brandWords() {
    const words = new Set();
    for (const el of document.querySelectorAll('header [class*="logo"], header [class*="brand"], [class*="logo"] span, a[aria-label*="home" i] span, header a[href="/"]')) {
      const t = el.textContent.trim();
      if (t && t.length <= 30) words.add(t);
    }
    const title = (document.title.split(/[|—–·-]/)[0] || '').trim();
    if (title && title.length <= 24 && !/\s{1}\w+\s\w+\s/.test(title)) words.add(title);
    return [...words];
  }

  async function run(scan) {
    const own = scan.opts.ownSite;
    const brands = brandWords();
    let k = 0;
    for (const r of scan.regions || []) {
      const blocks = [];
      for (const el of r.el.querySelectorAll(BLOCKS)) {
        if (scan.ignore.contains(el) || blocks.length >= 40) continue;
        const len = ownLen(el);
        if (!len) continue;
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const cs = getComputedStyle(el);
        const lh = cs.lineHeight === 'normal' ? parseFloat(cs.fontSize) * 1.2 : parseFloat(cs.lineHeight);
        const text = el.textContent.trim().replace(/\s+/g, ' ');
        const isBrand = brands.some(b => text === b);
        const role = isBrand ? 'brand name' : roleOf(el);
        const lines = linesOf(el); void lh;
        const c = Mochi.color.parseColor(cs.color);
        blocks.push({
          role, chars: text.length, lines,
          style: `${cs.fontSize}/${cs.lineHeight} ${cs.fontWeight} ${cs.fontFamily.split(',')[0].replace(/["']/g, '')}`,
          color: c ? Mochi.color.hex(c) : cs.color, align: cs.textAlign,
          ...(cs.textTransform !== 'none' ? { transform: cs.textTransform } : {}),
          ...(own ? { text: text.slice(0, 400) } : { placeholder: isBrand ? 'Brand' : filler(Math.min(text.length, 400), { title: /^h[1-6]$/.test(role) }) }),
        });
      }
      const spec = scan.spec.structure.regions.find(x => x.id === r.id);
      if (spec) spec.content = blocks;
      if (++k % 3 === 0) await scan.breathe();
    }
    scan.spec.content = { ownSite: own, brandPlaceholders: own ? null : 'Brand', note: own ? 'The original texts are kept (your own site).' : 'Texts are neutral filler of the same length (same lines, same style); the brand name is "Brand". Write your own copy.' };
    if (!own) scan.spec.source.title = '(placeholder title)';
  }

  Mochi.deepContent = { filler, brandWords };
  D.addPhase({ id: 'content', order: 75, cdp: false, label: 'deep.step.media', budget: 10000, weight: 0.5, run });
})();
