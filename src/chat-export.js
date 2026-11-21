/*
 * Mochi — export the chat as Markdown (claude.ai).
 *
 * Menu → Tools → Export chat (.md): reads the conversation on the screen
 * (your messages and Claude's answers, in order), turns Claude's formatting
 * into Markdown (headings, lists, code blocks with their language, tables,
 * quotes, links, bold/italic) and saves a .md file through a Blob download.
 * Nothing is sent anywhere; nothing is kept after the download.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  const SKIP = new Set(['BUTTON', 'SVG', 'svg', 'STYLE', 'SCRIPT', 'NOSCRIPT', 'TEMPLATE', 'INPUT', 'TEXTAREA', 'SELECT']);
  const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'PRE', 'BLOCKQUOTE', 'TABLE', 'HR', 'FIGURE', 'DETAILS', 'SUMMARY']);

  const fence = code => '`'.repeat(Math.max(3, ...[...code.matchAll(/`+/g)].map(m => m[0].length + 1)));
  const inlineCode = code => {
    const ticks = '`'.repeat(Math.max(1, ...[...code.matchAll(/`+/g)].map(m => m[0].length + 1)));
    return ticks.length > 1 || code.startsWith('`') || code.endsWith('`') ? `${ticks} ${code} ${ticks}` : `${ticks}${code}${ticks}`;
  };
  const hidden = el => el.getAttribute?.('aria-hidden') === 'true' || el.hidden || el.getAttribute?.('role') === 'button';
  const langOf = el => {
    const cls = `${el.className || ''} ${el.querySelector?.('code')?.className || ''}`;
    return (cls.match(/(?:language|lang)-([\w#+.-]+)/) || [])[1] || '';
  };

  /** Inline Markdown for an element's children. */
  function inline(node) {
    let out = '';
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { out += child.nodeValue.replace(/\s+/g, ' '); continue; }
      if (child.nodeType !== 1 || SKIP.has(child.tagName) || hidden(child)) continue;
      const tag = child.tagName;
      if (BLOCK.has(tag)) { out += ` ${inline(child)} `; continue; }
      const inner = () => inline(child);
      switch (tag) {
        case 'BR': out += '  \n'; break;
        case 'STRONG': case 'B': { const x = inner().trim(); if (x) out += `**${x}**`; break; }
        case 'EM': case 'I': { const x = inner().trim(); if (x) out += `*${x}*`; break; }
        case 'DEL': case 'S': { const x = inner().trim(); if (x) out += `~~${x}~~`; break; }
        case 'CODE': out += inlineCode(child.textContent); break;
        case 'A': {
          const text = inner().trim();
          const href = child.getAttribute('href') || '';
          out += href && !href.startsWith('javascript:') ? `[${text || href}](${href})` : text;
          break;
        }
        case 'IMG': out += `![${child.getAttribute('alt') || ''}](${child.getAttribute('src') || ''})`; break;
        default: out += inner();
      }
    }
    return out;
  }

  /** Block-level Markdown for a node's children, as a list of blocks. */
  function blocks(node, depth = 0) {
    const out = [];
    let line = '';
    const flush = () => { const x = line.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim(); if (x) out.push(x); line = ''; };
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { line += child.nodeValue.replace(/\s+/g, ' '); continue; }
      if (child.nodeType !== 1 || SKIP.has(child.tagName) || hidden(child)) continue;
      const tag = child.tagName;
      if (!BLOCK.has(tag)) { line += inline({ childNodes: [child] }); continue; }
      flush();
      if (/^H[1-6]$/.test(tag)) out.push(`${'#'.repeat(Math.min(6, Number(tag[1]) + headingShift))} ${inline(child).trim()}`);
      else if (tag === 'P' || tag === 'SUMMARY') { const x = inline(child).trim(); if (x) out.push(x); }
      else if (tag === 'PRE') {
        const code = (child.querySelector('code') || child).textContent.replace(/\n$/, '');
        const f = fence(code);
        out.push(`${f}${langOf(child)}\n${code}\n${f}`);
      } else if (tag === 'UL' || tag === 'OL') out.push(list(child, depth));
      else if (tag === 'BLOCKQUOTE') out.push(blocks(child, depth).join('\n\n').split('\n').map(l => (l ? `> ${l}` : '>')).join('\n'));
      else if (tag === 'HR') out.push('---');
      else if (tag === 'TABLE') out.push(table(child));
      else out.push(...blocks(child, depth)); // DIV, SECTION, FIGURE, DETAILS…: look inside
    }
    flush();
    return out;
  }

  function list(el, depth) {
    const ordered = el.tagName === 'OL';
    let n = Number(el.getAttribute('start')) || 1;
    const lines = [];
    for (const li of el.children) {
      if (li.tagName !== 'LI') continue;
      const marker = ordered ? `${n++}.` : '-';
      const pad = ' '.repeat(marker.length + 1);
      const parts = blocks(li, depth + 1);
      const [first = '', ...rest] = parts;
      lines.push(`${marker} ${first.split('\n').join(`\n${pad}`)}`);
      for (const p of rest) lines.push(p.split('\n').map(l => (l ? pad + l : l)).join('\n'));
    }
    return lines.join('\n');
  }

  function table(el) {
    const rows = [...el.querySelectorAll('tr')].map(tr => [...tr.children].map(td => inline(td).trim().replace(/\|/g, '\\|').replace(/\n/g, ' ')));
    if (!rows.length) return '';
    const width = Math.max(...rows.map(r => r.length));
    const pad = r => [...r, ...Array(width - r.length).fill('')];
    const [head, ...body] = rows.map(pad);
    return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...body.map(r => `| ${r.join(' | ')} |`)].join('\n');
  }

  /** Markdown for one message element. `shift` moves its headings down (inside "## Claude", an h2 becomes ####). */
  let headingShift = 0;
  const toMarkdown = (el, { shift = 0 } = {}) => {
    headingShift = shift;
    try { return blocks(el).join('\n\n').replace(/\n{3,}/g, '\n\n').trim(); } finally { headingShift = 0; }
  };

  function first(list) {
    for (const sel of list) {
      try { const found = document.querySelectorAll(sel); if (found.length) return [...found]; } catch (_) { /* next */ }
    }
    return [];
  }

  /** The whole conversation on screen, in order, as one Markdown document. */
  function exportChat({ title = document.title, url = location.href, date = new Date() } = {}) {
    const S = Mochi.config.selectors;
    const users = first(S.userMessage).map(el => ({ who: 'user', el }));
    const claude = first(S.assistantMessage)
      .filter(el => !el.parentElement?.closest(S.assistantMessage.join(','))) // outermost only
      .map(el => ({ who: 'claude', el }));
    const all = [...users, ...claude].sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    if (!all.length) return null;
    const clean = String(title).replace(/^✓ /, '').replace(/\s*[-–|]\s*Claude\s*$/i, '').trim() || 'Claude chat';
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const t = Mochi.t;
    const parts = [`# ${clean}`, `*${t('export.from', { date: day })} · <${url.split('#')[0]}>*`];
    for (const m of all) {
      const body = m.who === 'user'
        ? (m.el.innerText || m.el.textContent || '').trim()
        : toMarkdown(m.el.querySelector('.font-claude-response, .font-claude-message') || m.el, { shift: 2 });
      if (!body) continue;
      parts.push(`## ${m.who === 'user' ? t('export.you') : 'Claude'}`, body);
    }
    const slug = clean.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'claude-chat';
    return { name: `${slug}-${day}.md`, markdown: `${parts.join('\n\n')}\n`, messages: all.length };
  }

  Mochi.chatExport = { toMarkdown, exportChat };
  Mochi.menu.addItem({ section: 'tools', id: 'export-chat', icon: '⤓', label: 'menu.exportChat', when: ctx => ctx.isClaude, run: () => Mochi.chatExport.run?.() });

  Mochi.features = Mochi.features || [];
  Mochi.features.push({
    id: 'chat-export',
    init(ctx) {
      if (!ctx.isClaude) return;
      Mochi.chatExport.run = () => {
        const res = exportChat();
        if (!res) { ctx.companion.say(Mochi.t('export.nothing'), 2000); return null; }
        Mochi.ui.downloadText(res.name, res.markdown, ctx.companion.shadow);
        ctx.actions.downloaded(res.name);
        ctx.emit('chatExported', res.messages);
        return res;
      };
      Mochi.debugHooks.exportChat = () => Mochi.chatExport.run();
    },
  });
})();
