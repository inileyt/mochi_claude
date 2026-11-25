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
  // Where each menu item sits — its tab, its group within that tab, and the order inside the group.
  // Kept in one place so the whole menu layout is readable here instead of scattered across features.
  // (A `section` here moves the item to another tab; items not listed keep the tab they registered with.)
  const GROUP_ORDER = ['', 'scan', 'grab', 'claude', 'notes', 'chat'];
  // ✦ Tools open as a short list of categories; clicking one drills into its tools (a "‹" goes back).
  // Each category here is a `group`; the order is the order they appear, with an icon and a label key.
  const TOOL_CATS = [
    { group: 'scan', icon: '🔍', label: 'menu.group.scan' },
    { group: 'grab', icon: '🎯', label: 'menu.group.grab' },
    { group: 'claude', icon: '✨', label: 'menu.group.claude' },
    { group: 'notes', icon: '🗒️', label: 'menu.group.notes' },
    { group: 'chat', icon: '💬', label: 'menu.group.chat' },
  ];
  const LAYOUT = {
    // ☻ Mochi — about Mochi himself: progress, play, pocket, taste.
    play: { order: 1 }, game: { order: 2 }, 'focus-start': { order: 3 }, 'focus-stop': { order: 3 }, pocket: { order: 4 }, taste: { order: 5 }, 'birthday-card': { section: 'mochi', order: 6 },
    // ✦ Tools, grouped by what you do. "Scanners" — read the whole page/image.
    scan: { section: 'tools', group: 'scan', order: 1 }, 'image-scan': { group: 'scan', order: 2 }, 'deep-scan': { section: 'tools', group: 'scan', order: 3 }, anim: { group: 'scan', order: 4 }, broken: { group: 'scan', order: 5 },
    // "Inspect & grab" — pick one thing out of the page.
    pick: { section: 'tools', group: 'grab', order: 1 }, picker: { group: 'grab', order: 2 }, fonts: { group: 'grab', order: 3 }, svg: { group: 'grab', order: 4 },
    // "With Claude" — change the page or report it, through claude.ai.
    'live-edit': { group: 'claude', order: 1 }, guides: { group: 'claude', order: 2 }, bugs: { group: 'claude', order: 3 },
    // "Notes" on this page.
    notes: { group: 'notes', order: 1 }, 'all-notes': { group: 'notes', order: 2 },
    // "In this chat" — your work on claude.ai.
    library: { group: 'chat', order: 1 }, bookmarks: { group: 'chat', order: 2 }, 'bookmark-last': { group: 'chat', order: 3 },
    'export-chat': { group: 'chat', order: 4 }, export: { group: 'chat', order: 5 }, 'guide-last': { group: 'chat', order: 6 },
  };
  const layoutOf = item => LAYOUT[item.id] || {};
  const sectionOf = item => layoutOf(item).section || item.section;
  const t = (k, v) => Mochi.t(k, v);
  const resolve = (v, ctx) => (typeof v === 'function' ? v(ctx) : v);

  class Menu {
    constructor(companion, ctx) {
      this.c = companion;
      this.ctx = { ...ctx, menu: this };
      this.section = 'mochi';
      this.sub = null; // within Tools: the drilled-into category (its group id), or null for the category list
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

    open(arg) {
      // "tools" opens that tab; "tools:grab" opens straight into a category. No arg: reopen, category list first.
      if (arg) { const [sec, sub] = String(arg).split(':'); this.section = sec; this.sub = sub || null; }
      else this.sub = null;
      this.c.bubble.classList.remove('show');
      this.el.hidden = false;
      this.c.el.setAttribute('aria-expanded', 'true');
      this.render();
      this.place();
      this.el.querySelector('.app-tab[aria-selected="true"]')?.focus({ preventScroll: true });
    }

    close() {
      if (!this.isOpen) return;
      this.el.hidden = true;
      this.c.el.setAttribute('aria-expanded', 'false');
    }

    refresh() { if (this.isOpen) this.render(); }

    /** Above Mochi when there's room, else below; toward the side with space; never taller than the window allows. */
    place() {
      const r = this.c.root.getBoundingClientRect();
      const want = Math.min(470, innerHeight * 0.72);
      const above = r.top - 16, below = innerHeight - r.bottom - 16;
      const down = above < want && below > above;
      this.el.classList.toggle('below', down);
      this.el.classList.toggle('from-left', r.right < 280);
      this.el.style.maxHeight = `${Math.max(180, Math.min(want, down ? below : above))}px`;
    }

    show(section) {
      this.section = section;
      this.sub = null; // a fresh tab always starts at its top level
      this.render();
      this.el.querySelector(`.app-tab[data-section="${section}"]`)?.focus({ preventScroll: true });
    }

    render() {
      const { h } = this;
      const ctx = this.ctx;
      const tabs = h('nav', { class: 'app-tabs', role: 'tablist', 'aria-label': t('a11y.sections') }, ...SECTIONS.map(s => h('button', {
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
      const items = reg.items.filter(item => sectionOf(item) === this.section && (!item.when || safe(() => item.when(ctx))));
      if (items.length) {
        const itemButton = item => h('button', {
          class: 'menu-item', type: 'button', role: 'menuitem', 'data-id': item.id,
          onclick: ev => {
            ev.stopPropagation();
            if (!item.keepOpen) this.close();
            item.run(ctx);
          },
        }, h('span', { class: 'menu-icon', 'aria-hidden': 'true', text: resolve(item.icon, ctx) }), t(resolve(item.label, ctx)));
        // Bucket by group, order within each.
        const groups = new Map();
        for (const item of items) { const g = layoutOf(item).group || ''; (groups.get(g) || groups.set(g, []).get(g)).push(item); }
        const ordered = g => (groups.get(g) || []).sort((a, b) => (layoutOf(a).order ?? 99) - (layoutOf(b).order ?? 99));
        const rank = g => { const i = GROUP_ORDER.indexOf(g); return i < 0 ? GROUP_ORDER.length : i; };
        const body = h('div', { class: 'app-items', role: 'menu' });
        if (this.section === 'tools') {
          // Tools drill down: a short list of categories, each opening its own list with a "‹" back row.
          const cats = TOOL_CATS.filter(c => ordered(c.group).length);
          if (this.sub && !ordered(this.sub).length) this.sub = null; // the open category emptied (e.g. left claude.ai)
          if (this.sub) {
            body.append(h('button', { class: 'menu-item back', type: 'button', 'data-act': 'cat-back', onclick: ev => { ev.stopPropagation(); this.sub = null; this.render(); } },
              h('span', { class: 'menu-icon', 'aria-hidden': 'true', text: '‹' }), t('section.tools')));
            for (const item of ordered(this.sub)) body.append(itemButton(item));
          } else {
            for (const cat of cats) body.append(h('button', {
              class: 'menu-item cat', type: 'button', 'data-cat': cat.group, 'aria-haspopup': 'true',
              onclick: ev => { ev.stopPropagation(); this.sub = cat.group; this.render(); },
            }, h('span', { class: 'menu-icon', 'aria-hidden': 'true', text: cat.icon }), h('span', { class: 'cat-label', text: t(cat.label) }), h('i', { class: 'cat-chev', 'aria-hidden': 'true', text: '›' })));
          }
        } else {
          // Other tabs: a flat list, with a small heading above any named group.
          for (const g of [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))) {
            if (g) body.append(h('p', { class: 'app-sub app-group', role: 'presentation', text: t(`menu.group.${g}`) }));
            for (const item of ordered(g)) body.append(itemButton(item));
          }
        }
        parts.push(body);
      }
      if (this.section === 'settings') parts.push(this.renderSettings());
      if (!parts.length) parts.push(h('p', { class: 'app-empty', text: t('section.empty') }));

      const headText = this.section === 'tools' && this.sub ? t(TOOL_CATS.find(c => c.group === this.sub)?.label || `section.${this.section}`) : t(`section.${this.section}`);
      this.el.replaceChildren(
        h('header', { class: 'app-head' }, h('b', { text: headText }),
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
  // ChatGPT / Gemini are turned on from Mochi's options page (Chrome asks there).
  reg.addSetting({
    id: 'chat-sites', type: 'action', label: 'settings.chatSites',
    when: () => !!globalThis.chrome?.runtime?.id,
    run: () => { try { chrome.runtime.sendMessage({ type: 'mochi-sites', method: 'open', section: 'sites' }).catch(() => {}); } catch (_) { /* the extension was reloaded */ } },
  });

  Mochi.Menu = Menu;
})();
