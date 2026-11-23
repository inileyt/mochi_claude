/*
 * Mochi — Live Edit, the careful part: what CSS may go into a page, where the CSS is in
 * Claude's answer, and the question Mochi asks. Plain functions (Node-testable).
 *
 *   L.sanitize(css) → { css, removed: ['@import', 'url(https://…)', …] }
 *     CSS only, and nothing that could load from the web or run code: @import and remote
 *     @font-face go, url()/image-set() that aren't data: become `none`, expression(),
 *     javascript:, behavior and -moz-binding declarations go. 50 KB at most.
 *   L.fromText(markdown) → css     the ```css blocks of an answer's text (or CSS-looking blocks)
 *   L.fromBlocks([{ lang, text }]) → css
 *   L.question({ wish, url, title, selector, tag, size, styles, html, whole, current, lang }) → text
 *   L.MARK(id) → '[Mochi Live Edit #id]'   (how Mochi recognises the answer to its question)
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const MAX = 50000;
  const MARK = id => `[Mochi Live Edit #${id}]`;
  const looksLikeCss = t => /[^{}]+\{[^{}]*:[^{}]*\}/.test(t) && !/^\s*(<|function\b|const\b|let\b|import\b|export\b)/.test(t);

  function sanitize(input) {
    let css = String(input || '').slice(0, MAX);
    const removed = [];
    const drop = (re, label, by = '') => { css = css.replace(re, m => { removed.push(label(m)); return by; }); };
    // Whole at-rules that fetch: @import, and @font-face with a non-data source.
    drop(/@import\b[^;{}]*;?/gi, () => '@import');
    css = css.replace(/@font-face\s*\{[^{}]*\}/gi, m => { if (!/url\(\s*['"]?(?!data:)/i.test(m)) return m; removed.push('@font-face (a font from the web)'); return ''; });
    // Declarations that run code.
    css = css.replace(/(?<=[;{]|^)\s*(-moz-binding|behavior)\s*:[^;{}]*;?/gim, (m, name) => { removed.push(name); return ' '; });
    drop(/[^;{}]*expression\s*\([^;{}]*;?/gi, () => 'expression()');
    drop(/[^;{}]*javascript\s*:[^;{}]*;?/gi, () => 'javascript:');
    // Anything else that would load from the web.
    drop(/url\(\s*(['"]?)(?!data:)([^'")]*)\1\s*\)/gi, m => m.slice(0, 60), 'none');
    drop(/(?:-webkit-)?image-set\([^)]*["'](?!data:)[^)]*\)/gi, () => 'image-set()', 'none');
    return { css: css.trim(), removed: removed.filter(Boolean) };
  }

  /** From an answer's Markdown text: ```css (or scss/less) blocks, else blocks that look like CSS. */
  function fromText(text) {
    const blocks = [...String(text || '').matchAll(/```([\w-]*)[^\n]*\n([\s\S]*?)```/g)].map(m => ({ lang: m[1].toLowerCase(), text: m[2] }));
    return fromBlocks(blocks);
  }
  function fromBlocks(blocks) {
    const css = blocks.filter(b => /^(css|scss|less)$/.test(b.lang || ''));
    const chosen = css.length ? css : blocks.filter(b => !b.lang && looksLikeCss(b.text));
    return chosen.map(b => b.text.trim()).filter(Boolean).join('\n\n');
  }

  const LANGS = { de: 'German', es: 'Spanish', fr: 'French', hy: 'Armenian', it: 'Italian', ja: 'Japanese', pt: 'Portuguese', ru: 'Russian', uk: 'Ukrainian', zh: 'Chinese' };
  function question(q) {
    const lines = [
      // The marker goes first so it survives even if the page shortens a long message (that is how
      // Mochi knows the answer is for this question); it is repeated at the end for readability.
      MARK(q.id),
      `Please change ${q.whole ? 'this web page' : 'this part of a web page'}: ${String(q.wish || '').trim()}`,
      '',
      `Page: ${q.title || ''} (${q.url || ''})`,
      q.whole ? `Whole page (selector \`${q.selector}\`).` : `Element: \`${q.selector}\` — a <${q.tag}>, ${q.size}.`,
    ];
    if (q.styles) lines.push(`Its current look: ${q.styles}`);
    if (q.html) lines.push('', 'Its HTML (shortened):', '```html', q.html, '```');
    if (q.current) lines.push('', 'The CSS I applied so far (change it, keep what still fits):', '```css', q.current, '```');
    lines.push(
      '',
      'Answer with ONE ```css code block: CSS that makes this change when it is added to the page.',
      `Target \`${q.selector}\` (or elements inside it), use !important where the page's own CSS would win, and don't use @import, url() to other sites or JavaScript.`,
    );
    if (LANGS[q.lang]) lines.push(`(You may explain in ${LANGS[q.lang]}, briefly, after the code.)`);
    lines.push('', MARK(q.id));
    return lines.join('\n');
  }

  Mochi.liveCss = { sanitize, fromText, fromBlocks, question, MARK, looksLikeCss, MAX };
  if (typeof module !== 'undefined') module.exports = Mochi.liveCss;
})();
