/*
 * Mochi — the toolbar button.
 *
 * Clicking Mochi's icon shows or hides Mochi on the page you're on.
 * On a page where Mochi isn't there yet, it brings Mochi in. That uses
 * Chrome's "activeTab" permission: the extension may touch a page only
 * after you clicked its icon on that page, and only that tab. On claude.ai
 * Mochi is already there, so the click just hides it or brings it back.
 */
const FILES = [
  'src/config.js',
  'src/store.js',
  'src/i18n.js',
  'src/locales/en.js',
  'src/locales/de.js',
  'src/locales/es.js',
  'src/locales/fr.js',
  'src/locales/hy.js',
  'src/locales/it.js',
  'src/locales/ja.js',
  'src/locales/pt.js',
  'src/locales/ru.js',
  'src/locales/uk.js',
  'src/locales/zh.js',
  'src/sentiment.js',
  'src/art.js',
  'src/styles.js',
  'src/companion.js',
  'src/mood-engine.js',
  'src/chat-watcher.js',
  'src/vibes.js',
  'src/ui-scan.js',
  'src/scan-export.js',
  'src/panel.js',
  'src/menu.js',
  'src/outfits.js',
  'src/outfit-editor.js',
  'src/progress.js',
  'src/characters/mochi.js',
  'src/characters/cat.js',
  'src/characters/robot.js',
  'src/characters/ghost.js',
  'src/friends.js',
  'src/colors.js',
  'src/sound.js',
  'src/prompt-coach.js',
  'src/long-chat.js',
  'src/notify.js',
  'src/minigame.js',
  'src/library.js',
  'src/bookmarks.js',
  'src/chat-export.js',
  'src/focus.js',
  'src/explore.js',
  'src/easter-eggs.js',
  'src/online.js',
  'src/picker.js',
  'src/pocket.js',
  'src/content.js',
];

async function toggleIn(tab) {
  if (!tab?.id) return 'no-tab';
  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (globalThis.Mochi?.toggle ? globalThis.Mochi.toggle() : 'absent'),
    });
    if (first?.result !== 'absent') return first?.result;
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: FILES });
    return 'added';
  } catch (_) {
    // Chrome keeps extensions out of its own pages (chrome://…, the Web Store, the new-tab page).
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#b45d27' });
    await chrome.action.setBadgeText({ tabId: tab.id, text: '×' });
    await chrome.action.setTitle({ tabId: tab.id, title: 'Mochi can’t visit this page (Chrome blocks extensions on its own pages)' });
    setTimeout(() => {
      chrome.action.setBadgeText({ tabId: tab.id, text: '' }).catch(() => {});
      chrome.action.setTitle({ tabId: tab.id, title: 'Show or hide Mochi on this page' }).catch(() => {});
    }, 3000);
    return 'blocked';
  }
}

chrome.action.onClicked.addListener(tab => { toggleIn(tab); });

// ——— online friends (off unless the user turns them on in Mochi's settings) ———
// The page never talks to the network: it asks here, and only these operations.
importScripts('online-config.js', 'online-api.js');
const ONLINE_METHODS = new Set(['saveProfile', 'request', 'accept', 'decline', 'cancel', 'snapshot', 'messages', 'send', 'checkIn', 'unfriend', 'block', 'deleteEverything']);
const onlineStorage = {
  get: async key => (await chrome.storage.local.get(key))[key],
  set: async (key, value) => chrome.storage.local.set({ [key]: value }),
};
let online = null;
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== 'mochi-online') return false;
  if (msg.method === 'status') { reply({ ok: true, result: { configured: !!(Mochi.onlineConfig.apiKey && Mochi.onlineConfig.projectId) } }); return false; }
  if (!ONLINE_METHODS.has(msg.method)) { reply({ ok: false, error: { code: 'unknown-method' } }); return false; }
  online = online || new Mochi.OnlineApi(Mochi.onlineConfig, onlineStorage);
  Promise.resolve()
    .then(() => online[msg.method](...(Array.isArray(msg.args) ? msg.args : [])))
    .then(result => reply({ ok: true, result }), err => reply({ ok: false, error: { status: err.status || 0, code: err.code || String(err.message || err) } }));
  return true; // answering later
});

// For the local test script only.
globalThis.toggleIn = toggleIn;
