/*
 * Mochi — turning ChatGPT and Gemini on and off (background worker only).
 *
 * Mochi lives on claude.ai out of the box. ChatGPT and Gemini are optional:
 * Chrome asks you first ("optional_host_permissions" in manifest.json). The
 * question itself has to come from a click on one of Mochi's own pages
 * (options.html, welcome.html). When you say yes, this registers Mochi's
 * content scripts for that site (chrome.scripting.registerContentScripts) and
 * adds Mochi to the tabs you already have open there. Turning a site off
 * unregisters the scripts and gives the permission back to Chrome.
 *
 * The registration is redone when the browser starts and after an update (so
 * a new version's file list is used), and follows the permission if you
 * remove it elsewhere (chrome://extensions → Details → Site access).
 *
 * Registered scripts start with src/sites/enabled.js: only then does Mochi
 * read the chat on those sites. Mochi brought in by the toolbar button there,
 * without the site turned on, stays a plain companion.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  const SITES = {
    chatgpt: { name: 'ChatGPT', origins: ['https://chatgpt.com/*'] },
    gemini: { name: 'Gemini', origins: ['https://gemini.google.com/*'] },
  };
  const MARKER = 'src/sites/enabled.js';
  const scriptId = id => `mochi-site-${id}`;

  let files = [];
  let queue = Promise.resolve();
  /** One change at a time (a permission event and a page's message can arrive together). */
  const serial = fn => (queue = queue.then(fn, fn));

  const granted = id => chrome.permissions.contains({ origins: SITES[id].origins });
  const registered = async id => (await chrome.scripting.getRegisteredContentScripts({ ids: [scriptId(id)] })).length > 0;

  async function status() {
    const out = {};
    for (const id of Object.keys(SITES)) out[id] = { name: SITES[id].name, granted: await granted(id), registered: await registered(id) };
    return out;
  }

  /** Mochi in the tabs already open on this site (a fresh registration only covers pages loaded later). */
  async function injectOpenTabs(id) {
    let tabs = [];
    try { tabs = await chrome.tabs.query({ url: SITES[id].origins }); } catch (_) { return 0; }
    let n = 0;
    for (const tab of tabs) {
      try {
        const [first] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => !!globalThis.Mochi?.toggle });
        if (first?.result) continue; // already there
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [MARKER, ...files] });
        n++;
      } catch (_) { /* a tab that is loading or closed */ }
    }
    return n;
  }

  /**
   * Make the registrations match the permissions.
   * fresh: register again even if already registered (browser start, update).
   * inject: also add Mochi to open tabs of newly turned-on sites.
   */
  const sync = ({ fresh = false, inject = false } = {}) => serial(async () => {
    const changed = [];
    for (const id of Object.keys(SITES)) {
      const has = await granted(id);
      const reg = await registered(id);
      if (reg && (!has || fresh)) await chrome.scripting.unregisterContentScripts({ ids: [scriptId(id)] });
      if (has && (!reg || fresh)) {
        await chrome.scripting.registerContentScripts([{
          id: scriptId(id), matches: SITES[id].origins, js: [MARKER, ...files], runAt: 'document_idle', allFrames: false, persistAcrossSessions: true,
        }]);
        if (!reg) changed.push(id);
        if (!reg && inject) await injectOpenTabs(id);
      }
      if (reg && !has) changed.push(id);
    }
    return changed;
  });

  /** Turn a site off: forget the scripts and hand the permission back. */
  async function disable(id) {
    if (!SITES[id]) throw new Error('unknown-site');
    await chrome.permissions.remove({ origins: SITES[id].origins });
    await sync();
    return status();
  }

  function install(fileList) {
    files = fileList.slice();
    chrome.runtime.onStartup.addListener(() => { sync({ fresh: true }); });
    chrome.runtime.onInstalled.addListener(() => { sync({ fresh: true }); });
    chrome.permissions.onAdded.addListener(() => { sync({ inject: true }); });
    chrome.permissions.onRemoved.addListener(() => { sync(); });
  }

  Mochi.siteAccess = { SITES, MARKER, scriptId, status, sync, disable, install, injectOpenTabs };
})();
