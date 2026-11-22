/*
 * Mochi — panels (the sheet beside Mochi), drawn inside Mochi's shadow DOM.
 * The menu itself lives in menu.js.
 *
 *   panel.showScan(scan)      the results of a UI scan: swatches, type, shape,
 *                             spacing, components, vibe, and export tabs
 *
 * Everything is built with DOM APIs and textContent (never innerHTML with
 * page data), so a scanned page can't inject anything into Mochi.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  /** Tiny element builder: h('div', { class: 'x', style: { color: 'red' }, onclick }, children…). */
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'style') for (const [p, val] of Object.entries(v)) { if (val !== null && val !== undefined) el.style.setProperty(p, String(val)); }
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  /** Copies text: the async clipboard first, then the old execCommand way. */
  async function copyText(text, shadow) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const area = h('textarea', { style: { position: 'fixed', left: '-9999px', top: '0' } });
      area.value = text;
      shadow.append(area);
      area.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      area.remove();
      return ok;
    }
  }

  /** Saves a text file through a Blob URL (no permission needed). */
  function downloadText(name, text, shadow, type = 'text/markdown') {
    const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
    const a = h('a', { href: url, download: name, style: { display: 'none' } });
    shadow.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  /** "(page asks for: Inter Variable, SF Pro Display)" when the page's stack holds more than what renders. */
  const stackNote = f => {
    const others = (f?.stack || []).filter(n => n !== f.family && !/^(system-ui|sans-serif|serif|monospace|-apple-system|blinkmacsystemfont|ui-)/i.test(n));
    return others.length ? h('span', { class: 'font-stack', text: ` · page asks for: ${[f.stack[0] === f.family ? null : f.stack[0], ...others.filter(n => n !== f.stack[0])].filter(Boolean).slice(0, 3).join(', ')}` }) : null;
  };

  const T = (key, vars) => Mochi.t(key, vars);
  const shortDate = iso => { try { return new Date(iso).toLocaleDateString(Mochi.lang?.() || undefined, { month: 'short', day: 'numeric' }); } catch (_) { return ''; } };

  class Panel {
    /**
     * @param companion the Mochi view (its shadow root and root element)
     * @param actions { scan, play, pocket?, copied(label), downloaded(name), paste?(scan) }
     */
    constructor(companion, actions) {
      this.c = companion;
      this.actions = actions;
      this.format = 'prompt';
      this.mount();
    }

    mount() {
      const shadow = this.c.shadow;
      this.sheet = h('section', { class: 'panel', role: 'dialog', 'aria-modal': 'false', hidden: true });
      shadow.append(this.sheet);
      document.addEventListener('keydown', ev => {
        if (ev.key === 'Escape' && !this.sheet.hidden && !Mochi.menuInstance?.isOpen) this.close();
      }, true);
      addEventListener('resize', () => { if (!this.sheet.hidden) this.place(); }, { passive: true });
    }

    // ——— the sheet (results / pocket) ———
    open(title, sub, body, footer) {
      this.sheet.replaceChildren(
        h('header', { class: 'sheet-head' },
          h('div', { class: 'sheet-title' }, h('b', { text: title }), sub ? h('span', { class: 'sheet-sub', text: sub }) : null),
          h('button', { class: 'px-btn icon', type: 'button', 'aria-label': T('settings.close'), title: T('settings.close'), onclick: () => this.close() }, '×')),
        h('div', { class: 'sheet-body' }, body),
        footer ? h('footer', { class: 'sheet-foot' }, footer) : null,
      );
      this.sheet.setAttribute('aria-label', title);
      this.sheet.hidden = false;
      this.place();
      requestAnimationFrame(() => this.sheet.classList.add('show'));
    }
    close() {
      this.sheet.classList.remove('show');
      this.sheet.hidden = true;
      this.c.el.focus({ preventScroll: true });
    }
    get isOpen() { return !this.sheet.hidden; }

    /** Beside Mochi when there is room, otherwise a sheet above it. */
    place() {
      const r = this.c.root.getBoundingClientRect();
      const s = this.sheet.style;
      for (const p of ['left', 'right', 'top', 'bottom', 'width', 'max-height']) s.removeProperty(p);
      if (r.left >= 360) {
        s.right = `${Math.round(innerWidth - r.left + 10)}px`;
        s.bottom = `${Math.round(Math.max(8, innerHeight - r.bottom))}px`;
        s.width = `${Math.round(Math.min(420, r.left - 20))}px`;
        s.maxHeight = `${Math.round(Math.min(innerHeight - 16, Math.max(320, r.bottom - 8)))}px`;
      } else {
        s.left = '8px';
        s.right = '8px';
        s.bottom = `${Math.round(Math.min(innerHeight - 200, innerHeight - r.top + 8))}px`;
        s.maxHeight = `${Math.round(Math.max(200, r.top - 16))}px`;
      }
    }

    // ——— scan results ———
    showScan(scan, { saved = false } = {}) {
      this.scan = scan;
      const X = Mochi.exporters;
      const section = (title, ...kids) => h('section', { class: 'blk' }, h('h4', { text: title }), ...kids);

      const vibes = h('div', { class: 'vibes' },
        ...(scan.vibe || []).map((v, i) => h('span', { class: `chip${i ? '' : ' main'}`, text: v.label })),
        h('span', { class: 'chip ghost', text: scan.theme }),
      );
      const reason = scan.vibe?.[0] ? h('p', { class: 'reason', text: `${scan.vibe[0].reason}${scan.vibe[1] ? ` · ${scan.vibe[1].reason}` : ''}` }) : null;

      const swatches = h('div', { class: 'swatches' }, ...(scan.colors || []).map(c => h('button', {
        class: 'swatch', type: 'button', title: T('panel.copyThis', { what: c.hex }), 'aria-label': T('panel.swatchLabel', { role: c.role, hex: c.hex }),
        onclick: async () => { await copyText(c.hex, this.c.shadow); this.actions.copied(c.hex); },
      }, h('i', { style: { background: c.hex } }), h('span', { class: 'sw-role', text: c.role }), h('span', { class: 'sw-hex', text: c.hex }))));

      const t = scan.typography || {};
      const fonts = h('div', { class: 'fonts' },
        h('div', { class: 'font-row' },
          h('span', { class: 'font-sample head', style: { 'font-family': `"${t.heading?.family}", system-ui`, 'font-weight': t.heading?.weights?.at(-1) || 700, 'letter-spacing': t.heading?.letterSpacing }, text: 'Aa' }),
          h('span', { class: 'font-meta' }, h('b', { text: t.heading?.family || '—' }), ` headings · ${(t.heading?.weights || []).join('/')} · lh ${t.heading?.lineHeight ?? '—'}`, stackNote(t.heading))),
        h('div', { class: 'font-row' },
          h('span', { class: 'font-sample', style: { 'font-family': `"${t.body?.family}", system-ui`, 'font-weight': t.body?.weight || 400 }, text: 'Aa' }),
          h('span', { class: 'font-meta' }, h('b', { text: t.body?.family || '—' }), ` body · ${t.body?.size}px / ${t.body?.lineHeight}`, stackNote(t.body))),
        t.mono ? h('div', { class: 'font-row' },
          h('span', { class: 'font-sample', style: { 'font-family': `"${t.mono}", monospace` }, text: '{}' }),
          h('span', { class: 'font-meta' }, h('b', { text: t.mono }), ' mono')) : null,
        h('div', { class: 'scale' }, ...(t.scale || []).map(s => h('span', { class: 'chip ghost', text: `${s}` }))),
      );

      const shape = h('div', { class: 'shapes' },
        ...(scan.shape?.radii || []).slice(0, 4).map(r => h('div', { class: 'shape' },
          h('i', { class: 'radius', style: { 'border-radius': r.px === 9999 ? '9999px' : `${Math.min(r.px, 20)}px` } }),
          h('span', { text: r.px === 9999 ? 'pill' : `${r.px}px` }))),
        ...(scan.shape?.shadows || []).slice(0, 3).map((sh, i) => h('div', { class: 'shape' },
          h('i', { class: 'shadow', style: { 'box-shadow': sh } }),
          h('span', { text: `shadow ${i + 1}` }))),
      );
      const spacing = h('div', { class: 'spacing' },
        ...(scan.spacing?.scale || []).map(v => h('div', { class: 'sp' }, h('i', { style: { width: `${Math.min(v, 96)}px` } }), h('span', { text: `${v}` }))),
        h('p', { class: 'note', text: scan.spacing?.base ? `${scan.spacing.base}px grid detected` : 'no strict 4/8px grid' }),
      );
      const l = scan.layout || {};
      const layout = h('p', { class: 'note', text: [
        l.maxWidth ? `max width ${l.maxWidth}px` : 'fluid width',
        `${l.columns} col`,
        `${l.flex} flex · ${l.grid} grid`,
        l.stickyHeader ? 'sticky header' : null,
      ].filter(Boolean).join(' · ') });

      const comp = scan.components || {};
      const preview = (c, label) => h('span', { class: 'cmp-prev', style: {
        background: c.bg === 'transparent' ? 'transparent' : c.bg, color: c.color,
        'border-radius': c.radius === '9999px' ? '9999px' : `${Math.min(parseFloat(c.radius) || 0, 24)}px`,
        border: c.border === 'none' ? '1px dashed transparent' : c.border, 'box-shadow': c.shadow === 'none' ? 'none' : c.shadow,
        padding: c.padding, font: c.font ? `${c.font}, system-ui, sans-serif` : null,
      }, text: label });
      const components = h('div', { class: 'cmps' }, ...[
        ['buttonPrimary', T('cmp.buttonPrimary'), T('cmp.sample.button')], ['buttonSecondary', T('cmp.buttonSecondary'), T('cmp.sample.button')],
        ['badge', T('cmp.badge'), T('cmp.sample.badge')], ['input', T('cmp.input'), T('cmp.sample.input')], ['card', T('cmp.card'), T('cmp.card')], ['navbar', T('cmp.navbar'), T('cmp.sample.nav')],
      ].filter(([k]) => comp[k]).map(([k, name, label]) => h('div', { class: 'cmp' },
        h('div', { class: 'cmp-stage' }, preview(comp[k], label)),
        h('div', { class: 'cmp-desc' }, h('b', { text: name }), h('span', { text: X.describe(comp[k]) })))));

      const fx = [];
      if (scan.effects?.glass) fx.push(`glass blur ${scan.effects.glass.blur}px`);
      if (scan.effects?.gradients?.length) fx.push(`${scan.effects.gradients.length} gradient${scan.effects.gradients.length > 1 ? 's' : ''}`);
      if (scan.effects?.transitions) fx.push('transitions');
      if (scan.effects?.animations) fx.push('animations');
      if (scan.effects?.bgImages) fx.push('background images');
      if (scan.effects?.noise) fx.push('noise');

      this.exportBox = h('textarea', { class: 'export', readonly: true, spellcheck: 'false', 'aria-label': 'Export' });
      this.tabs = h('div', { class: 'tabs', role: 'tablist' }, ...Mochi.EXPORT_FORMATS.map(f => h('button', {
        class: 'px-btn tab', type: 'button', role: 'tab', 'data-format': f.id,
        onclick: () => this.setFormat(f.id),
      }, f.label)));
      const exportActions = h('div', { class: 'row' },
        h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'copy', onclick: async () => {
          await copyText(this.exportBox.value, this.c.shadow);
          this.actions.copied(Mochi.EXPORT_FORMATS.find(f => f.id === this.format).label);
        } }, `⧉ ${T('panel.copy')}`),
        h('button', { class: 'px-btn', type: 'button', 'data-act': 'download', onclick: () => {
          downloadText('DESIGN.md', X.designMd(scan), this.c.shadow);
          this.actions.downloaded('DESIGN.md');
        } }, '⤓ DESIGN.md'),
        this.actions.paste ? h('button', { class: 'px-btn', type: 'button', 'data-act': 'paste', onclick: () => this.actions.paste(scan) }, `✎ ${T('panel.pasteToClaude')}`) : null,
      );

      this.open(
        T('panel.scanTitle'),
        `${scan.host} · ${shortDate(scan.at)}`,
        [
          h('div', { class: 'blk' }, vibes, reason),
          section(T('panel.colors'), swatches, h('p', { class: 'note', text: T('panel.swatchHint') })),
          section(T('panel.typography'), fonts),
          (scan.shape?.radii?.length || scan.shape?.shadows?.length) ? section(T('panel.shape'), shape) : null,
          scan.spacing?.scale?.length ? section(T('panel.spacing'), spacing) : null,
          section(T('panel.layout'), layout),
          components.childElementCount ? section(T('panel.components'), components) : null,
          fx.length ? section(T('panel.effects'), h('div', { class: 'vibes' }, ...fx.map(f => h('span', { class: 'chip ghost', text: f })))) : null,
          section(T('panel.export'), this.tabs, this.exportBox, exportActions),
        ],
        h('span', { text: `${saved ? `▣ ${T('panel.savedToPocket')} · ` : ''}${T('panel.elements', { n: scan.stats.elements })} · ${scan.stats.ms} ms${scan.stats.capped ? ` · ${T('panel.sampled')}` : ''}` }),
      );
      this.view = 'scan';
      this.setFormat(this.format);
    }

    // ——— a picked element ———
    showComponent(cmp, { saved = false } = {}) {
      this.cmp = cmp;
      const X = Mochi.componentExporters;
      const st = cmp.style || {};
      const section = (title, ...kids) => h('section', { class: 'blk' }, h('h4', { text: title }), ...kids);

      // Live preview in its own sealed box, so its CSS can't touch Mochi or the page.
      // Images are left out of the preview, so nothing loads.
      const stage = h('div', { class: 'pick-preview' });
      const sealed = stage.attachShadow({ mode: 'open' });
      sealed.innerHTML = `<style>:host{all:initial;display:block}.stage{display:flex;align-items:center;justify-content:center;min-height:72px;max-height:260px;overflow:auto;padding:12px;font-family:system-ui,sans-serif}img{background:repeating-linear-gradient(45deg,#ddd 0 6px,#eee 6px 12px);min-width:16px;min-height:16px}${cmp.css}</style><div class="stage">${(cmp.html || '').replace(/\s(src|srcset)="[^"]*"/g, '')}</div>`;
      sealed.addEventListener('click', ev => ev.preventDefault(), true);

      const copyable = (label, value) => h('button', {
        class: 'kv', type: 'button', title: T('panel.copyThis', { what: value }),
        onclick: async () => { await copyText(String(value), this.c.shadow); this.actions.copied(label); },
      }, h('span', { class: 'k', text: label }),
        /^#|^rgba?\(/.test(String(value)) ? h('i', { class: 'dot', style: { background: value } }) : null,
        h('span', { class: 'v', text: String(value) }));
      const rows = [
        st.background && st.background !== 'transparent' ? copyable('background', st.background) : null,
        st.backgroundImage && /gradient/.test(st.backgroundImage) ? copyable('gradient', st.backgroundImage) : null,
        copyable('text', st.color),
        st.font ? copyable('font', `${st.font.family} ${st.font.size} / ${st.font.weight}`) : null,
        st.font?.lineHeight ? copyable('line-height', st.font.lineHeight) : null,
        st.font?.letterSpacing && st.font.letterSpacing !== 'normal' && parseFloat(st.font.letterSpacing) !== 0 ? copyable('letter-spacing', st.font.letterSpacing) : null,
        copyable('padding', st.padding),
        copyable('radius', st.radius),
        st.border !== 'none' ? copyable('border', st.border) : null,
        st.shadow !== 'none' ? copyable('shadow', st.shadow) : null,
        st.backdrop ? copyable('backdrop', st.backdrop) : null,
        st.transition ? copyable('transition', st.transition) : null,
        copyable('size', `${st.size?.width}×${st.size?.height}px`),
      ].filter(Boolean);
      const hover = cmp.hover ? Object.entries(cmp.hover).map(([p, v]) => copyable(p, v)) : [];

      this.exportBox = h('textarea', { class: 'export', readonly: true, spellcheck: 'false', 'aria-label': 'Export' });
      this.tabs = h('div', { class: 'tabs', role: 'tablist' }, ...Mochi.COMPONENT_FORMATS.map(f => h('button', {
        class: 'px-btn tab', type: 'button', role: 'tab', 'data-format': f.id, onclick: () => this.setComponentFormat(f.id),
      }, f.label)));
      const actions = h('div', { class: 'row' },
        h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'copy', onclick: async () => {
          await copyText(this.exportBox.value, this.c.shadow);
          this.actions.copied(Mochi.COMPONENT_FORMATS.find(f => f.id === this.cmpFormat).label);
        } }, `⧉ ${T('panel.copy')}`),
        h('button', { class: 'px-btn', type: 'button', 'data-act': 'download', onclick: () => {
          downloadText('component.html', X.html(cmp), this.c.shadow, 'text/html');
          this.actions.downloaded('component.html');
        } }, '⤓ .html'),
        this.actions.paste ? h('button', { class: 'px-btn', type: 'button', 'data-act': 'paste', onclick: () => this.actions.paste(cmp) }, `✎ ${T('panel.pasteToClaude')}`) : null,
        this.actions.pick ? h('button', { class: 'px-btn', type: 'button', 'data-act': 'pick-again', onclick: () => this.actions.pick() }, `⌖ ${T('panel.pickAnother')}`) : null,
      );

      this.open(T('panel.picked', { name: cmp.name }), `${cmp.host} · ${cmp.selector}`, [
        section(T('panel.preview'), stage),
        section(T('panel.style'), h('div', { class: 'kvs' }, ...rows), h('p', { class: 'note', text: T('panel.valueHint') })),
        section(T('panel.hover'), hover.length ? h('div', { class: 'kvs' }, ...hover) : h('p', { class: 'note', text: T('panel.noHover') })),
        cmp.colors?.length ? section(T('panel.colorsInside'), h('div', { class: 'vibes' }, ...cmp.colors.map(c => h('button', {
          class: 'chip ghost color-chip', type: 'button', title: T('panel.copyThis', { what: c.hex }),
          onclick: async () => { await copyText(c.hex, this.c.shadow); this.actions.copied(c.hex); },
        }, h('i', { class: 'dot', style: { background: c.hex } }), ` ${c.hex}`)))) : null,
        section(T('panel.export'), this.tabs, this.exportBox, actions),
      ], h('span', { text: `${saved ? `▣ ${T('panel.savedToPocket')} · ` : ''}${T('panel.elements', { n: cmp.stats.elements })}${cmp.stats.capped ? ` (${T('panel.first120')})` : ''} · ${cmp.stats.ms} ms` }));
      this.view = 'component';
      this.setComponentFormat(this.cmpFormat || 'style');
    }

    setComponentFormat(id) {
      this.cmpFormat = id;
      for (const tab of this.tabs.children) tab.setAttribute('aria-selected', String(tab.dataset.format === id));
      this.exportBox.value = Mochi.componentExporters[id](this.cmp);
      this.exportBox.scrollTop = 0;
    }

    // ——— Mochi's pocket ———
    /**
     * @param items pocket entries, newest first
     * @param on { paste?(entry), copy(entry), formats(entry), remove(entry) }
     */
    showPocket(items, on) {
      const body = items.length ? h('ul', { class: 'pocket' }, ...items.map(entry => {
        const strip = h('span', { class: 'strip', 'aria-hidden': 'true' }, ...(entry.colors || []).slice(0, 6).map(c => h('i', { style: { background: c.hex } })));
        return h('li', { class: 'pk', 'data-id': entry.id },
          h('div', { class: 'pk-head' },
            strip,
            h('div', { class: 'pk-title' }, h('b', { text: entry.host }), h('span', { text: `${shortDate(entry.at)} · ${entry.title}` }))),
          h('div', { class: 'vibes' }, ...(entry.kind === 'component'
            ? [h('span', { class: 'chip main', text: T('panel.pickedChip', { name: entry.name }) }), entry.label ? h('span', { class: 'chip ghost', text: `“${entry.label.slice(0, 24)}”` }) : null]
            : (entry.vibe || []).map((v, i) => h('span', { class: `chip${i ? '' : ' main'}`, text: v.label })))),
          h('div', { class: 'row' },
            on.paste
              ? h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'paste', onclick: () => on.paste(entry) }, `✎ ${T('panel.paste')}`)
              : h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'copy', onclick: () => on.copy(entry) }, `⧉ ${T('panel.copyPrompt')}`),
            h('button', { class: 'px-btn', type: 'button', 'data-act': 'formats', onclick: () => on.formats(entry) }, `⋯ ${T('panel.formats')}`),
            h('button', { class: 'px-btn danger', type: 'button', 'data-act': 'delete', 'aria-label': T('panel.deleteScan', { host: entry.host }), onclick: () => on.remove(entry) }, `✕ ${T('panel.delete')}`)),
        );
      })) : h('div', { class: 'empty' },
        h('p', { text: T('pocket.empty') }),
        h('p', { class: 'note', text: T('pocket.hint') }));
      this.open(T('pocket.title'), `${items.length} / ${Mochi.pocket?.MAX ?? 20}`, body,
        h('span', { text: T('pocket.foot') }));
      this.view = 'pocket';
    }

    // ——— the offer on claude.ai: "I brought a style from …! Paste it?" ———
    showOffer(entry, on) {
      this.hideOffer();
      this.c.bubble.classList.remove('show');
      this.offerEl = h('div', { class: 'offer', role: 'alertdialog', 'aria-label': T('offer.label', { host: entry.host }) },
        h('p', {}, ...T(entry.kind === 'component' ? 'offer.component' : 'offer.style', { name: entry.name, host: '\u0000' }).split('\u0000').flatMap((part, i) => (i ? [h('b', { text: entry.host }), part] : [part]))),
        h('div', { class: 'row' },
          h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'paste', onclick: () => { this.hideOffer(); on.paste(entry); } }, T('panel.paste')),
          h('button', { class: 'px-btn', type: 'button', 'data-act': 'later', onclick: () => { this.hideOffer(); on.later(entry); } }, T('longChat.notNow')),
          h('button', { class: 'px-btn', type: 'button', 'data-act': 'open', onclick: () => { this.hideOffer(); on.open(entry); } }, T('offer.openPocket'))));
      this.c.root.append(this.offerEl);
      this.offerTimer = setTimeout(() => { this.hideOffer(); on.later(entry); }, 30000);
    }
    hideOffer() {
      clearTimeout(this.offerTimer);
      this.offerEl?.remove();
      this.offerEl = null;
    }
    get isOffering() { return !!this.offerEl; }

    setFormat(id) {
      this.format = id;
      for (const tab of this.tabs.children) tab.setAttribute('aria-selected', String(tab.dataset.format === id));
      this.exportBox.value = Mochi.exporters[id](this.scan);
      this.exportBox.scrollTop = 0;
    }
  }

  Mochi.Panel = Panel;
  Mochi.ui = { h, copyText, downloadText, shortDate };
})();
