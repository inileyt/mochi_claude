/*
 * Mochi — Image Scan: which languages the OCR reads. Every model is bundled (offline), but the
 * worker loads only the ones you turn on here, so a scan stays fast. English, Russian and Armenian
 * are on by default; the rest (German, French, Spanish, Italian, Portuguese, Ukrainian, Greek) are
 * off until you want them. The welcome page shows the same picker (src/onboarding.js).
 *
 * The list of codes must match src/image-scan/ocr.js (AVAILABLE). Names are the languages' own
 * autonyms, so they read the same in every interface language.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const T = (k, v) => Mochi.t(k, v);
  const AVAILABLE = ['eng', 'rus', 'hye', 'deu', 'fra', 'spa', 'ita', 'por', 'ukr', 'ell'];
  const DEFAULT = ['eng', 'rus', 'hye'];
  const NAMES = { eng: 'English', rus: 'Русский', hye: 'Հայերեն', deu: 'Deutsch', fra: 'Français', spa: 'Español', ita: 'Italiano', por: 'Português', ukr: 'Українська', ell: 'Ελληνικά' };

  Mochi.settings.define({ imageScan: { langs: DEFAULT.slice() } });

  function current() {
    const l = Mochi.settings.get('imageScan.langs');
    const clean = Array.isArray(l) ? l.filter(c => AVAILABLE.includes(c)) : [];
    return clean.length ? AVAILABLE.filter(c => clean.includes(c)) : DEFAULT.slice();
  }
  async function set(list) {
    const clean = AVAILABLE.filter(c => list.includes(c));
    await Mochi.settings.set('imageScan.langs', clean.length ? clean : DEFAULT.slice());
  }
  async function toggle(code, on) {
    const set2 = new Set(current());
    if (on) set2.add(code); else set2.delete(code);
    await set([...set2]);
  }

  /** A row with the language's own name and a switch. */
  function row(code, { onToggle } = {}) {
    const { h } = Mochi.ui;
    const on = current().includes(code);
    return h('button', {
      class: 'set-row toggle lang-row', type: 'button', role: 'switch', 'aria-checked': String(on), 'data-lang': code,
      onclick: async ev => {
        const btn = ev.currentTarget;
        const next = btn.getAttribute('aria-checked') !== 'true';
        btn.setAttribute('aria-checked', String(next));
        await toggle(code, next);
        onToggle?.(code, next);
      },
    }, h('span', { text: `${NAMES[code]}${DEFAULT.includes(code) ? ` · ${T('ocr.default')}` : ''}` }), h('i', { class: 'switch', 'aria-hidden': 'true' }));
  }

  /** The picker, as a list of rows (used in the menu panel and on the welcome page). */
  function rows(opts) { return AVAILABLE.map(code => row(code, opts)); }

  /** Opens the picker in Mochi's panel (from Settings → Image text languages). */
  function openPicker(ctx) {
    const { h } = Mochi.ui;
    ctx.panel.open(T('ocr.title'), T('ocr.sub'), h('div', { class: 'ocr-langs' },
      h('p', { class: 'note', text: T('ocr.help') }),
      ...rows()));
    ctx.panel.view = 'ocr-langs';
  }

  Mochi.menu.addSetting({ id: 'ocr-langs', type: 'action', label: 'settings.ocrLangs', run: ctx => openPicker(ctx) });
  Mochi.imageLangs = { AVAILABLE, DEFAULT, NAMES, current, set, toggle, rows, openPicker };

  const hooks = (Mochi.debugHooks = Mochi.debugHooks || {});
  hooks.ocrLangs = () => ({ all: AVAILABLE.slice(), current: current(), rows: rows().length });
  hooks.setOcrLangs = async v => { await set(Array.isArray(v) ? v : []); return current(); };
})();
