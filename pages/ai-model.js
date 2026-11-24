// Mochi — the on-device AI page (Image Scan): explains the model and downloads it after a click.
// Chrome only starts the download from a click on a page, and only here does Mochi ask for it.
(async () => {
  await Mochi.settings.load();
  Mochi.pages.translate();
  document.title = Mochi.t('ai.title');
  const t = (k, v) => Mochi.t(k, v);
  const state = document.getElementById('ai-state');
  const go = document.getElementById('ai-go');
  const bar = document.getElementById('ai-bar');
  const fill = document.getElementById('ai-fill');
  const show = (text, warn = false) => { state.textContent = text; state.classList.toggle('warn', warn); };
  const busy = on => { bar.hidden = !on; bar.classList.toggle('indeterminate', on); if (on) fill.style.width = ''; };

  async function refresh() {
    const { available } = await Mochi.imageAi.status();
    if (available === 'available') { show(t('ai.ready')); busy(false); go.hidden = true; chrome.runtime.sendMessage({ type: 'mochi-image-ai-ready' }).catch(() => {}); }
    else if (available === 'unavailable') { show(t('ai.unavailable'), true); busy(false); go.hidden = true; }
    else if (available === 'downloading') { show(t('ai.downloading')); busy(true); go.disabled = true; }
    else show(t('ai.notYet'));
    return available;
  }

  go.addEventListener('click', async () => {
    // Straight from the click: Chrome needs it to start the download.
    go.disabled = true;
    busy(true);
    show(t('ai.downloading'));
    try {
      const session = await LanguageModel.create({
        ...Mochi.imageAi.OPTIONS,
        monitor: m => m.addEventListener('downloadprogress', e => {
          const pct = Math.max(0, Math.min(100, Math.round((e.loaded || 0) * 100)));
          bar.classList.remove('indeterminate'); // a real number arrived: show it
          fill.style.width = `${pct}%`;
        }),
      });
      session.destroy?.();
      bar.classList.remove('indeterminate'); fill.style.width = '100%';
    } catch (err) {
      show(t('ai.failed', { error: String(err?.message || err).slice(0, 120) }), true);
    }
    go.disabled = false;
    await refresh();
  });
  document.getElementById('ai-close').addEventListener('click', () => window.close());
  await refresh();
})();
