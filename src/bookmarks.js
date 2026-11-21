/*
 * Mochi — answer bookmarks (claude.ai).
 *
 * Hover one of Claude's answers and a little pin appears beside it: press it
 * to keep that answer (the chat's address, its title, the first lines of the
 * answer and the date). Menu → Tools → Bookmarks lists them; Open goes to the
 * chat and scrolls to the answer by finding those first lines again.
 * "Bookmark the last answer" in the same menu does it from the keyboard.
 *
 * The pin is drawn in Mochi's own layer over the page: claude.ai's page is
 * never changed. Saved only in your browser. Settings → Bookmark pins.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const KEY = 'bookmarks.list';
  const PENDING = 'bookmarks.pending';
  const MAX = 200;

  const norm = text => String(text || '').replace(/\s+/g, ' ').trim();
  const pageUrl = () => location.href.split('#')[0];
  const chatTitle = () => norm(document.title.replace(/^✓ /, '').replace(/\s*[-–|]\s*Claude\s*$/i, '')) || 'Claude';

  const list = async () => (await Mochi.store.get(KEY, [])).filter(b => b && b.url && b.excerpt);
  const remove = id => Mochi.store.update(KEY, (items = []) => items.filter(b => b.id !== id), []);

  function answers() {
    for (const sel of Mochi.config.selectors.assistantMessage) {
      try { const found = document.querySelectorAll(sel); if (found.length) return [...found]; } catch (_) { /* next */ }
    }
    return [];
  }
  const answerAt = target => {
    for (const sel of Mochi.config.selectors.assistantMessage) {
      try { const el = target?.closest?.(sel); if (el) return el; } catch (_) { /* next */ }
    }
    return null;
  };
  /** The answer whose text starts like this excerpt (or contains its start). */
  function findAnswer(excerpt) {
    const key = norm(excerpt).slice(0, 80);
    if (!key) return null;
    const all = answers();
    return all.find(el => norm(el.textContent).startsWith(key)) || all.find(el => norm(el.textContent).includes(key.slice(0, 50))) || null;
  }

  Mochi.settings.define({ bookmarks: { pin: true } });
  Mochi.menu.addSetting({ path: 'bookmarks.pin', type: 'toggle', label: 'settings.bookmarkPins', when: ctx => ctx.isClaude });
  Mochi.menu.addItem({ section: 'tools', id: 'bookmarks', icon: '⚑', label: 'menu.bookmarks', run: () => Mochi.bookmarks.open?.() });
  Mochi.menu.addItem({ section: 'tools', id: 'bookmark-last', icon: '✚', label: 'menu.bookmarkLast', when: ctx => ctx.isClaude, run: () => Mochi.bookmarks.addLast?.() });
  Mochi.bookmarks = { list, remove, findAnswer, norm };

  Mochi.features = Mochi.features || [];
  Mochi.features.push({
    id: 'bookmarks',
    init(ctx) {
      const { companion, panel, isClaude } = ctx;
      const { h, shortDate } = Mochi.ui;
      const t = Mochi.t;

      // ——— saving ———
      async function add(el) {
        const text = norm(el?.textContent);
        if (!text) return null;
        const excerpt = text.slice(0, 220);
        const url = pageUrl();
        const items = await list();
        const dupe = items.find(b => b.url === url && b.excerpt.slice(0, 80) === excerpt.slice(0, 80));
        if (dupe) { companion.say(t('bookmarks.already'), 1600); return dupe; }
        const b = { id: `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, url, title: chatTitle().slice(0, 120), excerpt, at: new Date().toISOString() };
        await Mochi.store.set(KEY, [b, ...items].slice(0, MAX));
        companion.play('hop');
        companion.flashFace({ eyes: 'happy', mouth: 'smile' }, 1000);
        companion.say(t('bookmarks.saved'), 1600);
        ctx.emit('bookmarked', b);
        return b;
      }
      Mochi.bookmarks.add = add;
      Mochi.bookmarks.addLast = () => {
        const last = answers().at(-1);
        if (!last) { companion.say(t('bookmarks.noAnswer'), 1800); return null; }
        return add(last);
      };

      // ——— going back to one ———
      let glow = null;
      function highlight(el) {
        // Short answers land in the middle; long ones at the top (so their first lines show).
        el.scrollIntoView({ block: el.getBoundingClientRect().height < innerHeight * 0.6 ? 'center' : 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        glow?.remove();
        glow = h('div', { class: 'bm-glow', 'aria-hidden': 'true' });
        companion.shadow.append(glow);
        const follow = () => {
          if (!glow) return;
          const r = el.getBoundingClientRect();
          Object.assign(glow.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${Math.min(r.height, innerHeight) + 12}px` });
        };
        follow();
        let n = 0;
        const timer = setInterval(() => { follow(); if (++n > 30) { clearInterval(timer); glow?.remove(); glow = null; } }, 100);
        companion.lookAtElement?.(el, 1500);
      }
      async function go(b) {
        if (b.url === pageUrl()) {
          const el = findAnswer(b.excerpt);
          if (el) { panel.close(); highlight(el); } else companion.say(t('bookmarks.notFound'), 2200);
          return;
        }
        await Mochi.store.set(PENDING, { url: b.url, excerpt: b.excerpt, at: Date.now() });
        location.href = b.url;
      }
      // Arrived from a bookmark: wait for the chat to appear, then scroll to the answer.
      async function arrive() {
        const pending = await Mochi.store.get(PENDING, null);
        if (!pending || pending.url !== pageUrl() || Date.now() - pending.at > 2 * 60 * 1000) return;
        await Mochi.store.set(PENDING, null);
        const started = Date.now();
        const tryFind = () => {
          const el = findAnswer(pending.excerpt);
          if (el) { highlight(el); companion.say(t('bookmarks.here'), 1800); return; }
          if (Date.now() - started < 15000) setTimeout(tryFind, 500);
          else companion.say(t('bookmarks.notFound'), 2200);
        };
        tryFind();
      }
      if (isClaude) setTimeout(arrive, 1600); // after the hello

      // ——— the list ———
      async function open() {
        const items = await list();
        const here = pageUrl();
        const body = items.length ? h('ul', { class: 'pocket bm-list' }, ...items.map(b => h('li', { class: 'pk bm-item', 'data-id': b.id },
          h('div', { class: 'pk-title' }, h('b', { text: b.title }), h('span', { text: `${shortDate(b.at)}${b.url === here ? ` · ${t('bookmarks.thisChat')}` : ''}` })),
          h('p', { class: 'bm-excerpt', text: `“${b.excerpt.slice(0, 160)}${b.excerpt.length > 160 ? '…' : ''}”` }),
          h('div', { class: 'row' },
            h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'open', onclick: () => go(b) }, `↗ ${t('bookmarks.open')}`),
            h('button', { class: 'px-btn danger', type: 'button', 'data-act': 'delete', 'aria-label': t('bookmarks.delete'), onclick: async () => { await remove(b.id); open(); } }, '✕')))))
          : h('div', { class: 'empty' }, h('p', { text: t('bookmarks.none') }), h('p', { class: 'note', text: t('bookmarks.hint') }));
        panel.open(t('bookmarks.title'), t('bookmarks.sub'), body, h('span', { text: t('bookmarks.count', { n: items.length }) }));
        panel.view = 'bookmarks';
      }
      Mochi.bookmarks.open = open;

      // ——— the hover pin ———
      if (isClaude) {
        const pin = h('button', { class: 'bm-pin', type: 'button', hidden: true, 'aria-label': t('bookmarks.pin'), title: t('bookmarks.pin') });
        pin.innerHTML = '<svg viewBox="0 0 8 8" width="16" height="16" shape-rendering="crispEdges" aria-hidden="true"><path d="M2 0h4v1h-4zM2 1h1v3h-1zM5 1h1v3h-1zM3 1h2v3h-2zM1 4h6v1h-6zM3 5h2v3h-2z" fill="currentColor"/></svg>';
        companion.shadow.append(pin);
        let current = null, hideTimer = null, frame = 0, lastEv = null;
        const enabled = () => Mochi.settings.get('bookmarks.pin') !== false && !companion.isHidden;
        const place = () => {
          if (!current || !current.isConnected) { pin.hidden = true; current = null; return; }
          const r = current.getBoundingClientRect();
          if (r.bottom < 40 || r.top > innerHeight - 20) { pin.hidden = true; return; }
          // Just outside the answer's right edge (in the page margin), else inside its corner.
          const outside = r.right + 34 < innerWidth;
          pin.style.left = `${Math.round(outside ? r.right + 6 : r.right - 30)}px`;
          pin.style.top = `${Math.round(Math.max(8, r.top + 2))}px`;
          pin.hidden = false;
        };
        const show = el => {
          clearTimeout(hideTimer);
          if (el !== current) {
            current = el;
            list().then(items => { pin.classList.toggle('on', items.some(b => b.url === pageUrl() && b.excerpt.slice(0, 80) === norm(el.textContent).slice(0, 80))); });
          }
          place();
        };
        const hideSoon = () => { clearTimeout(hideTimer); hideTimer = setTimeout(() => { pin.hidden = true; current = null; }, 450); };
        // One look per frame at most; the page is only read, never changed.
        document.addEventListener('pointermove', ev => {
          lastEv = ev;
          if (frame) return;
          frame = requestAnimationFrame(() => {
            frame = 0;
            if (!enabled()) { pin.hidden = true; return; }
            if (lastEv.composedPath?.().includes(pin)) { clearTimeout(hideTimer); return; }
            const el = answerAt(lastEv.target);
            if (el) show(el); else if (current) hideSoon();
          });
        }, { passive: true });
        addEventListener('scroll', () => { if (current && !pin.hidden) place(); }, { capture: true, passive: true });
        pin.addEventListener('mousedown', ev => ev.preventDefault()); // keep focus where it was
        pin.addEventListener('click', async () => { if (current) { await add(current); pin.classList.add('on'); } });
        Mochi.settings.onChange(p => { if (p.startsWith('bookmarks') && !enabled()) pin.hidden = true; });
        Mochi.bookmarks.pin = pin;
      }

      Mochi.debugHooks.bookmarks = async value => {
        if (value === 'open') return open();
        if (value === 'last') return Mochi.bookmarks.addLast();
        if (value === 'clear') { await Mochi.store.set(KEY, []); return open(); }
      };
    },
  });
})();
