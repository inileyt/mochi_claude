/*
 * Mochi — Live Edit kept for a site, on every visit (only after you allowed Mochi on every site,
 * and only while you have kept edits). Runs as the page starts: reads your kept edits (in this
 * browser) and adds the CSS for this site or page. Nothing else; nothing is read or sent.
 */
(() => {
  if (window.top !== window || globalThis.__mochiLiveApply) return;
  globalThis.__mochiLiveApply = true;
  const here = globalThis.Mochi?.noteUrl?.normalize(location.href);
  if (!here) return;
  chrome.storage.local.get('liveEdit.kept').then(out => {
    for (const k of out['liveEdit.kept'] || []) {
      if (k.on === false || !(k.scope === 'page' ? k.page === here.page : k.site === here.site)) continue;
      if (document.querySelector(`style[data-mochi-live="${k.id}"]`)) continue;
      const st = document.createElement('style');
      st.setAttribute('data-mochi-live', k.id);
      st.textContent = k.css;
      document.documentElement.append(st);
    }
  }, () => {});
})();
