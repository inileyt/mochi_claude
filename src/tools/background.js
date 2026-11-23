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
    // Give the permission back (a copy of Mochi that has it built in can't: then the script is simply gone).
    await chrome.permissions.remove(ALL).catch(() => false);
    await setRemind(false);
    return true;
  }
  async function setRemind(on) {
    try { await Mochi.settings.load(); if (Mochi.settings.get('notes.remind') !== on) await Mochi.settings.set('notes.remind', on); } catch (_) { /* the script state is what counts */ }
  }
  // Permission taken away in Chrome's settings: the script goes too.
  chrome.permissions.onRemoved.addListener(async p => {
    if ((p.origins || []).includes('<all_urls>') && (await registered())) {
      await chrome.scripting.unregisterContentScripts({ ids: [PEEK_ID] }).catch(() => {});
      await setRemind(false);
    }
  });

  // ——— Alt+F ———
  chrome.commands?.onCommand.addListener(async (command, tab) => {
    if (command !== 'font-inspector' || !tab?.id) return;
    try { await inTab(tab.id, () => globalThis.Mochi?.tools?.toggle('fonts')); } catch (_) { /* Chrome's own pages */ }
  });

  const ops = {
    openRemind: async () => {
      const url = chrome.runtime.getURL('pages/notes-remind.html');
      await chrome.windows.create({ url, type: 'popup', width: 520, height: 600 }).catch(() => chrome.tabs.create({ url }));
      return true;
    },
    remindStatus: async () => ({ permission: await chrome.permissions.contains(ALL), registered: await registered() }),
    remindOn: async () => remindOn(),
    remindOff: async () => remindOff(),
    // From the peek: bring Mochi in and open the notes.
    peekOpen: async (msg, sender) => { await inTab(sender.tab.id, () => globalThis.Mochi?.tools?.open('notes')); return true; },
  };

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg || msg.type !== 'mochi-tools') return false;
    const run = ops[msg.op];
    // Turning reminders on or off only from Mochi's own page; the rest from tabs.
    const own = sender.url?.startsWith(chrome.runtime.getURL(''));
    if (!run || ((msg.op === 'remindOn' || msg.op === 'remindOff') && !own) || (msg.op === 'peekOpen' && !sender.tab)) { reply({ ok: false, error: 'not-allowed' }); return false; }
    run(msg, sender).then(result => reply({ ok: true, result }), err => reply({ ok: false, error: String(err?.message || err) }));
    return true;
  });

  Mochi.toolsBg = { remindOn, remindOff, registered, ops, PEEK_ID };
})();
