/*
 * Mochi — color themes. Pick a color for Mochi, and a color of its own for
 * each friend (Wardrobe → Colors). A theme sets Mochi's body colors by role
 * (outline, shade, base, light, highlight, accent, accentLight, ink), so every
 * pose, face, outfit and effect follows without new art. The share card
 * shows the chosen colors too.
 *
 * Add a theme: one more entry below with the eight roles, plus a name in the
 * locale files ('color.<id>').
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  const THEMES = {
    orange: { ...Mochi.art.ROLE_DEFAULTS },
    mint: { outline: '#1f5546', shade: '#47ad8a', base: '#77d3b2', light: '#a3e8cf', highlight: '#dcf9ee', accent: '#ff8fa3', accentLight: '#ffd0d9', ink: '#123328' },
    sakura: { outline: '#6b2a43', shade: '#e07fa0', base: '#f5a9c3', light: '#fac6d8', highlight: '#fff0f5', accent: '#79c267', accentLight: '#c9f0bd', ink: '#3d1022' },
    matcha: { outline: '#2f4220', shade: '#6a9645', base: '#8fba63', light: '#b4d68b', highlight: '#e3f2cf', accent: '#f1cd6e', accentLight: '#fbedc0', ink: '#1b2811' },
    blueberry: { outline: '#1e2a5e', shade: '#4760c4', base: '#6b84e4', light: '#9cb0f2', highlight: '#dbe3ff', accent: '#ffcf5a', accentLight: '#ffeab0', ink: '#0f163a' },
    lemon: { outline: '#5c4510', shade: '#dcab1f', base: '#f6d34a', light: '#fae58a', highlight: '#fff8d6', accent: '#ff8a3d', accentLight: '#ffc9a3', ink: '#3a2a06' },
    night: { outline: '#121633', shade: '#3c4795', base: '#5563c0', light: '#7b88dd', highlight: '#b9c1f4', accent: '#ffe066', accentLight: '#fff3b0', ink: '#0a0c22' },
  };
  const ORDER = ['classic', 'orange', 'mint', 'sakura', 'matcha', 'blueberry', 'lemon', 'night'];

  Mochi.settings.define({ colors: {} });

  /** The themes a character can wear: its own look ("classic") first; Mochi's classic is orange. */
  const choicesFor = charId => ORDER.filter(id => !(charId === 'mochi' && id === 'classic'));
  const chosen = charId => {
    const id = Mochi.settings.get(`colors.${charId}`);
    return id && THEMES[id] ? id : charId === 'mochi' ? 'orange' : 'classic';
  };
  /** Role colors for a character, or null for its own classic look. */
  const colorFor = charId => {
    const id = chosen(charId);
    return id === 'classic' ? null : THEMES[id];
  };
  const nameOf = id => Mochi.t(`color.${id}`);

  Mochi.colorThemes = THEMES;
  Mochi.colorFor = colorFor;
  Mochi.colorName = charId => nameOf(chosen(charId));

  function applyAll(ctx) {
    const main = ctx.companion.character;
    if (main) ctx.companion.applyColors(colorFor(main.id));
    const buddy = Mochi.friends?.buddy;
    if (buddy?.character) buddy.applyColors(colorFor(buddy.character.id));
  }

  // ——— Wardrobe → Colors ———
  function swatch(char, themeId, size = 32) {
    const span = document.createElement('span');
    span.className = 'char-art color-art';
    const img = document.createElement('img');
    img.alt = '';
    img.width = img.height = size;
    const colors = { ...Mochi.art.ROLE_DEFAULTS, ...char.colors, ...(themeId === 'classic' ? {} : THEMES[themeId]) };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(Mochi.art.staticSvg({ mood: 'happy', parts: char.parts, colors, size, withShadow: false }))}`;
    span.append(img);
    return span;
  }

  Mochi.menu.addView('wardrobe', ctx => {
    const { h } = Mochi.ui;
    const { main, friend } = Mochi.friends?.resolve() || { main: ctx.companion.character };
    const row = (char, who) => h('div', { class: 'colors-row' },
      h('h4', { class: 'app-sub', text: Mochi.t(who === 'friend' ? 'colors.friend' : 'colors.title', { name: Mochi.t(char.name) }) }),
      h('div', { class: 'ward-grid four color-grid', 'data-for': char.id },
        ...choicesFor(char.id).map(id => {
          const on = chosen(char.id) === id;
          return h('button', {
            class: `ward-tile color-tile${on ? ' on' : ''}`, type: 'button', 'data-color': id, 'aria-pressed': String(on), title: nameOf(id),
            onclick: async () => {
              await Mochi.settings.set(`colors.${char.id}`, id);
              const who_ = who === 'friend' ? Mochi.friends?.buddy : ctx.companion;
              who_?.play('spin');
              who_?.say(Mochi.t('colors.say', { color: nameOf(id) }), 1500);
            },
          }, swatch(char, id), h('span', { class: 'ward-name', text: nameOf(id) }));
        })));
    return h('div', { class: 'colors' }, main ? row(main, 'main') : null, friend ? row(friend, 'friend') : null);
  });

  Mochi.features = Mochi.features || [];
  Mochi.features.push({
    id: 'colors',
    init(ctx) {
      applyAll(ctx);
      ctx.on('characterChanged', () => applyAll(ctx));
      ctx.on('friendChanged', () => applyAll(ctx));
      Mochi.settings.onChange(path => { if (path === 'colors' || path.startsWith('colors.')) applyAll(ctx); });
      // Test page: {"color": ["mint"]} for Mochi, {"color": ["night", "cat"]} for a character.
      Mochi.debugHooks.color = value => {
        const [id, charId = ctx.companion.character?.id || 'mochi'] = Array.isArray(value) ? value : [value];
        return Mochi.settings.set(`colors.${charId}`, id);
      };
    },
  });
})();
