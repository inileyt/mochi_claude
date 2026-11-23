// Mochi on every site (optional): Live Edits kept on every visit, guides that follow you.
// chrome.permissions.request must run straight from the click, before any await.
(async () => {
  await Mochi.settings.load();
  Mochi.pages.translate();
  document.title = Mochi.t('every.title');
  const why = new URLSearchParams(location.search).get('why');
  for (const id of ['edits', 'guides']) document.getElementById(`why-${id}`).classList.toggle('pick', id === why);
  const t = k => Mochi.t(k);
  const state = document.getElementById('every-state');
  const on = document.getElementById('every-on');
  const off = document.getElementById('every-off');
  const ask = op => new Promise(resolve => chrome.runtime.sendMessage({ type: 'mochi-tools', op }, res => { void chrome.runtime.lastError; resolve(res?.ok ? res.result : null); }));
  async function refresh() {
    const s = await ask('everywhereStatus');
    state.textContent = t(s?.permission ? 'every.isOn' : 'every.isOff');
    on.hidden = !!s?.permission;
    off.hidden = !s?.permission;
    document.documentElement.dataset.every = s?.permission ? 'on' : 'off';
  }
  on.addEventListener('click', () => {
    chrome.permissions.request({ origins: ['<all_urls>'] }).then(async granted => {
      if (!granted) { state.textContent = t('remind.denied'); return; }
      await ask('liveEditSync');
      await refresh();
    }, () => { state.textContent = t('remind.denied'); });
  });
  off.addEventListener('click', async () => { await ask('everywhereOff'); await refresh(); });
  document.getElementById('every-close').addEventListener('click', () => window.close());
  await refresh();
})();
