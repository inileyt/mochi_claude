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

// For the local test script only.
globalThis.toggleIn = toggleIn;
