/*
 * Mochi — the prompt library. Keep the prompts you use again and again.
 *
 *   Menu → Tools → Prompt library
 *   - "Save the message box": keeps what's in claude.ai's message box, with a
 *     name and tags. Or write a new one by hand.
 *   - Search by name, tag (#tag) or words in the prompt.
 *   - Insert puts a prompt into claude.ai's message box (as a paste would)
 *     and never sends it: you press Enter yourself. On other sites: Copy.
 *   - Export / import as a JSON file to back up or share.
 *
 * Saved only in your browser (chrome.storage.local). Format of the JSON file:
 *   { "mochi": "prompt-library", "v": 1, "prompts": [{ "name", "tags": [], "text" }] }
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const KEY = 'library.prompts';
  const MAX = 300;
  const MAX_TEXT = 20000;

  const uid = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const cleanTags = tags => [...new Set((Array.isArray(tags) ? tags : String(tags || '').split(/[,\s]+/))
    .map(t => String(t).trim().replace(/^#/, '').toLowerCase().slice(0, 24)).filter(Boolean))].slice(0, 8);
  const clean = p => ({
    id: typeof p.id === 'string' && p.id ? p.id.slice(0, 40) : uid(),
    name: String(p.name || '').trim().slice(0, 80) || String(p.text || '').trim().split(/\s+/).slice(0, 5).join(' ').slice(0, 80),
    tags: cleanTags(p.tags),
    text: String(p.text || '').slice(0, MAX_TEXT),
    created: Number(p.created) || Date.now(),
    used: Number(p.used) || 0,
  });

  const list = async () => (await Mochi.store.get(KEY, [])).filter(p => p && p.text);
  async function save(prompt) {
    const p = clean(prompt);
    if (!p.text.trim()) return null;
    await Mochi.store.update(KEY, (items = []) => [p, ...items.filter(x => x.id !== p.id)].slice(0, MAX), []);
    return p;
  }
  const remove = id => Mochi.store.update(KEY, (items = []) => items.filter(x => x.id !== id), []);
  const touch = id => Mochi.store.update(KEY, (items = []) => items.map(x => (x.id === id ? { ...x, used: Date.now() } : x)), []);

  /** Search: words must all appear in the name, tags or text; "#tag" must be a tag. */
  function search(items, query) {
    const q = String(query || '').toLowerCase().trim();
    if (!q) return items;
    const parts = q.split(/\s+/);
    return items.filter(p => parts.every(w => (w.startsWith('#') && w.length > 1
      ? p.tags.some(t => t.startsWith(w.slice(1)))
      : `${p.name}\n${p.tags.join(' ')}\n${p.text}`.toLowerCase().includes(w))));
  }

  const exportJson = items => JSON.stringify({ mochi: 'prompt-library', v: 1, exported: new Date().toISOString(), prompts: items.map(({ name, tags, text }) => ({ name, tags, text })) }, null, 2);

  /** Reads an exported file (or a plain array); adds prompts whose text isn't there yet. */
  async function importJson(text) {
    let data;
    try { data = JSON.parse(text); } catch (_) { return { added: 0, error: 'json' }; }
    const incoming = Array.isArray(data) ? data : Array.isArray(data?.prompts) ? data.prompts : null;
    if (!incoming) return { added: 0, error: 'format' };
    const items = await list();
    const have = new Set(items.map(p => p.text.trim()));
    const fresh = [];
    for (const raw of incoming.slice(0, MAX)) {
      if (!raw || typeof raw !== 'object' || typeof raw.text !== 'string' || !raw.text.trim()) continue;
      const p = clean({ ...raw, id: undefined });
      if (have.has(p.text.trim())) continue;
      have.add(p.text.trim());
      fresh.push(p);
    }
    await Mochi.store.set(KEY, [...fresh, ...items].slice(0, MAX));
    return { added: fresh.length };
  }

  Mochi.library = { list, save, remove, search, exportJson, importJson, KEY };
  Mochi.menu.addItem({ section: 'tools', id: 'library', icon: '❏', label: 'menu.library', run: () => Mochi.library.open?.() });

  Mochi.features = Mochi.features || [];
  Mochi.features.push({
    id: 'library',
    init(ctx) {
      const { companion, engine, panel, isClaude } = ctx;
      const { h, copyText, downloadText } = Mochi.ui;
      const t = Mochi.t;
      let query = '';
      let editing = null; // a prompt being written or edited, or null

      const draft = () => {
        const el = isClaude ? Mochi.findEditor?.() : null;
        return el ? (el.value ?? el.innerText ?? '').trim() : '';
      };
      // Typing in Mochi's own fields shouldn't reach the page's keyboard shortcuts.
      const quiet = el => { for (const type of ['keydown', 'keyup', 'keypress', 'input']) el.addEventListener(type, ev => ev.stopPropagation()); return el; };

      async function insert(p) {
        if (isClaude) {
          panel.close();
          const ok = await Mochi.insertIntoComposer(p.text);
          engine.pasted(ok);
        } else {
          const ok = await copyText(p.text, companion.shadow);
          if (ok) ctx.actions.copied(t('library.thePrompt'));
        }
        touch(p.id);
      }

      function form(p) {
        const name = quiet(h('input', { class: 'lib-input', type: 'text', maxlength: '80', 'data-field': 'name', placeholder: t('library.name'), 'aria-label': t('library.name') }));
        const tags = quiet(h('input', { class: 'lib-input', type: 'text', 'data-field': 'tags', placeholder: t('library.tags'), 'aria-label': t('library.tags') }));
        const text = quiet(h('textarea', { class: 'lib-text', rows: '6', 'data-field': 'text', placeholder: t('library.text'), 'aria-label': t('library.text') }));
        name.value = p.name || '';
        tags.value = (p.tags || []).map(x => `#${x}`).join(' ');
        text.value = p.text || '';
        return h('div', { class: 'lib-form pk' },
          h('label', { class: 'lib-label' }, t('library.name'), name),
          h('label', { class: 'lib-label' }, t('library.tags'), tags),
          h('label', { class: 'lib-label' }, t('library.text'), text),
          h('div', { class: 'row' },
            h('button', {
              class: 'px-btn primary', type: 'button', 'data-act': 'save-prompt',
              onclick: async () => {
                if (!text.value.trim()) { companion.say(t('library.empty'), 1800); return; }
                await save({ ...p, name: name.value, tags: tags.value, text: text.value });
                editing = null;
                companion.play('hop');
                companion.say(t('library.saved'), 1600);
                render();
              },
            }, t('library.save')),
            h('button', { class: 'px-btn', type: 'button', 'data-act': 'cancel', onclick: () => { editing = null; render(); } }, t('library.cancel'))));
      }

      function row(p) {
        const preview = p.text.replace(/\s+/g, ' ').slice(0, 140);
        return h('li', { class: 'pk lib-item', 'data-id': p.id },
          h('div', { class: 'pk-title' }, h('b', { text: p.name }), h('span', { class: 'lib-preview', text: preview })),
          p.tags.length ? h('div', { class: 'vibes' }, ...p.tags.map(tag => h('button', { class: 'chip', type: 'button', onclick: () => { query = `#${tag}`; render(); } }, `#${tag}`))) : null,
          h('div', { class: 'row' },
            isClaude
              ? h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'insert', onclick: () => insert(p) }, `✎ ${t('library.insert')}`)
              : h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'copy', onclick: () => insert(p) }, `⧉ ${t('library.copy')}`),
            h('button', { class: 'px-btn', type: 'button', 'data-act': 'edit', onclick: () => { editing = p; render(); } }, t('library.edit')),
            h('button', { class: 'px-btn danger', type: 'button', 'data-act': 'delete', 'aria-label': t('library.deleteName', { name: p.name }), onclick: async () => { await remove(p.id); render(); } }, '✕')));
      }

      async function render(focusSearch = false) {
        const items = await list();
        const shown = search(items, query);
        const searchBox = quiet(h('input', { class: 'lib-input lib-search', type: 'search', placeholder: t('library.search'), 'aria-label': t('library.search'), 'data-field': 'search' }));
        searchBox.value = query;
        searchBox.addEventListener('input', () => {
          query = searchBox.value;
          const ul = body.querySelector('.lib-list');
          const next = search(items, query);
          ul?.replaceChildren(...next.map(row));
          body.querySelector('.lib-none')?.toggleAttribute('hidden', next.length > 0 || !items.length);
        });
        const fileIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
        fileIn.addEventListener('change', async () => {
          const file = fileIn.files?.[0];
          if (!file) return;
          const res = await importJson(await file.text());
          companion.say(res.error ? t('library.importBad') : t('library.imported', { n: res.added }), 2200);
          if (!res.error && res.added) companion.play('hop');
          render();
        });
        const body = h('div', { class: 'library' },
          editing ? form(editing) : h('div', { class: 'row lib-top' },
            isClaude ? h('button', {
              class: 'px-btn primary', type: 'button', 'data-act': 'save-box',
              onclick: () => {
                const text = draft();
                if (!text) { companion.say(t('library.boxEmpty'), 2000); return; }
                editing = { text, name: '', tags: [] };
                render();
              },
            }, `＋ ${t('library.saveBox')}`) : null,
            h('button', { class: 'px-btn', type: 'button', 'data-act': 'new-prompt', onclick: () => { editing = { text: '', name: '', tags: [] }; render(); } }, `＋ ${t('library.new')}`)),
          items.length ? searchBox : null,
          items.length ? h('ul', { class: 'pocket lib-list' }, ...shown.map(row)) : editing ? null : h('div', { class: 'empty' }, h('p', { text: t('library.none') }), h('p', { class: 'note', text: t('library.hint') })),
          h('p', { class: 'note lib-none', hidden: !(items.length && !shown.length), text: t('library.noMatch') }),
          fileIn);
        const foot = h('div', { class: 'row lib-foot' },
          h('span', { text: t('library.count', { n: items.length }) }),
          h('button', {
            class: 'px-btn', type: 'button', 'data-act': 'export', disabled: !items.length,
            onclick: () => { downloadText('mochi-prompts.json', exportJson(items), companion.shadow, 'application/json'); ctx.actions.downloaded('mochi-prompts.json'); },
          }, `⤓ ${t('library.export')}`),
          h('button', { class: 'px-btn', type: 'button', 'data-act': 'import', onclick: () => fileIn.click() }, `⤒ ${t('library.import')}`));
        panel.open(t('library.title'), t('library.sub'), body, foot);
        panel.view = 'library';
        if (focusSearch) body.querySelector('.lib-search')?.focus();
      }

      Mochi.library.open = () => { editing = null; render(); };
      Mochi.debugHooks.library = async value => {
        if (value === 'open') return Mochi.library.open();
        if (value === 'clear') { await Mochi.store.set(KEY, []); return render(); }
        if (value === 'seed') {
          await importJson(JSON.stringify({ prompts: [
            { name: 'Explain like I’m five', tags: ['learn'], text: 'Explain this like I’m five years old, with one everyday example.' },
            { name: 'Code review', tags: ['code', 'review'], text: 'Review this code for bugs, unclear names and missing edge cases. List issues by severity.' },
            { name: 'Краткое резюме', tags: ['summary', 'ru'], text: 'Сделай краткое резюме: 5 пунктов, самое важное сначала.' },
          ] }));
          return render();
        }
      };
    },
  });
})();
