// Mochi — note reminders on revisit: turn them on (after Chrome's yes) or off (the permission goes back).
// chrome.permissions.request must run straight from the click, before any await.
(async () => {
  await Mochi.settings.load();
  Mochi.pages.translate();
  document.title = Mochi.t('remind.title');
  const t = k => Mochi.t(k);
  const state = document.getElementById('remind-state');
  const on = document.getElementById('remind-on');
  const off = document.getElementById('remind-off');
  const ask = op => new Promise(resolve => chrome.runtime.sendMessage({ type: 'mochi-tools', op }, res => { void chrome.runtime.lastError; resolve(res?.ok ? res.result : null); }));

  async function refresh() {
    const s = await ask('remindStatus');
    const active = !!(s?.permission && s?.registered);
    state.textContent = t(active ? 'remind.isOn' : 'remind.isOff');
    on.hidden = active;
    off.hidden = !active;
    document.documentElement.dataset.remind = active ? 'on' : 'off';
  }
  on.addEventListener('click', () => {
    chrome.permissions.request({ origins: ['<all_urls>'] }).then(async granted => {
      if (!granted) { state.textContent = t('remind.denied'); return; }
      await ask('remindOn');
      await refresh();
    }, () => { state.textContent = t('remind.denied'); });
  });
  off.addEventListener('click', async () => { await ask('remindOff'); await refresh(); });
  document.getElementById('remind-close').addEventListener('click', () => window.close());
  await refresh();
})();
