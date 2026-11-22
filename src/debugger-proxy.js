/*
 * Mochi — the Deep Scan's DevTools connection (background worker only).
 *
 * Deep Scan needs a few things a page can't do for itself (hover states,
 * cross-origin stylesheets, other screen widths, screenshots, catching
 * animations, stopping navigation). Chrome offers them through the DevTools
 * Protocol, behind the optional "debugger" permission. This file is the only
 * place that uses it:
 *   - only for the tab that asks (a content script's own tab), only during a scan;
 *   - only the commands in ALLOWED (no running code, no network reading, no cookies);
 *   - main-frame navigations are stopped while attached (a scan never leaves the page);
 *   - detached at the end, on cancel, on error, when the tab closes or navigates,
 *     and after MAX_MS at the latest.
 * While attached, Chrome shows its "Mochi started debugging this browser" bar.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const MAX_MS = 6 * 60 * 1000;
  const ALLOWED = new Set([
    'Page.enable', 'Page.disable', 'Page.captureScreenshot', 'Page.getLayoutMetrics',
    'DOM.enable', 'DOM.disable', 'DOM.getDocument', 'DOM.querySelector', 'DOM.querySelectorAll', 'DOM.describeNode', 'DOM.getBoxModel', 'DOM.pushNodesByBackendIdsToFrontend',
    'CSS.enable', 'CSS.disable', 'CSS.forcePseudoState', 'CSS.getMatchedStylesForNode', 'CSS.getComputedStyleForNode', 'CSS.getStyleSheetText',
    'Emulation.setDeviceMetricsOverride', 'Emulation.clearDeviceMetricsOverride',
    'DOMSnapshot.captureSnapshot',
    'Input.dispatchKeyEvent', // only the Escape key (checked below): closing what the scan opened
  ]);
  const FORWARD = new Set(['CSS.styleSheetAdded', 'Page.frameRequestedNavigation', 'Page.javascriptDialogOpening']);
  const sessions = new Map(); // tabId → { timer, blocked: [] }
  let listening = false;
  const counts = {}; // events seen, per method (for tests and debugging)

  const api = () => globalThis.chrome?.debugger;
  const send = (tabId, method, params = {}) => api().sendCommand({ tabId }, method, params);
  const tell = (tabId, msg) => chrome.tabs.sendMessage(tabId, msg).catch(() => {});

  function listen() {
    if (listening || !api()) return;
    listening = true;
    api().onEvent.addListener((source, method, params) => {
      const s = sessions.get(source.tabId);
      if (!s) return;
      counts[method] = (counts[method] || 0) + 1;
      if (method === 'Fetch.requestPaused') {
        // A document request in the main frame = leaving the page: stop it. Everything else goes on.
        const leave = params.resourceType === 'Document' && params.frameId === s.mainFrame;
        if (leave) {
          s.blocked.push(params.request?.url || '');
          send(source.tabId, 'Fetch.failRequest', { requestId: params.requestId, errorReason: 'Aborted' }).catch(() => {});
          tell(source.tabId, { type: 'mochi-cdp-event', method: 'Mochi.navigationBlocked', params: { url: params.request?.url } });
        } else send(source.tabId, 'Fetch.continueRequest', { requestId: params.requestId }).catch(() => {});
        return;
      }
      if (method === 'Page.javascriptDialogOpening') send(source.tabId, 'Page.handleJavaScriptDialog', { accept: false }).catch(() => {}); // never confirm anything
      if (FORWARD.has(method)) tell(source.tabId, { type: 'mochi-cdp-event', method, params });
    });
    api().onDetach.addListener((source, reason) => {
      if (!sessions.has(source.tabId)) return;
      clearTimeout(sessions.get(source.tabId).timer);
      sessions.delete(source.tabId);
      tell(source.tabId, { type: 'mochi-cdp-event', method: 'Mochi.detached', params: { reason } }); // e.g. the user pressed Cancel on Chrome's bar
    });
  }

  async function attach(tabId) {
    if (!(await chrome.permissions.contains({ permissions: ['debugger'] })) || !api()) throw new Error('no-permission');
    listen();
    if (sessions.has(tabId)) return { already: true };
    await api().attach({ tabId }, '1.3');
    const s = { blocked: [], timer: setTimeout(() => detach(tabId, 'time-limit'), MAX_MS) };
    sessions.set(tabId, s);
    try {
      await send(tabId, 'Page.enable');
      const { frameTree } = await send(tabId, 'Page.getFrameTree');
      s.mainFrame = frameTree.frame.id;
      await send(tabId, 'Fetch.enable', { patterns: [{ resourceType: 'Document', requestStage: 'Request' }] });
    } catch (err) { await detach(tabId, 'error'); throw err; }
    return { attached: true };
  }

  async function detach(tabId, reason = 'done') {
    const s = sessions.get(tabId);
    if (!s) return { detached: false };
    clearTimeout(s.timer);
    sessions.delete(tabId);
    try { await send(tabId, 'Emulation.clearDeviceMetricsOverride'); } catch (_) { /* not set */ }
    try { await api().detach({ tabId }); } catch (_) { /* already gone */ }
    tell(tabId, { type: 'mochi-cdp-event', method: 'Mochi.detached', params: { reason } });
    return { detached: true, blocked: s.blocked };
  }

  chrome.tabs.onRemoved.addListener(tabId => { if (sessions.has(tabId)) { clearTimeout(sessions.get(tabId).timer); sessions.delete(tabId); try { api()?.detach({ tabId }); } catch (_) { /* gone */ } } });
  chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.url && sessions.has(tabId)) detach(tabId, 'navigated'); });
  chrome.permissions.onAdded.addListener(listen);

  /** Messages from a content script: { type: 'mochi-cdp', op, method, params }. Only for the sender's own tab. */
  async function handle(msg, sender) {
    const tabId = sender.tab?.id;
    if (!tabId) throw new Error('no-tab');
    switch (msg.op) {
      case 'status': return { permission: await chrome.permissions.contains({ permissions: ['debugger'] }), attached: sessions.has(tabId) };
      case 'attach': return attach(tabId);
      case 'detach': return detach(tabId, msg.reason || 'done');
      case 'send':
        if (!sessions.has(tabId)) throw new Error('not-attached');
        if (!ALLOWED.has(msg.method)) throw new Error(`not-allowed: ${msg.method}`);
        if (msg.method === 'Input.dispatchKeyEvent' && msg.params?.key !== 'Escape') throw new Error('not-allowed: only the Escape key');
        return send(tabId, msg.method, msg.params || {});
      case 'blocked': return sessions.get(tabId)?.blocked || [];
      case 'askPermission': {
        // Content scripts can't ask Chrome for a permission: a small Mochi window does.
        const url = chrome.runtime.getURL(`pages/deep-permission.html?tab=${tabId}`);
        await chrome.windows.create({ url, type: 'popup', width: 460, height: 560, focused: true });
        return true;
      }
      default: throw new Error('unknown-op');
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg || msg.type !== 'mochi-cdp') return false;
    handle(msg, sender).then(result => reply({ ok: true, result }), err => reply({ ok: false, error: String(err?.message || err) }));
    return true;
  });

  Mochi.debuggerProxy = { attach, detach, sessions, ALLOWED, counts };
})();
