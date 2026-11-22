/*
 * Mochi — site adapters: how to read a chat on claude.ai, ChatGPT or Gemini.
 *
 * Every adapter answers the same questions, so the chat watcher, the mood
 * engine and the chat features never need to know which site they're on:
 *
 *   site.findComposer()      the message box (the editable element), or null
 *   site.composerBox()       the box around it (for placing Mochi beside it)
 *   site.userMessages()      messages you sent, in order
 *   site.assistantMessages() the AI's replies, in order (outermost elements)
 *   site.messages()          both, in page order: [{ role: 'user' | 'assistant', el }]
 *   site.answerAt(node)      the reply that contains this node, or null
 *   site.isStreaming()       is a reply being written right now?
 *   site.theme()             'dark' | 'light', or null (then Mochi looks at the page colors)
 *   site.isNewChat(path, previousPath, userCount)
 *   site.hasChat()           can this adapter see a chat on the page at all?
 *
 * An adapter file registers itself with plain data (src/sites/*.js):
 *   Mochi.sites.register({ id, name, hosts: [...], selectors: { userMessage, assistantMessage, streaming, input }, … })
 * Lists of selectors are tried in order; the first that matches wins.
 *
 * If a site changes its page and nothing matches any more, Mochi stays on the
 * page as a plain companion (no chat reactions), with one quiet console.debug.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const adapters = [];

  /** All elements for the first selector in the list that matches anything. */
  const firstAll = list => {
    for (const sel of list || []) {
      try { const found = document.querySelectorAll(sel); if (found.length) return [...found]; } catch (_) { /* a selector this browser rejects */ }
    }
    return [];
  };
  const firstOne = list => {
    for (const sel of list || []) {
      try { const found = document.querySelector(sel); if (found) return found; } catch (_) { /* next */ }
    }
    return null;
  };
  const outermost = (els, selector) => els.filter(el => !el.parentElement?.closest(selector));

  function makeAdapter(def) {
    const S = def.selectors;
    const answerSelector = S.assistantMessage.join(',');
    const base = {
      ...def,
      findComposer: () => firstOne(S.input),
      composerBox() {
        const el = this.findComposer();
        return el ? el.closest(def.composerBox || 'fieldset, form') || el : null;
      },
      userMessages: () => firstAll(S.userMessage),
      assistantMessages: () => outermost(firstAll(S.assistantMessage), answerSelector),
      messages() {
        const all = [...this.userMessages().map(el => ({ role: 'user', el })), ...this.assistantMessages().map(el => ({ role: 'assistant', el }))];
        return all.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
      },
      answerAt(node) {
        for (const sel of S.assistantMessage) {
          try { const el = node?.closest?.(sel); if (el) return outermost([el], answerSelector)[0] || el.parentElement?.closest(answerSelector) || el; } catch (_) { /* next */ }
        }
        return null;
      },
      isStreaming: () => firstAll(S.streaming).length > 0,
      theme: () => null,
      isNewChat: (path, previous, userCount) => userCount === 0,
      hasChat() { return !!(this.findComposer() || this.userMessages().length || this.assistantMessages().length); },
      watchAttributes: def.watchAttributes || ['aria-label', 'data-testid'],
    };
    for (const [k, v] of Object.entries(def)) if (typeof v === 'function') base[k] = v;
    return base;
  }

  Mochi.sites = {
    register(def) { adapters.push(makeAdapter(def)); },
    all: () => adapters.slice(),
    get: id => adapters.find(a => a.id === id) || null,
    /** The adapter for this page: by host name, or a local test page's <html data-mochi-test="claude|chatgpt|gemini">. */
    current() {
      const test = document.documentElement?.dataset?.mochiTest;
      const local = location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(location.hostname);
      if (local && test) return this.get(test);
      return adapters.find(a => (a.hosts || []).includes(location.hostname)) || null;
    },
    firstAll, firstOne,
  };
  Object.defineProperty(Mochi, 'site', { get: () => Mochi.sites.current(), configurable: true });
})();
