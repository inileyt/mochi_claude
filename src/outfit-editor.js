/*
 * Mochi — the outfit editor. Draw your own accessory on Mochi's 40×40 grid.
 *
 *   Menu → Wardrobe → Outfit editor
 *   - paint with Mochi's own palette (the first six colors are Mochi's body
 *     colors, so the accessory follows his color theme), right-click or the
 *     eraser to remove; Undo (Ctrl+Z) and Clear;
 *   - see it on Mochi in six moods, or "Try on" to watch it on the real Mochi
 *     as he hops, spins and naps;
 *   - "Save to my wardrobe" keeps it in this browser (it shows up in the
 *     wardrobe right away); "Export JSON" gives the exact format of
 *     src/outfits.js, with your name as the author, ready to contribute
 *     (see CONTRIBUTING.md).
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const KEY = 'outfits.custom';
  const N = 40;          // Mochi's grid
  const CELL = 7;        // screen px per grid pixel in the editor
  const MAX_CUSTOM = 30;

  // Mochi's palette: body roles first (they follow the color theme), then fixed colors from his art.
  const P = Mochi.art.PALETTE;
  const PALETTE = [
    ['O', '@outline'], ['D', '@shade'], ['B', '@base'], ['L', '@light'], ['H', '@highlight'], ['A', '@accent'],
    ['G', P.gold], ['K', P.ink], ['W', P.shine], ['P', P.blush], ['M', P.mouthIn], ['R', P.heart], ['T', P.tear], ['Z', P.zzz], ['X', P.alert], ['E', '#ffffff'],
  ];
  const HEX = /^#[0-9a-f]{6}$/i;
  const ROLES = ['outline', 'shade', 'base', 'light', 'highlight', 'accent'];
  const validColor = v => typeof v === 'string' && (HEX.test(v) || (v.startsWith('@') && ROLES.includes(v.slice(1))));
  const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

  /** Checks an outfit (from storage or a file) and returns a clean copy, or null. */
  function clean(o) {
    if (!o || typeof o !== 'object' || !Array.isArray(o.pixels) || !o.palette || typeof o.palette !== 'object') return null;
    const slot = ['head', 'face', 'neck'].includes(o.slot) ? o.slot : null;
    const at = Array.isArray(o.at) ? o.at.map(Number) : [];
    if (!slot || at.length !== 2 || at.some(n => !Number.isInteger(n) || n < 0 || n >= N)) return null;
    const pixels = o.pixels.slice(0, N).map(r => String(r).slice(0, N));
    const palette = {};
    for (const [ch, v] of Object.entries(o.palette)) if (/^[A-Za-z0-9]$/.test(ch) && validColor(v)) palette[ch] = v;
    if (!pixels.some(r => [...r].some(ch => palette[ch]))) return null;
    const id = slug(o.id || o.name) || `outfit-${Date.now().toString(36)}`;
    return {
      id: id.startsWith('my-') ? id : `my-${id}`, name: String(o.name || id).slice(0, 40), author: String(o.author || '').slice(0, 40) || 'me',
      slot, unlock: { level: 1 }, ...(Array.isArray(o.hide) && o.hide.includes('antenna') ? { hide: ['antenna'] } : {}),
      at, pixels, palette, custom: true,
    };
  }

  /** The outfit as it would appear in src/outfits.js (pretty JSON, rows one per line). */
  function toJson(o) {
    const { custom, ...rest } = o;
    const out = { ...rest, id: rest.id.replace(/^my-/, '') };
    return JSON.stringify(out, null, 2)
      .replace(/\[\s+(-?\d+),\s+(-?\d+)\s+\]/g, '[$1, $2]')
      .replace(/"hide": \[\s+"antenna"\s+\]/, '"hide": ["antenna"]')
      .replace(/"unlock": \{\s+"level": (\d+)\s+\}/, '"unlock": { "level": $1 }');
  }

  async function loadCustom() {
    const items = (await Mochi.store.get(KEY, [])).map(clean).filter(Boolean);
    const list = Mochi.outfits.custom;
    list.splice(0, list.length, ...items);
    return items;
  }
  const saveCustom = items => Mochi.store.set(KEY, items.slice(0, MAX_CUSTOM).map(({ custom, ...o }) => o));

  Mochi.outfitEditor = { clean, toJson, PALETTE };
  Mochi.menu.addItem({ section: 'wardrobe', id: 'outfit-editor', icon: '✎', label: 'menu.outfitEditor', run: () => Mochi.outfitEditor.open?.() });

  Mochi.features = Mochi.features || [];
  Mochi.features.push({
    id: 'outfit-editor',
    init(ctx) {
      const { companion, panel } = ctx;
      const { h, copyText, downloadText } = Mochi.ui;
      const t = Mochi.t;

      loadCustom().then(() => Mochi.outfits.apply(companion));
      Mochi.store.watch?.(KEY, () => loadCustom().then(() => { Mochi.outfits.apply(companion); Mochi.menuInstance?.refresh?.(); }));

      // ——— editor state ———
      let grid, history, color, meta, editingId;
      const reset = (o = null) => {
        grid = Array.from({ length: N }, () => Array(N).fill(null));
        if (o) o.pixels.forEach((row, dy) => [...row].forEach((ch, dx) => { if (o.palette[ch] && grid[o.at[1] + dy]) grid[o.at[1] + dy][o.at[0] + dx] = toChar(o.palette[ch]); }));
        history = [];
        color = 'A';
        meta = { name: o?.name || '', author: o?.author || '', slot: o?.slot || 'head', hideAntenna: !!o?.hide?.includes('antenna') };
        editingId = o?.id || null;
      };
      // Each color in a loaded outfit gets the char of the same color in Mochi's palette (or a free one).
      const toChar = value => (PALETTE.find(([, v]) => v.toLowerCase() === String(value).toLowerCase()) || [])[0] || addColor(value);
      const extra = {};
      const addColor = value => { const ch = 'abcdefghijklmnopqrstuvwxyz'.split('').find(c => !extra[c]); extra[ch] = value; return ch; };
      const colorOf = ch => (PALETTE.find(([c]) => c === ch) || [])[1] || extra[ch];
      reset();

      /** The drawing as an outfit object (cropped to what's painted). */
      function build() {
        let x0 = N, y0 = N, x1 = -1, y1 = -1;
        grid.forEach((row, y) => row.forEach((ch, x) => { if (ch) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } }));
        if (x1 < 0) return null;
        const palette = {};
        const pixels = [];
        for (let y = y0; y <= y1; y++) {
          let row = '';
          for (let x = x0; x <= x1; x++) { const ch = grid[y][x]; row += ch || '.'; if (ch) palette[ch] = colorOf(ch); }
          pixels.push(row.replace(/\.+$/, '') || '.');
        }
        const name = meta.name.trim() || t('editor.untitled');
        return clean({ id: editingId || slug(name) || 'outfit', name, author: meta.author.trim() || 'me', slot: meta.slot, hide: meta.hideAntenna ? ['antenna'] : [], at: [x0, y0], pixels, palette });
      }

      // ——— drawing ———
      let canvas, g, guideImg, previews, coordEl, undoBtn;
      const roleColors = () => {
        const cs = getComputedStyle(companion.el);
        const v = r => cs.getPropertyValue(`--m-${r}`).trim();
        return { outline: v('outline'), shade: v('shade'), base: v('base'), light: v('light'), highlight: v('highlight'), accent: v('accent'), accentLight: v('accent-light'), ink: v('ink') };
      };
      const paint = value => (value?.startsWith('@') ? roleColors()[value.slice(1)] : value);

      function draw() {
        if (!g) return;
        const S = CELL * 2; // the canvas is drawn at 2× for crisp pixels
        g.clearRect(0, 0, N * S, N * S);
        const ui = getComputedStyle(companion.host);
        g.fillStyle = ui.getPropertyValue('--soft-bg').trim() || '#ffe9cf';
        g.fillRect(0, 0, N * S, N * S);
        if (guideImg?.complete) { g.globalAlpha = 0.35; g.imageSmoothingEnabled = false; g.drawImage(guideImg, 0, 0, N * S, N * S); g.globalAlpha = 1; }
        grid.forEach((row, y) => row.forEach((ch, x) => { if (ch) { g.fillStyle = paint(colorOf(ch)); g.fillRect(x * S, y * S, S, S); } }));
        g.strokeStyle = 'rgba(128,128,128,.18)'; g.lineWidth = 1;
        for (let i = 0; i <= N; i++) { g.beginPath(); g.moveTo(i * S + 0.5, 0); g.lineTo(i * S + 0.5, N * S); g.moveTo(0, i * S + 0.5); g.lineTo(N * S, i * S + 0.5); g.stroke(); }
      }

      function updatePreviews() {
        if (!previews) return;
        const o = build();
        const colors = roleColors();
        const outfits = o ? [{ slot: o.slot, markup: Mochi.outfits.markup(o), hide: o.hide || [] }] : [];
        previews.replaceChildren(...['neutral', 'happy', 'thinking', 'surprised', 'sad', 'sleeping'].map(mood => {
          const img = h('img', { alt: '', width: '48', height: '48', title: mood });
          img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(Mochi.art.staticSvg({ mood, outfits, colors, size: 48, withShadow: false, parts: companion.character?.parts }))}`;
          return img;
        }));
        if (undoBtn) undoBtn.disabled = !history.length;
      }

      const cellAt = ev => {
        const r = canvas.getBoundingClientRect();
        const x = Math.floor(((ev.clientX - r.left) / r.width) * N), y = Math.floor(((ev.clientY - r.top) / r.height) * N);
        return x >= 0 && y >= 0 && x < N && y < N ? [x, y] : null;
      };
      const snapshot = () => { history.push(grid.map(r => r.slice())); if (history.length > 60) history.shift(); };
      function undo() { if (!history.length) return; grid = history.pop(); draw(); updatePreviews(); }

      function bindCanvas() {
        let painting = null; // the char being painted, or '' to erase
        let last = null;     // the previous cell, so quick strokes leave no gaps
        const line = ([x0, y0], [x1, y1]) => {
          const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
          for (let i = 0; i <= steps; i++) {
            const x = Math.round(x0 + ((x1 - x0) * i) / (steps || 1)), y = Math.round(y0 + ((y1 - y0) * i) / (steps || 1));
            grid[y][x] = painting || null;
          }
        };
        canvas.addEventListener('contextmenu', ev => ev.preventDefault());
        canvas.addEventListener('pointerdown', ev => {
          const c = cellAt(ev);
          if (!c) return;
          canvas.setPointerCapture(ev.pointerId);
          snapshot();
          painting = ev.button === 2 || color === '' ? '' : color;
          grid[c[1]][c[0]] = painting || null;
          last = c;
          draw();
        });
        canvas.addEventListener('pointermove', ev => {
          const c = cellAt(ev);
          coordEl.textContent = c ? `x ${c[0]} · y ${c[1]}` : '';
          if (painting === null || !c) return;
          line(last || c, c);
          last = c;
          draw();
        });
        const end = () => { last = null; if (painting !== null) { painting = null; updatePreviews(); } };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
        canvas.addEventListener('pointerleave', () => { coordEl.textContent = ''; });
      }

      // ——— try on: the real Mochi wears it for a few seconds and moves ———
      let tryTimer = null;
      function tryOn() {
        const o = build();
        if (!o) { companion.say(t('editor.empty'), 1600); return; }
        const before = Mochi.outfits.overrides[o.slot];
        Mochi.outfits.overrides[o.slot] = o;
        Mochi.outfits.apply(companion);
        const steps = [() => companion.play('hop'), () => companion.play('spin'), () => companion.play('wave'), () => companion.setMood('sleeping'), () => companion.setMood('surprised'), () => companion.setMood('happy')];
        clearTimeout(tryTimer);
        let i = 0;
        const next = () => {
          if (i < steps.length) { steps[i++](); tryTimer = setTimeout(next, 1100); return; }
          if (before) Mochi.outfits.overrides[o.slot] = before; else delete Mochi.outfits.overrides[o.slot];
          Mochi.outfits.apply(companion);
          companion.setMood('neutral');
        };
        next();
      }

      // ——— the panel ———
      const quiet = el => { for (const type of ['keydown', 'keyup', 'keypress', 'input']) el.addEventListener(type, ev => { if (ev.type === 'keydown' && (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && el.tagName !== 'INPUT') { ev.preventDefault(); undo(); } ev.stopPropagation(); }); return el; };

      async function open(o = null) {
        reset(o);
        const mine = await loadCustom();
        canvas = h('canvas', { class: 'ed-canvas', width: String(N * CELL * 2), height: String(N * CELL * 2), tabindex: '0', 'aria-label': t('editor.canvas') });
        g = canvas.getContext('2d');
        guideImg = new Image();
        guideImg.onload = draw;
        guideImg.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(Mochi.art.staticSvg({ mood: 'neutral', colors: roleColors(), size: N * CELL * 2, withShadow: false, parts: companion.character?.parts }))}`;
        quiet(canvas);
        coordEl = h('span', { class: 'ed-coord' });
        previews = h('div', { class: 'ed-previews', 'aria-label': t('editor.preview') });
        const swatches = h('div', { class: 'ed-palette', role: 'radiogroup', 'aria-label': t('editor.palette') },
          ...PALETTE.map(([ch, value]) => h('button', {
            class: `ed-swatch${ch === color ? ' on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(ch === color), 'data-color': ch,
            title: value.startsWith('@') ? t('editor.role', { role: value.slice(1) }) : value, style: { background: paint(value) },
            onclick: ev => { color = ch; for (const b of swatches.children) { b.classList.toggle('on', b === ev.currentTarget); b.setAttribute('aria-checked', String(b === ev.currentTarget)); } },
          })),
          h('button', {
            class: 'ed-swatch eraser', type: 'button', role: 'radio', 'aria-checked': 'false', 'data-color': 'erase', title: t('editor.eraser'), text: '⌫',
            onclick: ev => { color = ''; for (const b of swatches.children) { b.classList.toggle('on', b === ev.currentTarget); b.setAttribute('aria-checked', String(b === ev.currentTarget)); } },
          }));
        const field = (label, input) => h('label', { class: 'lib-label' }, label, input);
        const name = quiet(h('input', { class: 'lib-input', type: 'text', maxlength: '40', 'data-field': 'name', placeholder: t('editor.namePh') }));
        name.value = meta.name; name.addEventListener('input', () => { meta.name = name.value; });
        const author = quiet(h('input', { class: 'lib-input', type: 'text', maxlength: '40', 'data-field': 'author', placeholder: t('editor.authorPh') }));
        author.value = meta.author; author.addEventListener('input', () => { meta.author = author.value; });
        const slot = h('select', { class: 'lib-input', 'data-field': 'slot' }, ...['head', 'face', 'neck'].map(s => h('option', { value: s, text: t(`editor.slot.${s}`) })));
        slot.value = meta.slot; slot.addEventListener('change', () => { meta.slot = slot.value; updatePreviews(); });
        const hide = h('input', { type: 'checkbox', 'data-field': 'hide' });
        hide.checked = meta.hideAntenna; hide.addEventListener('change', () => { meta.hideAntenna = hide.checked; updatePreviews(); });
        undoBtn = h('button', { class: 'px-btn', type: 'button', 'data-act': 'undo', onclick: undo }, `↶ ${t('editor.undo')}`);

        const body = h('div', { class: 'editor' },
          h('div', { class: 'ed-row' }, field(t('editor.name'), name), field(t('editor.author'), author)),
          h('div', { class: 'ed-row' }, field(t('editor.slot'), slot), h('label', { class: 'ed-check' }, hide, t('editor.hideAntenna'))),
          swatches,
          h('div', { class: 'ed-stage' }, canvas, h('div', { class: 'ed-side' },
            undoBtn,
            h('button', { class: 'px-btn', type: 'button', 'data-act': 'clear', onclick: () => { snapshot(); grid = grid.map(r => r.fill(null)); draw(); updatePreviews(); } }, `✕ ${t('editor.clear')}`),
            h('button', { class: 'px-btn', type: 'button', 'data-act': 'try', onclick: tryOn }, `▶ ${t('editor.tryOn')}`),
            coordEl)),
          h('p', { class: 'note', text: t('editor.hint') }),
          previews,
          h('div', { class: 'row' },
            h('button', {
              class: 'px-btn primary', type: 'button', 'data-act': 'save-outfit',
              onclick: async () => {
                const o2 = build();
                if (!o2) { companion.say(t('editor.empty'), 1600); return; }
                const list = (await loadCustom()).filter(x => x.id !== o2.id && x.id !== editingId);
                await saveCustom([o2, ...list]);
                editingId = o2.id;
                await loadCustom();
                companion.play('hop');
                companion.say(t('editor.saved'), 1800);
                open(o2);
              },
            }, `＋ ${t('editor.save')}`),
            h('button', {
              class: 'px-btn', type: 'button', 'data-act': 'export-outfit',
              onclick: () => { const o2 = build(); if (!o2) { companion.say(t('editor.empty'), 1600); return; } downloadText(`${o2.id.replace(/^my-/, '')}.json`, `${toJson(o2)}\n`, companion.shadow, 'application/json'); ctx.actions.downloaded(`${o2.id.replace(/^my-/, '')}.json`); },
            }, `⤓ ${t('editor.export')}`),
            h('button', {
              class: 'px-btn', type: 'button', 'data-act': 'copy-outfit',
              onclick: async () => { const o2 = build(); if (!o2) return; if (await copyText(toJson(o2), companion.shadow)) ctx.actions.copied('JSON'); },
            }, `⧉ ${t('editor.copy')}`)),
          mine.length ? h('div', { class: 'ed-mine' },
            h('h4', { class: 'app-sub', text: t('editor.mine') }),
            h('ul', { class: 'pocket' }, ...mine.map(m => {
              const art = h('span', { class: 'ward-art', 'aria-hidden': 'true' });
              art.innerHTML = Mochi.outfits.thumbnail(m, { size: 36 }); // built from our own validated outfit data
              return h('li', { class: 'pk ed-item', 'data-id': m.id },
                h('div', { class: 'pk-head' }, art, h('div', { class: 'pk-title' }, h('b', { text: m.name }), h('span', { text: `${t(`editor.slot.${m.slot}`)} · ${m.author}` }))),
                h('div', { class: 'row' },
                  h('button', { class: 'px-btn', type: 'button', 'data-act': 'edit-outfit', onclick: () => open(m) }, t('library.edit')),
                  h('button', {
                    class: 'px-btn danger', type: 'button', 'data-act': 'delete-outfit', 'aria-label': t('library.deleteName', { name: m.name }),
                    onclick: async () => {
                      await saveCustom(mine.filter(x => x.id !== m.id));
                      const worn = { ...(Mochi.settings.get('outfit') || {}) };
                      if (worn[m.slot] === m.id) { worn[m.slot] = null; await Mochi.settings.set('outfit', worn); }
                      await loadCustom(); Mochi.outfits.apply(companion); open();
                    },
                  }, '✕')));
            }))) : null);
        panel.open(t('editor.title'), t('editor.sub'), body, h('span', { text: t('editor.foot') }));
        panel.view = 'editor';
        bindCanvas();
        draw();
        updatePreviews();
      }

      Mochi.outfitEditor.open = open;
      Mochi.outfitEditor.state = () => ({ painted: grid.flat().filter(Boolean).length, history: history.length, outfit: build() });
      Mochi.outfitEditor.paintCells = (cells, ch = color) => { snapshot(); for (const [x, y] of cells) grid[y][x] = ch || null; draw(); updatePreviews(); };
      Mochi.debugHooks.editor = value => (value === 'open' ? open() : null);
    },
  });
})();
