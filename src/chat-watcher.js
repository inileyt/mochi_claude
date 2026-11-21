/*
 * Mochi — the chat watcher. Reads claude.ai's page (read-only) and reports
 * what is happening in the chat. It never clicks, types, changes or sends
 * anything, and it keeps no copy of your messages: the text of the newest
 * message is handed to the mood engine once, in memory, and dropped.
 *
 * Signals it uses (all from config.selectors):
 *   - number of your messages grows        → userMessage
 *   - a "streaming" marker appears          → responseStart
 *   - Claude's newest reply text grows      → responseProgress
 *   - the streaming marker is gone a moment → responseEnd
 *   - the URL becomes a new chat            → newChat
 *   - keys in the message box               → typing
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const S = Mochi.config.selectors;
  const T = Mochi.config.timing;

  const queryAll = list => {
    for (const sel of list) {
      try {
        const found = document.querySelectorAll(sel);
        if (found.length) return found;
      } catch (_) { /* a selector this browser rejects: try the next */ }
    }
    return [];
  };
  const queryOne = list => {
    for (const sel of list) {
      try {
        const found = document.querySelector(sel);
        if (found) return found;
      } catch (_) { /* next */ }
    }
    return null;
  };
  const last = nodes => (nodes.length ? nodes[nodes.length - 1] : null);
  const textOf = el => (el ? (el.innerText || el.textContent || '').trim() : '');

  Mochi.findInput = () => {
    const input = queryOne(S.input);
    return input && input.closest('fieldset, form') ? input.closest('fieldset, form') : input;
  };

  class ChatWatcher {
    /** `chat: false` on pages other than claude.ai: only typing, scrolling and tab visibility are watched, and no page text is read. */
    constructor(handlers, { chat = true } = {}) {
      this.h = handlers;
      this.chat = chat;
      this.userCount = 0;
      this.streaming = false;
      this.lastStreamSeen = 0;
      this.replyLength = 0;
      this.path = location.pathname;
      this.pending = false;
    }

    start() {
      this.listen();
      if (!this.chat) return;
      // Baseline: an already-open conversation is not news.
      this.userCount = queryAll(S.userMessage).length;
      this.streaming = this.isStreamingNow();
      this.replyLength = textOf(last(queryAll(S.assistantMessage))).length;

      this.observer = new MutationObserver(() => this.schedule());
      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['data-is-streaming', 'aria-label', 'data-testid'],
      });
      this.interval = setInterval(() => this.scan(), T.scanEvery);
    }

    /** Typing, scrolling and tab visibility: the signals Mochi uses on every page. */
    listen() {
      document.addEventListener('keydown', ev => {
        const field = ev.target?.closest?.('[contenteditable="true"], textarea, input');
        if (!field || ev.isComposing) return;
        this.h.typing?.((this.chat && Mochi.findInput()) || field);
      }, true);
      addEventListener('scroll', () => this.h.scroll?.(), { capture: true, passive: true });
      document.addEventListener('visibilitychange', () => this.h.visibility?.(document.hidden));
    }

    // Many mutations arrive while Claude streams: look at most ~4 times a second.
    schedule() {
      if (this.pending) return;
      this.pending = true;
      setTimeout(() => { this.pending = false; this.scan(); }, 250);
    }

    isStreamingNow() {
      return queryAll(S.streaming).length > 0;
    }

    scan() {
      // New conversation (claude.ai is a single-page app, so the URL changes without a reload).
      if (location.pathname !== this.path) {
        const wasPath = this.path;
        this.path = location.pathname;
        const users = queryAll(S.userMessage).length;
        const isNew = /\/new\/?$/.test(this.path) || (users === 0 && !/\/new\/?$/.test(wasPath));
        this.userCount = users;
        this.replyLength = textOf(last(queryAll(S.assistantMessage))).length;
        if (isNew) this.h.newChat?.();
        // A new chat's first message moves the URL from /new to /chat/<id>: keep going below.
      }

      // Your message.
      const userNodes = queryAll(S.userMessage);
      if (userNodes.length > this.userCount) {
        const el = last(userNodes);
        this.h.userMessage?.(textOf(el).slice(0, 4000), el);
      }
      this.userCount = userNodes.length;

      // Claude's reply.
      const now = Date.now();
      const streamingNow = this.isStreamingNow();
      if (streamingNow) {
        this.lastStreamSeen = now;
        if (!this.streaming) {
          this.streaming = true;
          this.replyLength = textOf(last(queryAll(S.assistantMessage))).length;
          this.h.responseStart?.();
        }
        const reply = last(queryAll(S.assistantMessage));
        const length = textOf(reply).length;
        if (length > this.replyLength) {
          this.replyLength = length;
          this.h.responseProgress?.(reply);
        }
      } else if (this.streaming && now - this.lastStreamSeen >= T.streamEndGrace) {
        this.streaming = false;
        const reply = last(queryAll(S.assistantMessage));
        this.replyLength = textOf(reply).length;
        this.h.responseEnd?.(textOf(reply).slice(-4000));
      }
    }
  }

  Mochi.ChatWatcher = ChatWatcher;
})();
