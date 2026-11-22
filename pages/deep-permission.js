// Mochi's little window that asks Chrome for the optional "debugger" permission (Deep Scan).
(async () => {
  await Mochi.settings.load();
  Mochi.pages.translate();
  document.title = Mochi.t('deep.permTitle');
  const msg = document.getElementById('msg');
  const done = text => { msg.textContent = text; setTimeout(() => window.close(), 1400); };
  document.getElementById('allow').addEventListener('click', () => {
    // Straight from the click (Chrome wants a user gesture), before any await.
    chrome.permissions.request({ permissions: ['debugger'] }).then(
      yes => done(Mochi.t(yes ? 'deep.permYes' : 'deep.permNo')),
      () => done(Mochi.t('deep.permNo')));
  });
  document.getElementById('no').addEventListener('click', () => window.close());
})();
