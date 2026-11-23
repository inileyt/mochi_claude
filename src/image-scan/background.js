/*
 * Mochi — Image Scan, the background part (loaded by src/background.js).
 *
 *  · The right-click menu item "Scan image with Mochi" (images only). Clicking it
 *    grants "activeTab" for that tab, so Mochi may come in and take screenshots.
 *  · Screenshots: the page asks for one tile at a time (it scrolls and hides Mochi
 *    first); chrome.tabs.captureVisibleTab allows 2 per second, so tiles wait their turn.
 *    The tiles stay here until the page asks for the analysis.
 *  · The work (crop + stitch, palette, OCR, fonts, on-device AI) runs in an offscreen
 *    document (pages/image-scan.html), never in the page. Its progress is passed on to the tab.
 *
 * Messages from the page: { type: 'mochi-image', op, … } (ops below).
 * To the offscreen document: { target: 'mochi-offscreen', op, … }.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const MENU_ID = 'mochi-image-scan';
  const TITLES = {
    en: 'Scan image with Mochi', ru: 'Сканировать картинку с Mochi', uk: 'Сканувати зображення з Mochi',
    hy: 'Սկանավորել նկարը Mochi-ով', de: 'Bild mit Mochi scannen', es: 'Escanear imagen con Mochi',
    fr: 'Scanner l’image avec Mochi', it: 'Scansiona immagine con Mochi', pt: 'Escanear imagem com o Mochi',
    ja: 'Mochiで画像をスキャン', zh: '用 Mochi 扫描图片',
  };
  const OFFSCREEN = 'pages/image-scan.html';
  const MIN_GAP = 560; // ms between captureVisibleTab calls (Chrome: at most 2 per second)
  const jobs = new Map(); // job id → { tabId, windowId, tiles: [] }
  let lastCapture = 0;
  let offscreenReady = null;
  const aiAskers = new Set(); // tabs waiting for the on-device model

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function menuTitle() {
    let lang = '';
    try { lang = ((await chrome.storage.local.get('mochi.settings'))['mochi.settings'] || {}).lang || ''; } catch (_) { /* default */ }
    if (!lang || lang === 'auto') lang = (navigator.language || 'en').slice(0, 2);
    return TITLES[lang] || TITLES.en;
  }
  async function installMenu() {
    try {
      await chrome.contextMenus.removeAll();
      chrome.contextMenus.create({ id: MENU_ID, title: await menuTitle(), contexts: ['image'] });
    } catch (_) { /* no contextMenus (old manifest in a test copy) */ }
  }
  chrome.runtime.onInstalled.addListener(installMenu);
  chrome.runtime.onStartup?.addListener(installMenu);
  // The language setting may change: keep the menu title in step.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['mochi.settings'] && (changes['mochi.settings'].oldValue?.lang !== changes['mochi.settings'].newValue?.lang)) {
      menuTitle().then(title => chrome.contextMenus.update(MENU_ID, { title })).catch(() => {});
    }
  });

  /** Mochi on the page and visible (brought in if needed, as the toolbar button does). */
  async function ensureMochi(tab) {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const M = globalThis.Mochi;
        if (!M?.toggle) return 'absent';
        if (document.querySelector('mochi-companion')?.getAttribute('data-hidden') === 'true') M.toggle();
        return 'present';
      },
    });
    if (first?.result === 'absent') await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: Mochi.imageScanFiles });
  }

  /** Where the right-clicked image sits when it is inside a frame: its frame's offset in the top page. */
  async function frameInfo(tab, info) {
    if (!info.frameId) return null;
    try {
      const [inFrame] = await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [info.frameId] },
        args: [info.srcUrl],
        func: src => {
          const img = [...document.images].find(i => i.currentSrc === src || i.src === src);
          if (!img) return null;
          img.scrollIntoView({ block: 'center', inline: 'center' });
          const r = img.getBoundingClientRect();
          return { left: r.left, top: r.top, width: r.width, height: r.height, natural: { w: img.naturalWidth, h: img.naturalHeight } };
        },
      });
      return inFrame?.result ? { ...inFrame.result, frameUrl: info.frameUrl } : null;
    } catch (_) { return null; }
  }

  async function menuClicked(info, tab) {
    if (info.menuItemId !== MENU_ID || !tab?.id) return;
    try {
      await ensureMochi(tab);
      const frame = await frameInfo(tab, info);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [{ srcUrl: info.srcUrl || '', frame }],
        func: async req => {
          // Mochi starts a moment after it is injected.
          for (let i = 0; i < 60 && !globalThis.Mochi?.imageScan?.ready; i++) await new Promise(r => setTimeout(r, 100));
          globalThis.Mochi?.imageScan?.fromMenu(req);
        },
      });
    } catch (_) {
      // Chrome's own pages: nothing to do (the menu shouldn't show there anyway).
    }
  }
  chrome.contextMenus?.onClicked.addListener(menuClicked);

  // ——— the offscreen document ———
  async function hasOffscreen() {
    try { return (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0; } catch (_) { return false; }
  }
  async function ensureOffscreen() {
    if (await hasOffscreen()) return;
    if (!offscreenReady) {
      offscreenReady = chrome.offscreen.createDocument({
        url: OFFSCREEN,
        reasons: ['WORKERS', 'BLOBS'],
        justification: 'Image Scan reads the colors and the text of an image in a worker, so the page never freezes.',
      }).catch(err => { if (!/single offscreen|already/i.test(String(err?.message))) throw err; }).finally(() => { offscreenReady = null; });
    }
    await offscreenReady;
  }
  const toOffscreen = async (op, data = {}) => {
    await ensureOffscreen();
    let res;
    // Right after it was created the page may still be loading its scripts: try again for a moment.
    for (let i = 0; ; i++) {
      try { res = await chrome.runtime.sendMessage({ target: 'mochi-offscreen', op, ...data }); break; } catch (err) {
        if (i >= 30 || !/Receiving end does not exist|message port closed/i.test(String(err?.message))) throw err;
        await sleep(100);
      }
    }
    if (!res?.ok) throw new Error(res?.error || 'offscreen-failed');
    return res.result;
  };

  // Progress from the offscreen document → the tab that asked.
  chrome.runtime.onMessage.addListener(msg => {
    if (msg?.type === 'mochi-image-progress') {
      const job = jobs.get(msg.job);
      if (job) chrome.tabs.sendMessage(job.tabId, msg).catch(() => {});
    }
    if (msg?.type === 'mochi-image-idle') chrome.offscreen.closeDocument().catch(() => {});
    // The model is ready: tell the tabs that asked, so their cards can describe now.
    if (msg?.type === 'mochi-image-ai-ready') { for (const id of aiAskers) chrome.tabs.sendMessage(id, { type: 'mochi-image-ai-ready' }).catch(() => {}); aiAskers.clear(); }
    return false;
  });

  async function capture(job) {
    const wait = lastCapture + MIN_GAP - Date.now();
    if (wait > 0) await sleep(wait);
    lastCapture = Date.now();
    try {
      return await chrome.tabs.captureVisibleTab(job.windowId, { format: 'png' });
    } catch (err) {
      // Over the rate limit after all: once more, a bit later.
      if (/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|quota/i.test(String(err?.message))) { await sleep(MIN_GAP + 200); lastCapture = Date.now(); return chrome.tabs.captureVisibleTab(job.windowId, { format: 'png' }); }
      throw err;
    }
  }

  const ops = {
    /** A new scan from this tab → its id. */
    begin: async (msg, sender) => {
      const id = `img_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      jobs.set(id, { tabId: sender.tab.id, windowId: sender.tab.windowId, tiles: [] });
      for (const [old, j] of jobs) if (old !== id && j.tabId === sender.tab.id) jobs.delete(old); // one scan per tab
      ensureOffscreen().catch(() => {}); // warm up while the page scrolls
      return { job: id };
    },
    /** One screenshot of the visible tab; the page says which part of it belongs to the image. */
    shot: async msg => {
      const job = jobs.get(msg.job);
      if (!job) throw new Error('no-job');
      const dataUrl = await capture(job);
      job.tiles.push({ dataUrl, crop: msg.crop, dest: msg.dest, viewport: msg.viewport });
      return { tiles: job.tiles.length };
    },
    /** Crop + stitch the tiles (or take the pixels the page read itself), then analyze. */
    analyze: async msg => {
      const job = jobs.get(msg.job);
      if (!job) throw new Error('no-job');
      const tiles = msg.direct ? [{ dataUrl: msg.direct, crop: null, dest: { x: 0, y: 0 } }] : job.tiles;
      job.tiles = [];
      return toOffscreen('analyze', { job: msg.job, tiles, size: msg.size, options: msg.options || {} });
    },
    describe: async msg => toOffscreen('describe', { job: msg.job, options: msg.options || {} }),
    /** "Ask Claude": focus the claude.ai tab used last, or open a new chat. */
    openClaude: async () => {
      let tabs = [];
      try { tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' }); } catch (_) { tabs = []; }
      const tab = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
      if (tab) {
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
        return 'focused';
      }
      await chrome.tabs.create({ url: 'https://claude.ai/new' });
      return 'opened';
    },
    /** The page where Chrome's on-device model is downloaded (after a click there). */
    openAiModel: async (msg, sender) => {
      aiAskers.add(sender.tab.id);
      const url = chrome.runtime.getURL('pages/ai-model.html');
      const [open] = await chrome.tabs.query({ url });
      if (open) { await chrome.tabs.update(open.id, { active: true }); await chrome.windows.update(open.windowId, { focused: true }).catch(() => {}); return true; }
      await chrome.windows.create({ url, type: 'popup', width: 520, height: 560 }).catch(() => chrome.tabs.create({ url }));
      return true;
    },
    aiStatus: async () => toOffscreen('aiStatus'),
    cancel: async msg => { const job = jobs.get(msg.job); if (job) job.cancelled = true; jobs.delete(msg.job); if (await hasOffscreen()) await chrome.runtime.sendMessage({ target: 'mochi-offscreen', op: 'cancel', job: msg.job }).catch(() => {}); return true; },
    end: async msg => { jobs.delete(msg.job); return true; },
  };

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg || msg.type !== 'mochi-image' || !sender.tab) return false;
    const run = ops[msg.op];
    if (!run) { reply({ ok: false, error: 'unknown-op' }); return false; }
    run(msg, sender).then(result => reply({ ok: true, result }), err => reply({ ok: false, error: String(err?.message || err) }));
    return true;
  });

  Mochi.imageScanBg = { ensureOffscreen, hasOffscreen, jobs, ops, menuClicked, MENU_ID }; // (menuClicked: for the test script)
})();
