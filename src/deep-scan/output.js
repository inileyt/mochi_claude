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

  /** Every file of the spec, in zip order. */
  D.files = scan => {
    const files = [];
    for (const w of D.writers) { try { files.push(...(w(scan) || [])); } catch (err) { scan.spec.notes.push(`A part of the output failed: ${err.message}`); } }
    if (!files.some(f => f.name === 'spec.json')) files.push({ name: 'spec.json', data: JSON.stringify(scan.spec, null, 2) });
    for (const s of scan.shots) files.push({ name: `screenshots/${s.name}`, data: s.data });
    return files;
  };

  D.download = (scan, ctx) => {
    const bytes = Mochi.zip.build(D.files(scan));
    const name = D.zipName(scan);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    const a = Mochi.ui.h('a', { href: url, download: name, style: { display: 'none' } });
    ctx.companion.shadow.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
    ctx.actions?.downloaded?.(name);
    return { name, bytes: bytes.length };
  };

  D.finish = async (scan, ctx) => {
    const { h } = Mochi.ui;
    const t = Mochi.t;
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
  Mochi.debugHooks.deepZip = () => {
    const scan = D.last;
    if (!scan) return null;
    const bytes = Mochi.zip.build(D.files(scan));
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { name: D.zipName(scan), base64: btoa(bin) };
  };
})();
