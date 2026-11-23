/*
 * Mochi — the Deep Scan's DevTools connection (background worker only).
 *
 * Deep Scan needs a few things a page can't do for itself (hover states,
 * cross-origin stylesheets, other screen widths, screenshots, catching
 * animations, stopping navigation). Chrome offers them through the DevTools
 * Protocol, behind the "debugger" permission (Chrome doesn't allow it to be optional). This file is the only
 * place that uses it:
 *   - only for the tab that asks (a content script's own tab), only during a scan;
 *   - only the commands in ALLOWED (no running code, no network reading, no cookies);
 *   - main-frame navigations are stopped while attached (a scan never leaves the page);
 *   - detached at the end, on cancel, on error, when the tab closes or navigates,
 *     and after MAX_MS at the latest.
 * While attached, Chrome shows its "Mochi started debugging this browser" bar.
 *
 * Bug Reporter uses a second mode, 'report' (attach({ mode: 'report' })): you move around as usual (no
 * navigation is stopped, dialogs are left alone, it stays attached across page loads in that tab), and
 * Mochi notes only what goes wrong: uncaught errors, console errors/warnings, and requests that failed
 * (address, method, status; never bodies, headers or cookies). Kept here, at most 200, until you stop.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const MAX_MS = 6 * 60 * 1000;
  const REPORT_MS = 15 * 60 * 1000; // a bug recording: 15 minutes at most
  const ALLOWED = new Set([
    'Page.enable', 'Page.disable', 'Page.captureScreenshot', 'Page.getLayoutMetrics',
    'DOM.enable', 'DOM.disable', 'DOM.getDocument', 'DOM.querySelector', 'DOM.querySelectorAll', 'DOM.describeNode', 'DOM.getBoxModel', 'DOM.pushNodesByBackendIdsToFrontend',
    'CSS.enable', 'CSS.disable', 'CSS.forcePseudoState', 'CSS.getMatchedStylesForNode', 'CSS.getComputedStyleForNode', 'CSS.getStyleSheetText',
    'Emulation.setDeviceMetricsOverride', 'Emulation.clearDeviceMetricsOverride',
    'DOMSnapshot.captureSnapshot',
    'Input.dispatchKeyEvent', // only the Escape key (checked below): closing what the scan opened
  ]);
  // Report mode: reading what goes wrong (and taking screenshots). Nothing that changes the page.
  const REPORT_ALLOWED = new Set(['Page.enable', 'Page.captureScreenshot', 'Page.getLayoutMetrics', 'Runtime.enable', 'Log.enable', 'Network.enable']);
  const REPORT_MAX = 200;
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
      if (s.mode === 'report') { report(source.tabId, s, method, params); return; }
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

  /** Report mode: keep only what went wrong, short. */
  const clip = (t, n = 400) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const noQuery = u => { try { const x = new URL(u); return `${x.origin}${x.pathname}${x.search ? '?…' : ''}`; } catch (_) { return clip(u, 200); } };
  function report(tabId, s, method, p) {
    let item = null;
    if (method === 'Network.requestWillBeSent') {
      s.requests.set(p.requestId, { url: p.request?.url, method: p.request?.method, type: p.type });
      if (s.requests.size > 600) s.requests.delete(s.requests.keys().next().value);
      return;
    }
    if (method === 'Network.responseReceived' && p.response?.status >= 400) item = { kind: 'http', status: p.response.status, url: noQuery(p.response.url), method: s.requests.get(p.requestId)?.method || 'GET', type: p.type };
    else if (method === 'Network.loadingFailed' && !p.canceled) { const r = s.requests.get(p.requestId) || {}; item = { kind: 'failed', error: clip(p.errorText, 120), url: noQuery(r.url), method: r.method || 'GET', type: p.type }; }
    else if (method === 'Runtime.exceptionThrown') { const d = p.exceptionDetails || {}; item = { kind: 'exception', text: clip(d.exception?.description || d.text, 800), url: noQuery(d.url || ''), line: d.lineNumber != null ? d.lineNumber + 1 : null }; }
    else if (method === 'Runtime.consoleAPICalled' && /^(error|assert|warning)$/.test(p.type)) item = { kind: 'console', level: p.type === 'warning' ? 'warning' : 'error', text: clip((p.args || []).map(a => a.value ?? a.description ?? a.type).join(' ')) };
    else if (method === 'Log.entryAdded' && /^(error|warning)$/.test(p.entry?.level) && p.entry?.source !== 'network') item = { kind: 'log', level: p.entry.level, text: clip(p.entry.text), url: noQuery(p.entry.url || '') };
    if (!item) return;
    item.at = Date.now();
    if (s.events.length < REPORT_MAX) s.events.push(item);
    tell(tabId, { type: 'mochi-cdp-event', method: 'Mochi.report', params: item });
  }

  async function attach(tabId, { mode = 'scan' } = {}) {
    if (!(await chrome.permissions.contains({ permissions: ['debugger'] }))) throw new Error('no-permission');
    // Granted while Mochi was running, but this Chrome hasn't given the background worker the API yet: one restart fixes it.
    if (!api()) throw new Error('restart-needed');
    listen();
    if (sessions.has(tabId)) return { already: true };
    try { await api().attach({ tabId }, '1.3'); } catch (err) {
      const m = String(err?.message || err);
      if (/already attached/i.test(m)) throw new Error('already-attached'); // DevTools or another extension is on this tab
      if (/cannot (access|attach)|chrome:\/\/|chrome-extension:|webstore|not allowed/i.test(m)) throw new Error('page-not-allowed');
      throw err;
    }
    const s = { mode, blocked: [], events: [], requests: new Map(), timer: setTimeout(() => detach(tabId, 'time-limit'), mode === 'report' ? REPORT_MS : MAX_MS) };
    sessions.set(tabId, s);
    if (mode === 'report') {
      try { for (const m of ['Page.enable', 'Runtime.enable', 'Log.enable', 'Network.enable']) await send(tabId, m); } catch (err) { await detach(tabId, 'error'); throw err; }
      return { attached: true, mode };
    }
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
    return { detached: true, blocked: s.blocked, events: s.events };
  }

  chrome.tabs.onRemoved.addListener(tabId => { if (sessions.has(tabId)) { clearTimeout(sessions.get(tabId).timer); sessions.delete(tabId); try { api()?.detach({ tabId }); } catch (_) { /* gone */ } } });
  // A scan never leaves its page; a bug recording follows you from page to page.
  chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.url && sessions.has(tabId) && sessions.get(tabId).mode !== 'report') detach(tabId, 'navigated'); });
  chrome.permissions.onAdded.addListener(listen);

  /** Messages from a content script: { type: 'mochi-cdp', op, method, params }. Only for the sender's own tab. */
  async function handle(msg, sender) {
    const tabId = sender.tab?.id;
    if (!tabId) throw new Error('no-tab');
    switch (msg.op) {
      case 'status': return { permission: await chrome.permissions.contains({ permissions: ['debugger'] }), api: !!api(), attached: sessions.has(tabId) };
      case 'restart': setTimeout(() => chrome.runtime.reload(), 300); return true; // only from the Deep scan panel's "Restart Mochi" button
      case 'attach': return attach(tabId, { mode: msg.mode === 'report' ? 'report' : 'scan' });
      case 'detach': return detach(tabId, msg.reason || 'done');
      case 'send':
        if (!sessions.has(tabId)) throw new Error('not-attached');
        if (!(sessions.get(tabId).mode === 'report' ? REPORT_ALLOWED : ALLOWED).has(msg.method)) throw new Error(`not-allowed: ${msg.method}`);
        if (msg.method === 'Input.dispatchKeyEvent' && msg.params?.key !== 'Escape') throw new Error('not-allowed: only the Escape key');
        return send(tabId, msg.method, msg.params || {});
      case 'blocked': return sessions.get(tabId)?.blocked || [];
      case 'events': return sessions.get(tabId)?.events || [];
      default: throw new Error('unknown-op');
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg || msg.type !== 'mochi-cdp') return false;
    handle(msg, sender).then(result => reply({ ok: true, result }), err => reply({ ok: false, error: String(err?.message || err) }));
    return true;
  });

  Mochi.debuggerProxy = { attach, detach, sessions, ALLOWED, REPORT_ALLOWED, counts };
})();
