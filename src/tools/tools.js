/*
 * Mochi — three little tools he holds in his paws: site notes, a color picker and
 * a hover font inspector. This file is the small part that is always there; each
 * tool's code is loaded the first time you use it (Mochi.tools.load: import() of the
 * extension's own file, into Mochi's isolated world), and a tool that is off runs
 * nothing: no listeners, no timers.
 *
 *   await Mochi.tools.open('notes' | 'picker' | 'fonts' | 'allNotes', opts)
 *   Mochi.tools.toggle('fonts')                        (Alt+F, from the background)
 *   Mochi.tools.scope(id) → { on, timeout, interval, raf, dispose }   tracked listeners/timers
 *   Mochi.tools.activeCount(id?)                       how many are alive (0 when off)
 * A tool file registers itself: Mochi.toolImpl[id] = { open(ctx, opts), close(), isOpen }.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const T = (k, v) => Mochi.t(k, v);
  // The files each tool needs (manifest web_accessible_resources lists them).
  const FILES = {
    notes: ['src/tools/notes-store.js', 'src/tools/notes.js'],
    picker: ['src/tools/color-math.js', 'src/tools/picker.js'],
    fonts: ['src/tools/font-detect.js', 'src/tools/inspector.js'],
    liveEdit: ['src/tools/live-css.js', 'src/tools/live-edit.js'],
    guides: ['src/tools/guide-parse.js', 'src/tools/guides.js'],
    taste: ['src/tools/taste.js'],
    bugs: ['src/tools/bug-report.js', 'src/tools/bugs.js'],
    svg: ['src/tools/svg-export.js'],
  };
  // On local test pages Mochi's files are plain <script>s: the tools come the same way, from next to this file.
  const here = document.currentScript?.src || null;
  Mochi.toolImpl = Mochi.toolImpl || {};
  const loading = {};
  let ctxRef = null;

  function load(id) {
    const files = FILES[id];
    if (!files) return Promise.reject(new Error(`unknown tool ${id}`));
    if (Mochi.toolImpl[id]) return Promise.resolve(Mochi.toolImpl[id]);
    if (!loading[id]) {
      loading[id] = (async () => {
        if (globalThis.chrome?.runtime?.id && !here) {
          // In the extension: import() from Mochi's own (isolated) world. The files are web-accessible
          // with a per-session random address (use_dynamic_url), and need no permission.
          for (const f of files) await import(chrome.runtime.getURL(f));
        } else {
          for (const f of files) {
            await new Promise((resolve, reject) => {
              const s = document.createElement('script');
              s.src = new URL(`../../${f}`, here || location.href).href;
              s.onload = resolve; s.onerror = () => reject(new Error(`load ${f}`));
              document.head.append(s);
            });
          }
        }
        if (!Mochi.toolImpl[id]) throw new Error(`tool ${id} did not start`);
        return Mochi.toolImpl[id];
      })().catch(err => { loading[id] = null; throw err; });
    }
    return loading[id];
  }

  // ——— tracked listeners and timers (so "off" really means nothing runs) ———
  const live = {};
  function scope(id) {
    const items = (live[id] = live[id] || new Set());
    const track = undo => { const item = { undo }; items.add(item); return () => { if (items.delete(item)) undo(); }; };
    return {
      on(target, type, fn, opts) { target.addEventListener(type, fn, opts); return track(() => target.removeEventListener(type, fn, opts)); },
      timeout(fn, ms) { let off = null; const t = setTimeout(() => { off?.(); fn(); }, ms); off = track(() => clearTimeout(t)); return off; },
      interval(fn, ms) { const t = setInterval(fn, ms); return track(() => clearInterval(t)); },
      raf(fn) { let off = null; const r = requestAnimationFrame(ts => { off?.(); fn(ts); }); off = track(() => cancelAnimationFrame(r)); return off; },
      dispose() { for (const item of [...items]) { items.delete(item); try { item.undo(); } catch (_) { /* gone */ } } },
      get count() { return items.size; },
    };
  }
  const activeCount = id => (id ? live[id]?.size || 0 : Object.values(live).reduce((n, s) => n + s.size, 0));

  async function open(id, opts = {}) {
    const fileId = id === 'allNotes' ? 'notes' : id;
    try {
      const impl = await load(fileId);
      return impl.open(ctxRef, { ...opts, view: id === 'allNotes' ? 'all' : opts.view });
    } catch (err) {
      ctxRef?.companion.say(T('tools.loadFailed'), 2600);
      return null;
    }
  }
  function toggle(id) {
    const impl = Mochi.toolImpl[id];
    if (impl?.isOpen) { impl.close(); return 'closed'; }
    open(id);
    return 'opened';
  }

  Mochi.tools = { FILES, load, open, toggle, scope, activeCount, isLoaded: id => !!Mochi.toolImpl[id] };

  // ——— the Tools menu ———
  const hasEyeDropper = () => typeof globalThis.EyeDropper === 'function';
  Mochi.menu.addItem({ section: 'tools', id: 'notes', icon: '✎', label: 'menu.notes', run: () => open('notes') });
  Mochi.menu.addItem({ section: 'tools', id: 'all-notes', icon: '▤', label: 'menu.allNotes', run: () => open('allNotes') });
  Mochi.menu.addItem({ section: 'tools', id: 'picker', icon: '◉', label: 'menu.picker', when: hasEyeDropper, run: () => open('picker') });
  Mochi.menu.addItem({ section: 'tools', id: 'fonts', icon: 'Aa', label: 'menu.fonts', run: () => toggle('fonts') });
  Mochi.menu.addItem({ section: 'tools', id: 'live-edit', icon: '✨', label: 'menu.liveEdit', run: () => open('liveEdit') });
  Mochi.menu.addItem({ section: 'tools', id: 'guides', icon: '🧭', label: 'menu.guides', run: () => open('guides') });
  Mochi.menu.addItem({ section: 'tools', id: 'bugs', icon: '🐞', label: 'menu.bugs', run: () => open('bugs') });
  Mochi.menu.addItem({ section: 'tools', id: 'svg', icon: '◇', label: 'menu.svg', run: () => open('svg') });
  Mochi.menu.addItem({ section: 'tools', id: 'guide-last', icon: '▶', label: 'menu.guideLast', when: ctx => ctx.isClaude, run: () => open('guides', { last: true }) });
  Mochi.settings.define({ guides: { offer: true }, taste: { collect: true } });
  Mochi.menu.addItem({ section: 'mochi', id: 'taste', icon: '🎨', label: 'menu.taste', run: () => open('taste') });
  Mochi.menu.addSetting({ path: 'taste.collect', type: 'toggle', label: 'settings.tasteCollect' });
  Mochi.menu.addSetting({ path: 'guides.offer', type: 'toggle', label: 'settings.guideOffer', when: ctx => ctx.isClaude });
  Mochi.menu.addSetting({ id: 'notes-remind', type: 'action', label: 'settings.notesRemind', run: () => chrome.runtime?.sendMessage?.({ type: 'mochi-tools', op: 'openRemind' }) });
  Mochi.settings.define({ notes: { remind: false } });

  // ——— "notes for this page": Mochi holds up a tiny paper with the count ———
  Mochi.features = Mochi.features || [];
  Mochi.features.push({
    id: 'tools',
    async init(ctx) {
      ctxRef = ctx;
      Mochi.tools.ready = true;
      const { companion } = ctx;
      const { h } = Mochi.ui;
      let badge = null, lastUrl = '';
      const count = async () => {
        const n = Mochi.noteUrl.normalize(location.href);
        if (!n) return 0;
        const index = (await Mochi.store.get('notes.index', {})) || {};
        return [`page:${n.page}`, `site:${n.site}`].filter(k => index[k]?.len > 0).length;
      };
      async function refresh() {
        lastUrl = location.href;
        const n = await count().catch(() => 0);
        if (!n) { badge?.remove(); badge = null; return; }
        if (!badge) {
          badge = h('button', { class: 'notes-badge', type: 'button', 'data-act': 'notes-badge', onclick: ev => { ev.stopPropagation(); open('notes'); } });
          companion.root.append(badge);
        }
        badge.textContent = String(n);
        badge.setAttribute('aria-label', T('notes.badge', { n }));
        badge.title = T('notes.badge', { n });
      }
      Mochi.tools.refreshBadge = refresh;

      // ——— your design taste: small notes from what you already do with Mochi (this browser only) ———
      const taste = e => {
        if (Mochi.settings.get('taste.collect') === false) return;
        const clean = { ...e, at: Date.now(), host: location.hostname || 'local' };
        if (!(clean.radius > 0 && clean.radius < 200)) delete clean.radius; // a pill is not a corner taste
        Mochi.store.update('taste.events', (list = []) => [...(Array.isArray(list) ? list : []), clean].slice(-300), []).catch(() => {});
      };
      ctx.on('scanned', scan => taste({ kind: 'scan', colors: (scan.colors || []).map(c => ({ hex: c.hex, role: c.role })), fonts: [scan.typography?.heading?.family, scan.typography?.body?.family].filter(Boolean), vibe: (scan.vibe || []).map(v => v.label), radius: scan.shape?.radii?.[0]?.px, spacing: scan.spacing?.base, theme: scan.theme }));
      ctx.on('picked', cmp => taste({ kind: 'pick', colors: (cmp.colors || []).map(c => ({ hex: c.hex })), fonts: [cmp.style?.font?.family].filter(Boolean), radius: parseFloat(cmp.style?.radius) || null }));
      ctx.on('imageScanned', r => taste({ kind: 'image', colors: (r.palette?.colors || []).slice(0, 5).map(c => ({ hex: c.hex, role: c.role })), fonts: (r.fonts || []).map(f => f.matches?.[0]?.family).filter(Boolean), vibe: r.description?.style ? [r.description.style] : [] }));
      ctx.on('colorPicked', hex => taste({ kind: 'color', colors: [hex] }));
      ctx.on('fontPinned', info => taste({ kind: 'font', fonts: [info.used] }));
      ctx.on('liveKept', css => taste({ kind: 'edit', colors: (String(css).match(/#[0-9a-f]{6}\b/gi) || []).slice(0, 6) }));

      // ——— Live Edit: edits kept for this site/page, and an answer waiting for this page ———
      const here = Mochi.noteUrl.normalize(location.href);
      if (here) {
        const kept = (await Mochi.store.get('liveEdit.kept', [])) || [];
        for (const k of kept) {
          if (k.on === false || !(k.scope === 'page' ? k.page === here.page : k.site === here.site)) continue;
          if (document.querySelector(`style[data-mochi-live="${k.id}"]`)) continue; // the every-site script was first
          const st = document.createElement('style');
          st.setAttribute('data-mochi-live', k.id);
          st.textContent = k.css; // sanitized when it was kept
          (document.head || document.documentElement).append(st);
        }
        // A guide (or a recording) going on in this tab: pick it up again after a page load.
        if (globalThis.chrome?.runtime?.id) {
          chrome.runtime.sendMessage({ type: 'mochi-tools', op: 'guideHere' }).then(r => { if (r?.ok && r.result) open('guides', { resume: true }); }).catch(() => {});
          chrome.runtime.sendMessage({ type: 'mochi-tools', op: 'bugHere' }).then(r => { if (r?.ok && r.result) open('bugs', { resume: true }); }).catch(() => {});
        }
        const result = await Mochi.store.get('liveEdit.result', null);
        if (result && !result.applied && result.session?.page === here.page) open('liveEdit', { result });
      }
      // On claude.ai: when the question Mochi brought is sent, wait for Claude's answer and take its CSS back.
      if (ctx.isClaude) {
        let armed = null;
        ctx.on('userMessage', async text => {
          if (!String(text).includes('[Mochi Live Edit #')) return;
          const pending = await Mochi.store.get('liveEdit.pending', null);
          if (pending && !pending.done && String(text).includes(`#${pending.id}]`)) armed = pending.id;
        });
        // Does an answer plainly carry CSS? (a ```css block, or a code block with a `selector { prop: value }`).
        const answerHasCss = (text, el) => {
          if (/```\s*css/i.test(String(text || ''))) return true;
          const code = [...(el?.querySelectorAll?.('pre code, pre, code') || [])].map(n => n.textContent).join('\n');
          return /[^{}]*\{[^{}]*:[^{}]*;?[^{}]*\}/.test(code);
        };
        // An answer with steps: Mochi offers to make it a guide (a cheap look first; the guide code loads only then).
        ctx.on('responseEnd', async (text, el) => {
          if (armed || Mochi.settings.get('guides.offer') === false) return;
          const steps = el?.querySelectorAll?.('ol > li').length || (String(text).match(/^\s*(?:step\s*)?\d{1,2}[.):]\s+\S/gim) || []).length;
          if (steps < 3) return;
          const impl = await load('guides').catch(() => null);
          impl?.offer(ctx, el, text);
        });
        ctx.on('responseEnd', async (text, el) => {
          let use = armed;
          // Fallback: the marker can be lost (claude.ai reshapes a long message, or trims it), so Mochi
          // would miss its own answer. If a Live Edit question is still waiting and this answer clearly
          // carries CSS, take it anyway — onAnswer only consumes it when it finds real CSS inside.
          if (!use) {
            const pending = await Mochi.store.get('liveEdit.pending', null);
            const fresh = pending && Date.now() - (pending.at || 0) < 15 * 60 * 1000; // not an old, forgotten question
            if (fresh && !pending.done && answerHasCss(text, el)) use = pending.id;
          }
          if (!use) return;
          const impl = await load('liveEdit').catch(() => null);
          if (impl && (await impl.onAnswer(ctx, el, text))) armed = null;
        });
      }
      refresh();
      // Single-page sites (claude.ai) change the address without a reload: check on Mochi's own 5-second tick.
      ctx.on('tick', () => { if (location.href !== lastUrl) refresh(); });
      Mochi.store.watch('notes.index', () => refresh());

      // Test hooks (local pages only).
      Mochi.debugHooks.toolsOpen = async ({ id, ...opts } = {}) => { await open(id, opts); return { loaded: Mochi.tools.isLoaded(id === 'allNotes' ? 'notes' : id) }; };
      // The font inspector's state (loaded or not), and detection on an element (loads the tool's code, not the mode).
      Mochi.debugHooks.fontsState = () => ({ open: false, pinned: false, frames: 0, info: null, tip: null, ...(Mochi.toolImpl.fonts?.state?.() || {}), active: activeCount('fonts'), loaded: !!Mochi.toolImpl.fonts });
      Mochi.debugHooks.fontsInspect = async selector => { await load('fonts'); const el = document.querySelector(selector); return el ? Mochi.fontDetect.inspect(el) : null; };
      Mochi.debugHooks.fontsAt = ({ x, y }) => { const r = Mochi.toolImpl.fonts?.isOpen ? Mochi.toolImpl.fonts.elementAt(x, y) : null; return r ? { tag: r.el.tagName, id: r.el.id, ox: r.ox, oy: r.oy } : null; };
      Mochi.debugHooks.guidesState = () => Mochi.toolImpl.guides?.state || null;
      Mochi.debugHooks.bugsState = () => Mochi.toolImpl.bugs?.state || null;
      Mochi.debugHooks.svgOf = async selector => { await load('svg'); const el = document.querySelector(selector); return el ? Mochi.svgExport.open(ctx, { el }) : null; };
      Mochi.debugHooks.guidesClose = () => { Mochi.toolImpl.guides?.close(); return true; };
      Mochi.debugHooks.toolsState = () => ({ loaded: Object.fromEntries(Object.keys(FILES).map(id => [id, Mochi.tools.isLoaded(id)])), active: Object.fromEntries(Object.keys(FILES).map(id => [id, activeCount(id)])), badge: badge?.textContent || null });
    },
  });
})();
