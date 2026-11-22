// Mochi's options page: which chat sites Mochi lives on.
(async () => {
  await Mochi.settings.load();
  Mochi.pages.translate();
  document.title = Mochi.t('page.optionsTitle');
  Mochi.pages.sitesWidget(document.getElementById('sites-list'));
})();
