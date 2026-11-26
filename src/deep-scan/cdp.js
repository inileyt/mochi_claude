/*
 * Mochi — Deep Scan's DevTools client in the page (talks to src/debugger-proxy.js).
 *   await Mochi.cdp.attach(); await Mochi.cdp.send('CSS.enable'); Mochi.cdp.on('Animation.animationStarted', fn); await Mochi.cdp.detach();
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const listeners = new Map();
  let attached = false;

  const call = (op, extra = {}) => new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ type: 'mochi-cdp', op, ...extra }, res => {
        const err = chrome.runtime.lastError;
        if (err) return reject(new Error(err.message));
        if (!res?.ok) return reject(new Error(res?.error || 'failed'));
        resolve(res.result);
      });
    } catch (err) { reject(err); }
  });

  try {
    chrome.runtime.onMessage.addListener(msg => {
      if (msg?.type !== 'mochi-cdp-event') return;
      if (msg.method === 'Mochi.detached') attached = false;
      for (const fn of listeners.get(msg.method) || []) { try { fn(msg.params || {}); } catch (_) { /* a listener failing never stops the scan */ } }
    });
  } catch (_) { /* not in an extension (test page) */ }

  Mochi.cdp = {
    status: () => call('status'),
    restart: () => call('restart'),
    async attach(mode) { const r = await call('attach', mode ? { mode } : {}); attached = true; return r; },
    events: () => call('events'),
    /** Detach whatever this tab has, even if this page didn't attach it (a bug recording that went on across a page load). */
    async detachAny(reason) { attached = false; return call('detach', { reason }); },
    async detach(reason) { if (!attached) return { detached: false }; attached = false; return call('detach', { reason }); },
    send: (method, params) => call('send', { method, params }),
    blocked: () => call('blocked'),
    on(method, fn) { if (!listeners.has(method)) listeners.set(method, new Set()); listeners.get(method).add(fn); return () => listeners.get(method).delete(fn); },
    get attached() { return attached; },
  };
})();

// Test hook (local test pages only, see content.js): attach, one allowed and one refused command, detach.
(() => {
  const Mochi = globalThis.Mochi;
  Mochi.debugHooks = Mochi.debugHooks || {};
  Mochi.debugHooks.cdpProbe = async ({ stayAttached = false } = {}) => {
    const out = { status: await Mochi.cdp.status() };
    out.attach = await Mochi.cdp.attach();
    out.doc = (await Mochi.cdp.send('DOM.getDocument', { depth: 0 })).root.nodeName;
    try { await Mochi.cdp.send('Runtime.evaluate', { expression: '1' }); out.refused = false; } catch (err) { out.refused = err.message; }
    // Pointer probing may move the cursor (mouseMoved) but never press it (no clicks).
    try { await Mochi.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 }); out.mouseMoved = true; } catch (err) { out.mouseMoved = err.message; }
    try { await Mochi.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1, y: 1, button: 'left', clickCount: 1 }); out.mousePressed = 'allowed'; } catch (err) { out.mousePressed = err.message; }
    if (!stayAttached) out.detach = await Mochi.cdp.detach('probe');
    return out;
  };
})();
