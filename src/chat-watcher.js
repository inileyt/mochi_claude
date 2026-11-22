/*
 * Mochi — the chat watcher. Reads the chat page (read-only) through the site
 * adapter (src/site.js: claude.ai, ChatGPT, Gemini) and reports what is
 * happening. It never clicks, types, changes or sends anything, and it keeps
 * no copy of your messages: the text of the newest message is handed to the
 * mood engine once, in memory, and dropped.
 *
 * Signals (all through Mochi.site):
 *   - number of your messages grows        → userMessage
 *   - a reply starts streaming              → responseStart
 *   - the newest reply's text grows         → responseProgress
 *   - streaming has stopped for a moment    → responseEnd
 *   - the URL becomes a new chat            → newChat
 *   - keys in the message box               → typing
 *
 * If the adapter can't find a chat on the page (the site changed its page),
 * Mochi stays as a plain companion: no chat reactions, one console.debug.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const T = Mochi.config.timing;

  const last = nodes => (nodes.length ? nodes[nodes.length - 1] : null);
  const textOf = el => (el ? (el.innerText || el.textContent || '').trim() : '');

  /** The message box's container (for placing Mochi beside it), on any adapter. */
  Mochi.findInput = () => Mochi.site?.composerBox() || null;

  class ChatWatcher {
    /** `chat: false` on pages other than claude.ai: only typing, scrolling and tab visibility are watched, and no page text is read. */
    constructor(handlers, { chat = true, site = Mochi.site } = {}) {
      this.h = handlers;
      this.site = site;
      this.chat = chat && !!site;
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
      this.userCount = this.site.userMessages().length;
      this.streaming = this.isStreamingNow();
      this.replyLength = textOf(last(this.site.assistantMessages())).length;
      this.seenChat = this.site.hasChat();
      this.startedAt = Date.now();

      this.observer = new MutationObserver(() => this.schedule());
      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: this.site.watchAttributes,
      });
      this.interval = setInterval(() => this.scan(), T.scanEvery);
    }

    /** Typing, scrolling and tab visibility: the signals Mochi uses on every page. */
    listen() {
      // keydown for typing; input too, for text that arrives without keys
      // (dictation, paste, autocomplete, some keyboard layouts and IMEs).
      const onType = ev => {
        const field = ev.target?.closest?.('[contenteditable="true"], textarea, input');
        if (!field || ev.isComposing) return;
        this.h.typing?.((this.chat && Mochi.findInput()) || field);
      };
      document.addEventListener('keydown', onType, true);
      document.addEventListener('input', onType, true);
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
      return this.site.isStreaming();
    }

    /** No chat found for a while: the site's page has changed. Stay a plain companion (and look again later). */
    chatMissing() {
      if (this.seenChat || this.site.hasChat()) { this.seenChat = true; this.missing = false; return false; }
      if (Date.now() - this.startedAt < 10000) return true; // the page may still be loading
      if (!this.missing) {
        this.missing = true;
        try { console.debug(`[Mochi] Can't find the chat on this ${this.site.name} page; staying as a plain companion.`); } catch (_) { /* no console */ }
      }
      return true;
    }

    scan() {
      if (this.chatMissing()) return;
      // New conversation (claude.ai is a single-page app, so the URL changes without a reload).
      if (location.pathname !== this.path) {
        const wasPath = this.path;
        this.path = location.pathname;
        const users = this.site.userMessages().length;
        const isNew = this.site.isNewChat(this.path, wasPath, users);
        this.userCount = users;
        this.replyLength = textOf(last(this.site.assistantMessages())).length;
        if (isNew) this.h.newChat?.();
        // A new chat's first message moves the URL from /new to /chat/<id>: keep going below.
      }

      // Your message.
      const userNodes = this.site.userMessages();
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
          this.replyLength = textOf(last(this.site.assistantMessages())).length;
          this.h.responseStart?.();
        }
        const reply = last(this.site.assistantMessages());
        const length = textOf(reply).length;
        if (length > this.replyLength) {
          this.replyLength = length;
          this.h.responseProgress?.(reply);
        }
      } else if (this.streaming && now - this.lastStreamSeen >= T.streamEndGrace) {
        this.streaming = false;
        const reply = last(this.site.assistantMessages());
        this.replyLength = textOf(reply).length;
        this.h.responseEnd?.(textOf(reply).slice(-4000), reply);
      }
    }
  }

  Mochi.ChatWatcher = ChatWatcher;
})();
