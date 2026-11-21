/*
 * Mochi — the pocket. Every scan Mochi makes goes into its pocket
 * (chrome.storage.local, in your browser only): the last 20, newest first.
 *
 *   await Mochi.pocket.add(scan)       → the saved entry (a page scan or a picked component, + its AI prompt)
 *   await Mochi.pocket.list()          → entries, newest first
 *   await Mochi.pocket.remove(id)
 *   await Mochi.pocket.nextUnoffered() → a scan Mochi hasn't offered on claude.ai yet
 *   await Mochi.pocket.markOffered(id)
 *   Mochi.pocket.onChange(fn)          → fn() when another tab adds or removes one
 *
 *   await Mochi.insertIntoComposer(text) puts text into claude.ai's message box
 *   the way a paste does. It never presses Enter: you send it yourself.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const KEY = 'mochi.pocket';
  const MAX = 20;

  // Without extension storage (the local test page), the pocket lives in memory.
  let memory = [];
  const hasStore = () => !!globalThis.chrome?.storage?.local;

  async function list() {
    if (!hasStore()) return memory.slice();
    try {
      const out = await chrome.storage.local.get(KEY);
      return Array.isArray(out[KEY]) ? out[KEY] : [];
    } catch (_) { return memory.slice(); }
  }

  async function save(items) {
    const kept = items.slice(0, MAX);
    memory = kept;
    if (!hasStore()) return;
    try { await chrome.storage.local.set({ [KEY]: kept }); } catch (_) { /* memory copy stays */ }
  }

  /** Saves a scan with its ready-made AI prompt. `offered: true` when there's nothing to offer later. */
  async function add(scan, { offered = false } = {}) {
    const entry = { ...scan, prompt: Mochi.promptFor ? Mochi.promptFor(scan) : Mochi.exporters.prompt(scan), offered };
    const items = (await list()).filter(item => item.id !== entry.id);
    items.unshift(entry);
    await save(items);
    return entry;
  }

  async function remove(id) {
    await save((await list()).filter(item => item.id !== id));
  }

  async function markOffered(id) {
    await save((await list()).map(item => (item.id === id ? { ...item, offered: true } : item)));
  }

  async function nextUnoffered() {
    return (await list()).find(item => !item.offered) || null;
  }

  function onChange(fn) {
    try {
      chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes[KEY]) fn(); });
    } catch (_) { /* no extension storage: nothing to watch */ }
  }

  // ——— claude.ai composer ———
  /** The editable message box itself (ProseMirror div or a textarea), found with the chat watcher's selectors. */
  function findEditor() {
    for (const sel of Mochi.config.selectors.input) {
      try {
        const found = document.querySelector(sel);
        if (found) return found;
      } catch (_) { /* next */ }
    }
    return null;
  }

  /**
   * Inserts text where the caret is (or at the end) as a paste would, so the
   * editor's own state updates. Never sends: no Enter, no submit.
   */
  async function insertIntoComposer(text) {
    const el = findEditor();
    if (!el || !text) return false;
    el.focus();

    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const start = el.selectionStart ?? el.value.length;
      el.setRangeText(text, start, el.selectionEnd ?? start, 'end');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: text }));
      return true;
    }

    // Caret at the end unless it's already inside the editor.
    const selection = getSelection();
    if (!selection.rangeCount || !el.contains(selection.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    const before = el.textContent.length;
    // 1) A synthetic paste: ProseMirror (claude.ai's editor) handles it and updates its state.
    let handled = false;
    try {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      const paste = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      el.dispatchEvent(paste);
      handled = paste.defaultPrevented;
    } catch (_) { handled = false; }
    // 2) Nobody took the paste: type it in as the browser would.
    if (!handled) {
      try { handled = document.execCommand('insertText', false, text); } catch (_) { handled = false; }
    }
    await new Promise(r => setTimeout(r, 60));
    // A very long paste may become an attachment card on claude.ai, so the text box needn't grow.
    return handled || el.textContent.length > before;
  }

  Mochi.pocket = { list, add, remove, markOffered, nextUnoffered, onChange, MAX };
  Mochi.findEditor = findEditor;
  Mochi.insertIntoComposer = insertIntoComposer;
})();
