/*
 * Mochi — Deep Scan output: the files of the rebuild spec and the results panel.
 * Mochi.deepScan.writers: functions scan → [{ name, data }] (spec.json, SPEC.md, PROMPT.md, tokens…),
 * added by src/deep-scan/spec-*.js. The zip is built here (src/deep-scan/zip.js) and downloaded.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const D = Mochi.deepScan;
  D.writers = D.writers || [];
  D.views = D.views || []; // functions (scan, h, t) → element: sections of the results panel

  const slug = s => String(s || 'page').toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'page';
  const day = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  D.zipName = scan => `rebuild-spec-${slug(scan.host)}-${day()}.zip`;

  /** Every file of the spec, in zip order (screenshots get their placeholders painted on, unless own site). */
  D.files = async scan => {
    const files = [];
    for (const w of D.writers) { try { files.push(...(w(scan) || [])); } catch (err) { scan.spec.notes.push(`A part of the output failed: ${err.message}`); } }
    if (!files.some(f => f.name === 'spec.json')) files.push({ name: 'spec.json', data: JSON.stringify(scan.spec, null, 2) });
    for (const s of scan.shots) {
      if (!s.redacted) { s.data = scan.opts.ownSite || !D.redactShot ? s.data : await D.redactShot(s); s.redacted = true; }
      files.push({ name: `screenshots/${s.name}`, data: s.data });
    }
    return files;
  };

  D.download = async (scan, ctx) => {
    const bytes = Mochi.zip.build(await D.files(scan));
    const name = D.zipName(scan);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    const a = Mochi.ui.h('a', { href: url, download: name, style: { display: 'none' } });
    ctx.companion.shadow.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
    ctx.actions?.downloaded?.(name);
    return { name, bytes: bytes.length };
  };

  /** The pocket keeps the short version (the screenshots are too big for browser storage: the zip is the download). */
  async function toPocket(scan) {
    if (!Mochi.pocket || !D.pasteText) return null;
    const roles = scan.spec.tokens?.colors?.roles || [];
    return Mochi.pocket.add({
      v: 1, id: `deep_${Date.now().toString(36)}`, kind: 'deep', url: location.href.split('#')[0], host: scan.host, title: scan.opts.ownSite ? (document.title || scan.host).slice(0, 120) : D.zipName(scan),
      at: new Date().toISOString(), colors: roles.map(c => ({ hex: c.hex, role: c.role })), vibe: [{ id: 'deep', label: Mochi.t('deep.pocketChip') }],
      paste: D.pasteText(scan), zipName: D.zipName(scan),
    }, { offered: true });
  }
  /** Pocket → "Formats" on a deep scan: the short version to copy. */
  D.showPaste = (entry, ctx) => {
    const { h } = Mochi.ui;
    ctx.panel.open(Mochi.t('deep.title'), entry.zipName || entry.host, h('div', { class: 'deep deep-results' }, h('p', { class: 'note', text: Mochi.t('deep.pasteNote') }), h('pre', { text: entry.paste || '' })),
      h('div', { class: 'row' }, h('button', { class: 'px-btn primary', type: 'button', onclick: async () => { await Mochi.ui.copyText(entry.paste || '', ctx.companion.shadow); ctx.actions?.copied?.(Mochi.t('deep.summary')); } }, Mochi.t('deep.copySummary'))));
  };

  D.finish = async (scan, ctx) => {
    const { h } = Mochi.ui;
    const t = Mochi.t;
    try { await toPocket(scan); } catch (_) { /* the pocket is a bonus */ }
    const sections = D.views.map(v => { try { return v(scan, h, t); } catch (_) { return null; } }).filter(Boolean);
    const body = h('div', { class: 'deep deep-results' },
      h('p', { text: t('deep.doneText', { s: Math.round((scan.spec.source.ms || 0) / 1000), shots: scan.shots.length }) }),
      ...sections);
    const footer = h('div', { class: 'row' },
      h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'deep-download', onclick: () => D.download(scan, ctx) }, `⤓ ${t('deep.download')}`),
      D.pasteText ? h('button', { class: 'px-btn', type: 'button', 'data-act': 'deep-copy', onclick: async () => { await Mochi.ui.copyText(D.pasteText(scan), ctx.companion.shadow); ctx.actions?.copied?.(t('deep.summary')); } }, t('deep.copySummary')) : null);
    ctx.panel.open(t('deep.title'), t('deep.doneSub'), body, footer);
    ctx.panel.view = 'deep-results';
  };

  Mochi.debugHooks = Mochi.debugHooks || {};
  // Test hook: the zip of the last deep scan, as base64 (local test pages only).
  Mochi.debugHooks.deepZip = async () => {
    const scan = D.last;
    if (!scan) return null;
    const bytes = Mochi.zip.build(await D.files(scan));
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { name: D.zipName(scan), base64: btoa(bin) };
  };
})();
