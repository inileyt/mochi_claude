/*
 * Mochi — the tools, background part (loaded by src/background.js).
 *  · Alt+F (manifest "commands"): turns the font inspector on or off in the current tab
 *    (a keyboard shortcut gives the same one-tab access as the toolbar button).
 *  · Note reminders on revisit (opt-in): after you allow it on pages/notes-remind.html, a tiny
 *    script (src/tools/note-url.js + notes-peek.js) is registered for all sites; it only checks
 *    whether the page has notes. Turning it off unregisters it and gives the permission back.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const PEEK_ID = 'mochi-notes-peek';
  const ALL = { origins: ['<all_urls>'] };

  /** Mochi on the tab (brought in if needed), then fn(tool) run there. */
  async function inTab(tabId, func, args = []) {
    const [first] = await chrome.scripting.executeScript({ target: { tabId }, func: () => (globalThis.Mochi?.tools ? 'present' : 'absent') });
    if (first?.result === 'absent') await chrome.scripting.executeScript({ target: { tabId }, files: Mochi.toolsFiles });
    return chrome.scripting.executeScript({ target: { tabId }, args, func });
  }

  // ——— reminders on revisit ———
  async function registered() {
    try { return (await chrome.scripting.getRegisteredContentScripts({ ids: [PEEK_ID] })).length > 0; } catch (_) { return false; }
  }
  async function remindOn() {
    if (!(await chrome.permissions.contains(ALL))) return false;
    if (!(await registered())) {
      await chrome.scripting.registerContentScripts([{
        id: PEEK_ID, matches: ['<all_urls>'], excludeMatches: ['https://claude.ai/*'],
        js: ['src/tools/note-url.js', 'src/tools/notes-peek.js'], runAt: 'document_idle', allFrames: false, persistAcrossSessions: true,
      }]);
    }
    await setRemind(true);
    return true;
  }
  async function remindOff() {
    if (await registered()) await chrome.scripting.unregisterContentScripts({ ids: [PEEK_ID] }).catch(() => {});
    // Give the permission back unless kept Live Edits still use it (a copy of Mochi that has it built in can't: then the script is simply gone).
    if (!(await liveRegistered())) await chrome.permissions.remove(ALL).catch(() => false);
    await setRemind(false);
    return true;
  }
  async function setRemind(on) {
    try { await Mochi.settings.load(); if (Mochi.settings.get('notes.remind') !== on) await Mochi.settings.set('notes.remind', on); } catch (_) { /* the script state is what counts */ }
  }
  // Permission taken away in Chrome's settings: the script goes too.
  async function onPermRemoved(p) {
    if ((p.origins || []).includes('<all_urls>') && (await registered())) {
      await chrome.scripting.unregisterContentScripts({ ids: [PEEK_ID] }).catch(() => {});
      await setRemind(false);
    }
  }
  chrome.permissions.onRemoved.addListener(onPermRemoved);

  // After a browser start: the script stays only while the permission does.
  chrome.runtime.onStartup?.addListener(async () => {
    if ((await registered()) && !(await chrome.permissions.contains(ALL))) await chrome.scripting.unregisterContentScripts({ ids: [PEEK_ID] }).catch(() => {});
  });

  // ——— Alt+F ———
  async function onCommand(command, tab) {
    if (command !== 'font-inspector' || !tab?.id) return;
    try { await inTab(tab.id, async () => { for (let i = 0; i < 80 && !globalThis.Mochi?.tools?.ready; i++) await new Promise(r => setTimeout(r, 100)); return globalThis.Mochi?.tools?.toggle('fonts'); }); } catch (_) { /* Chrome's own pages */ }
  }
  chrome.commands?.onCommand.addListener(onCommand);

  // ——— Live Edit ———
  const APPLY_ID = 'mochi-live-apply';
  async function liveRegistered() { try { return (await chrome.scripting.getRegisteredContentScripts({ ids: [APPLY_ID] })).length > 0; } catch (_) { return false; } }
  /** Kept edits on every visit: a tiny document_start script, only with the permission and while there are kept edits. */
  async function liveEditSync() {
    const permission = await chrome.permissions.contains(ALL);
    const kept = (await chrome.storage.local.get('liveEdit.kept'))['liveEdit.kept'] || [];
    const want = permission && kept.some(k => k.on !== false);
    const has = await liveRegistered();
    if (want && !has) await chrome.scripting.registerContentScripts([{ id: APPLY_ID, matches: ['<all_urls>'], js: ['src/tools/note-url.js', 'src/tools/live-apply.js'], runAt: 'document_start', allFrames: false, persistAcrossSessions: true }]).catch(() => {});
    if (!want && has) await chrome.scripting.unregisterContentScripts({ ids: [APPLY_ID] }).catch(() => {});
    return { permission, registered: want };
  }
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes['liveEdit.kept']) liveEditSync(); });
  chrome.permissions.onAdded.addListener(() => liveEditSync());
  chrome.permissions.onRemoved.addListener(() => liveEditSync());

  // ——— Guides: a guide (or a recording) belongs to a tab; with the permission Mochi rejoins it after a page load ———
  const getLocal = async k => (await chrome.storage.local.get(k))[k];
  chrome.tabs.onUpdated.addListener(async (tabId, info) => {
    if (info.status !== 'complete') return;
    const [g, r] = [await getLocal('guides.active'), await getLocal('guides.recording')];
    if (!((g && g.tabId === tabId) || (r && r.tabId === tabId))) return;
    if (!(await chrome.permissions.contains(ALL))) return; // without it, a click on Mochi's icon brings him (and the guide) back
    try {
      const [first] = await chrome.scripting.executeScript({ target: { tabId }, func: () => (globalThis.Mochi?.tools ? 'present' : 'absent') });
      if (first?.result === 'absent') await chrome.scripting.executeScript({ target: { tabId }, files: Mochi.toolsFiles });
    } catch (_) { /* Chrome's own pages */ }
  });
  chrome.tabs.onRemoved.addListener(async tabId => {
    const g = await getLocal('guides.active');
    if (g && g.tabId === tabId) await chrome.storage.local.set({ 'guides.active': null });
  });

  const ops = {
    guideStart: async (msg, sender) => {
      let tabId = sender.tab.id;
      if (!msg.here && msg.guide.startUrl && /^https?:/.test(msg.guide.startUrl)) tabId = (await chrome.tabs.create({ url: msg.guide.startUrl })).id;
      await chrome.storage.local.set({ 'guides.active': { ...msg.guide, current: 0, tabId, at: Date.now() } });
      return { tabId, permission: await chrome.permissions.contains(ALL) };
    },
    guideHere: async (msg, sender) => {
      const [g, r] = [await getLocal('guides.active'), await getLocal('guides.recording')];
      return (g && g.tabId === sender.tab.id) || (r && r.tabId === sender.tab.id) ? true : null;
    },
    guideRecordHere: async (msg, sender) => { const r = await getLocal('guides.recording'); if (r) await chrome.storage.local.set({ 'guides.recording': { ...r, tabId: sender.tab.id } }); return true; },
    guideRecordStop: async () => true,
    liveEditAsk: async (msg, sender) => { await chrome.storage.local.set({ 'liveEdit.pending': { ...msg.session, tabId: sender.tab.id, windowId: sender.tab.windowId } }); return true; },
    liveEditReturn: async msg => {
      const p = (await chrome.storage.local.get('liveEdit.pending'))['liveEdit.pending'];
      if (!p?.tabId || p.id !== msg.id) return false;
      await chrome.tabs.update(p.tabId, { active: true }).catch(() => {});
      await chrome.windows.update(p.windowId, { focused: true }).catch(() => {});
      return true;
    },
    liveEditSync: async () => liveEditSync(),
    openClaudeTab: async () => {
      let tabs = [];
      try { tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' }); } catch (_) { tabs = []; }
      const tab = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
      if (tab) { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {}); return 'focused'; }
      await chrome.tabs.create({ url: 'https://claude.ai/new' });
      return 'opened';
    },
    openEverywhere: async msg => {
      const url = chrome.runtime.getURL(`pages/everywhere.html${msg.why ? `?why=${encodeURIComponent(msg.why)}` : ''}`);
      await chrome.windows.create({ url, type: 'popup', width: 540, height: 640 }).catch(() => chrome.tabs.create({ url }));
      return true;
    },
    everywhereStatus: async () => ({ permission: await chrome.permissions.contains(ALL), edits: await liveRegistered(), reminders: await registered() }),
    everywhereOff: async () => {
      if (await liveRegistered()) await chrome.scripting.unregisterContentScripts({ ids: [APPLY_ID] }).catch(() => {});
      if (await registered()) await chrome.scripting.unregisterContentScripts({ ids: [PEEK_ID] }).catch(() => {});
      await chrome.permissions.remove(ALL).catch(() => false);
      await setRemind(false);
      return true;
    },
    openRemind: async () => {
      const url = chrome.runtime.getURL('pages/notes-remind.html');
      await chrome.windows.create({ url, type: 'popup', width: 520, height: 600 }).catch(() => chrome.tabs.create({ url }));
      return true;
    },
    remindStatus: async () => ({ permission: await chrome.permissions.contains(ALL), registered: await registered() }),
    remindOn: async () => remindOn(),
    remindOff: async () => remindOff(),
    // From the peek: bring Mochi in and open the notes.
    peekOpen: async (msg, sender) => {
      // (Mochi starts a moment after it is injected: wait for it.)
      await inTab(sender.tab.id, async () => { for (let i = 0; i < 80 && !globalThis.Mochi?.tools?.ready; i++) await new Promise(r => setTimeout(r, 100)); return globalThis.Mochi?.tools?.open('notes'); });
      return true;
    },
  };

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg || msg.type !== 'mochi-tools') return false;
    const run = ops[msg.op];
    // Turning reminders on or off only from Mochi's own page; the rest from tabs.
    const own = sender.url?.startsWith(chrome.runtime.getURL(''));
    if (!run || ((msg.op === 'remindOn' || msg.op === 'remindOff' || msg.op === 'everywhereOff') && !own) || (['peekOpen', 'liveEditAsk', 'guideStart', 'guideHere', 'guideRecordHere'].includes(msg.op) && !sender.tab)) { reply({ ok: false, error: 'not-allowed' }); return false; }
    run(msg, sender).then(result => reply({ ok: true, result }), err => reply({ ok: false, error: String(err?.message || err) }));
    return true;
  });

  Mochi.toolsBg = { onCommand, onPermRemoved, liveEditSync, liveRegistered, remindOn, remindOff, registered, ops, PEEK_ID };
})();
