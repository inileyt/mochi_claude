/*
 * Mochi — site notes: which page a note belongs to. Shared by Mochi, the tiny revisit
 * peek script and the Node tests.
 *
 *   Mochi.noteUrl.normalize(url) → { page, site } | null
 *     page: origin + path + the query without tracking parameters (utm_*, fbclid, gclid…), sorted, no #hash
 *     site: the host, lower case, without "www."
 *   Mochi.noteUrl.keyOf(url, scope)  → 'page:…' or 'site:…'
 * Only http(s) and file pages get notes.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const TRACKING = /^(utm_[a-z0-9_]+|fbclid|gclid|gclsrc|dclid|gbraid|wbraid|msclkid|yclid|twclid|ttclid|li_fat_id|mc_cid|mc_eid|igshid|_ga|_gl|_hsenc|_hsmi|_openstat|vero_id|wickedid|oly_anon_id|oly_enc_id|rb_clickid|s_cid|ref_src|spm|scm)$/i;

  function normalize(input) {
    let u;
    try { u = new URL(String(input)); } catch (_) { return null; }
    if (!/^(https?|file):$/.test(u.protocol)) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const query = params.length ? `?${params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}` : '';
    let path = u.pathname || '/';
    if (path.length > 1) path = path.replace(/\/+$/, '') || '/';
    const origin = u.protocol === 'file:' ? 'file://' : `${u.protocol}//${host}${u.port ? `:${u.port}` : ''}`;
    return { page: `${origin}${path}${query}`, site: u.protocol === 'file:' ? 'file' : `${host}${u.port ? `:${u.port}` : ''}` };
  }
  const keyOf = (url, scope = 'page') => { const n = normalize(url); return n ? `${scope}:${scope === 'site' ? n.site : n.page}` : null; };

  Mochi.noteUrl = { normalize, keyOf, TRACKING };
  if (typeof module !== 'undefined') module.exports = Mochi.noteUrl;
})();
