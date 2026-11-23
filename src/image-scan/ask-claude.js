/*
 * Mochi — Image Scan, option B: "Ask Claude about this image".
 *
 * Only when you click the button: the scanned image goes to the clipboard (PNG), Mochi keeps
 * it (one image, in this browser's extension storage) with a ready question in its pocket,
 * and opens or focuses claude.ai. There Mochi offers "Paste the image and question?" and puts
 * both in the message box (a paste, as if you pressed Ctrl+V). It never presses Enter: you
 * read it and send it yourself. If the image paste doesn't take, Mochi asks you to press Ctrl+V.
 *
 *   Mochi.imageScan.askClaude(result, ctx)
 *   Mochi.imageScan.pasteAsk(entry, ctx)     on claude.ai (from the offer or the pocket)
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const KEY = 'mochi.imageScan.pending';
  const T = (k, v) => Mochi.t(k, v);
  const api = (Mochi.imageScan = Mochi.imageScan || {});

  const store = {
    get: async () => { try { return (await chrome.storage.local.get(KEY))[KEY] || null; } catch (_) { return null; } },
    set: async v => { try { await chrome.storage.local.set({ [KEY]: v }); } catch (_) { /* full or unavailable: the clipboard still has it */ } },
    clear: async () => { try { await chrome.storage.local.remove(KEY); } catch (_) { /* fine */ } },
  };

  /** data: URL → Blob, without fetch (the page's rules never get in the way). */
  function blobOf(dataUrl) {
    const [head, body] = String(dataUrl).split(',');
    const type = /data:([^;]+)/.exec(head)?.[1] || 'image/png';
    const bin = atob(body || '');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  }

  async function askClaude(result, ctx) {
    const { companion, engine } = ctx;
    if (!result?.image) return false;
    const question = Mochi.imagePrompt.question(result, Mochi.lang?.() || 'en');
    // 1) The clipboard first, while the click still counts as "you asked".
    let copied = false;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobOf(result.image) })]);
      copied = true;
    } catch (_) { copied = false; }
    // 2) The image + question, for Mochi on claude.ai.
    const entry = Mochi.imageCard.entryFor(result, { ask: true, paste: question });
    await store.set({ id: entry.id, image: result.image, question, at: Date.now() });
    // On claude.ai already: straight into the box.
    if (ctx.isClaude) { ctx.panel.close(); return pasteAsk({ ...entry, id: entry.id }, ctx); }
    await Mochi.pocket.add(entry, { offered: false });
    companion.say(T('img.askCopied'), 2400);
    engine.react({ mood: 'excited', action: 'wave', hold: 2500 });
    // 3) To claude.ai (an open tab, or a new one).
    try { await Mochi.imageTarget.send({ op: 'openClaude' }); } catch (_) { window.open('https://claude.ai/new', '_blank', 'noopener'); }
    return copied;
  }

  /** Paste the picture (a synthetic paste with the file), then the question. Never Enter. */
  async function pasteAsk(entry, ctx) {
    const { companion, engine } = ctx;
    if (ctx.panel.isOpen) ctx.panel.close();
    const pending = await store.get();
    const editor = Mochi.findEditor?.();
    if (!editor) { companion.setMood('sad'); companion.say(T('img.askNoBox'), 3200); return false; }
    editor.focus();
    let imageOk = false;
    if (pending?.image && (!entry?.id || pending.id === entry.id)) {
      try {
        const file = new File([blobOf(pending.image)], 'image.png', { type: 'image/png' });
        const data = new DataTransfer();
        data.items.add(file);
        const ev = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
        editor.dispatchEvent(ev);
        imageOk = ev.defaultPrevented; // the site took the file
      } catch (_) { imageOk = false; }
    }
    await new Promise(r => setTimeout(r, 120));
    const textOk = await Mochi.insertIntoComposer(entry?.paste || pending?.question || '');
    if (imageOk) await store.clear();
    engine.react({ mood: textOk ? 'happy' : 'sad', action: textOk ? 'wave' : 'wiggle', hold: 4000 });
    companion.say(T(!textOk ? 'img.askNoBox' : imageOk ? 'img.askPasted' : 'img.askPasteFailed'), 4200);
    return textOk && imageOk;
  }

  api.askClaude = askClaude;
  api.pasteAsk = pasteAsk;
  api.blobOf = blobOf;
})();
