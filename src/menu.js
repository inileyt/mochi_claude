/*
 * Mochi — the menu, a tiny pixel app that opens when you click Mochi.
 *
 * Five sections: Mochi · Wardrobe · Friends · Tools · Settings. Features
 * add themselves to a registry when their file loads, so this file never
 * needs to know about them:
 *
 *   Mochi.menu.addItem({ section: 'tools', id: 'export', icon: '⤓', label: 'menu.export',
 *                        run: ctx => …, when: ctx => ctx.isClaude })
 *   Mochi.menu.addView('wardrobe', ctx => element)        custom content above the items
 *   Mochi.menu.addSetting({ path: 'sound.on', type: 'toggle', label: 'settings.sound' })
 *        types: toggle · select (options: [[value, labelKey]] or () => …) · range (min, max, step) · action (run)
 *
 * ctx (given by content.js) holds companion, engine, panel, menu, isClaude
 * and the actions features need.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const reg = (Mochi.menu = Mochi.menu || { items: [], views: {}, settings: [] });
  reg.addItem = item => { reg.items.push(item); };
  reg.addView = (section, fn) => { (reg.views[section] = reg.views[section] || []).push(fn); };
  reg.addSetting = setting => { reg.settings.push(setting); };

  const SECTIONS = [
    { id: 'mochi', icon: '☻' },
    { id: 'wardrobe', icon: '♛' },
    { id: 'friends', icon: '♥' },
    { id: 'tools', icon: '✦' },
    { id: 'settings', icon: '⚙' },
  ];
  const t = (k, v) => Mochi.t(k, v);
  const resolve = (v, ctx) => (typeof v === 'function' ? v(ctx) : v);

  class Menu {
    constructor(companion, ctx) {
      this.c = companion;
      this.ctx = { ...ctx, menu: this };
      this.section = 'mochi';
      const { h } = Mochi.ui;
      this.h = h;
      this.el = h('div', { class: 'app', role: 'dialog', 'aria-label': 'Mochi', hidden: true });
      companion.root.append(this.el);

      document.addEventListener('pointerdown', ev => {
        // Mochi's shadow root is closed: from out here, a click anywhere on Mochi shows up as its host.
        if (this.isOpen && !ev.composedPath().includes(this.c.host)) this.close();
      }, true);
      document.addEventListener('keydown', ev => {
        if (ev.key === 'Escape' && this.isOpen) { ev.stopPropagation(); this.close(); }
      }, true);
      Mochi.settings?.onChange(() => this.refresh());
    }

    get isOpen() { return !this.el.hidden; }
    toggle() { if (this.isOpen) this.close(); else this.open(); }

    open(section) {
      if (section) this.section = section;
      this.c.bubble.classList.remove('show');
      this.el.hidden = false;
      this.c.el.setAttribute('aria-expanded', 'true');
      this.render();
      this.el.querySelector('.app-tab[aria-selected="true"]')?.focus({ preventScroll: true });
    }

    close() {
      if (!this.isOpen) return;
      this.el.hidden = true;
      this.c.el.setAttribute('aria-expanded', 'false');
    }

    refresh() { if (this.isOpen) this.render(); }

    show(section) {
      this.section = section;
      this.render();
      this.el.querySelector(`.app-tab[data-section="${section}"]`)?.focus({ preventScroll: true });
    }

    render() {
      const { h } = this;
      const ctx = this.ctx;
      const tabs = h('nav', { class: 'app-tabs', role: 'tablist', 'aria-label': 'Sections' }, ...SECTIONS.map(s => h('button', {
        class: 'app-tab', type: 'button', role: 'tab', 'data-section': s.id,
        'aria-selected': String(s.id === this.section), title: t(`section.${s.id}`), 'aria-label': t(`section.${s.id}`),
        onclick: () => this.show(s.id),
        onkeydown: ev => {
          const i = SECTIONS.findIndex(x => x.id === this.section);
          if (ev.key === 'ArrowRight') { ev.preventDefault(); this.show(SECTIONS[(i + 1) % SECTIONS.length].id); }
          if (ev.key === 'ArrowLeft') { ev.preventDefault(); this.show(SECTIONS[(i + SECTIONS.length - 1) % SECTIONS.length].id); }
        },
      }, h('span', { 'aria-hidden': 'true', text: s.icon }))));

      const parts = [];
      for (const view of reg.views[this.section] || []) {
        try { const node = view(ctx); if (node) parts.push(node); } catch (err) { /* one feature failing never breaks the menu */ }
      }
      const items = reg.items.filter(item => item.section === this.section && (!item.when || safe(() => item.when(ctx))));
      if (items.length) {
        parts.push(h('div', { class: 'app-items', role: 'menu' }, ...items.map(item => h('button', {
          class: 'menu-item', type: 'button', role: 'menuitem', 'data-id': item.id,
          onclick: ev => {
            ev.stopPropagation();
            if (!item.keepOpen) this.close();
            item.run(ctx);
          },
        }, h('span', { class: 'menu-icon', 'aria-hidden': 'true', text: resolve(item.icon, ctx) }), t(resolve(item.label, ctx))))));
      }
      if (this.section === 'settings') parts.push(this.renderSettings());
      if (!parts.length) parts.push(h('p', { class: 'app-empty', text: t('section.empty') }));

      this.el.replaceChildren(
        h('header', { class: 'app-head' }, h('b', { text: t(`section.${this.section}`) }),
          h('button', { class: 'px-btn icon', type: 'button', 'aria-label': t('settings.close'), title: t('settings.close'), onclick: () => this.close() }, '×')),
        tabs,
        h('div', { class: 'app-body', role: 'tabpanel' }, ...parts),
      );
    }

    renderSettings() {
      const { h } = this;
      const ctx = this.ctx;
      const S = Mochi.settings;
      const rows = reg.settings.filter(s => !s.when || safe(() => s.when(ctx))).map(s => {
        const label = t(s.label);
        const id = `set-${s.path || s.id}`;
        if (s.type === 'toggle') {
          const on = !!S.get(s.path);
          return h('button', {
            class: 'set-row toggle', type: 'button', role: 'switch', 'aria-checked': String(on), 'data-path': s.path,
            onclick: async () => { await S.set(s.path, !on); s.after?.(!on, ctx); },
          }, h('span', { text: label }), h('i', { class: 'switch', 'aria-hidden': 'true' }));
        }
        if (s.type === 'select') {
          const options = resolve(s.options, ctx) || [];
          const select = h('select', {
            id, 'data-path': s.path,
            onchange: async ev => { await S.set(s.path, ev.target.value); s.after?.(ev.target.value, ctx); },
          }, ...options.map(([value, key]) => h('option', { value, text: t(key) })));
          select.value = String(S.get(s.path));
          return h('label', { class: 'set-row', for: id }, h('span', { text: label }), select);
        }
        if (s.type === 'range') {
          const input = h('input', {
            id, type: 'range', min: s.min ?? 0, max: s.max ?? 1, step: s.step ?? 0.1, value: S.get(s.path), 'data-path': s.path,
            onchange: async ev => { await S.set(s.path, Number(ev.target.value)); s.after?.(Number(ev.target.value), ctx); },
          });
          return h('label', { class: 'set-row', for: id }, h('span', { text: label }), input);
        }
        if (s.type === 'action') {
          return h('button', { class: 'set-row action', type: 'button', 'data-id': s.id, onclick: () => { this.close(); s.run(ctx); } }, h('span', { text: label }), h('i', { 'aria-hidden': 'true', text: '›' }));
        }
        return null;
      }).filter(Boolean);
      return h('div', { class: 'settings' }, ...rows);
    }
  }

  function safe(fn) { try { return fn(); } catch (_) { return false; } }

  // ——— the built-in entries ———
  reg.addItem({ section: 'mochi', id: 'scan', icon: '⌕', label: 'menu.scan', run: ctx => ctx.actions.scan() });
  reg.addItem({ section: 'mochi', id: 'pick', icon: '⌖', label: 'menu.pick', run: ctx => ctx.actions.pick() });
  reg.addItem({ section: 'mochi', id: 'pocket', icon: '▣', label: 'menu.pocket', run: ctx => ctx.actions.pocket() });
  reg.addItem({ section: 'mochi', id: 'play', icon: '▶', label: 'menu.play', run: ctx => ctx.actions.play() });

  reg.addSetting({
    path: 'lang', type: 'select', label: 'settings.language',
    // A language is listed under its own name ("Русский"); Mochi.t() hands back text that isn't a key unchanged.
    options: () => [['auto', 'settings.language.auto'], ...Mochi.languages()],
  });
  reg.addSetting({ path: 'idleAntics', type: 'toggle', label: 'settings.idleAntics' });
  reg.addSetting({ id: 'reset-position', type: 'action', label: 'settings.resetPosition', run: ctx => ctx.actions.resetPosition() });

  Mochi.Menu = Menu;
})();
