/*
 * Mochi — outfits (the wardrobe).
 *
 * Every accessory is plain data in one format, so adding one is easy (and
 * the outfit editor exports exactly this, see README → Outfit format):
 *
 *   {
 *     id: 'santa-hat',                 unique, lowercase-with-dashes
 *     name: 'Santa hat',               shown in the wardrobe (or a locale key like 'outfit.santa-hat')
 *     author: 'Mochi',                 who drew it
 *     slot: 'head' | 'face' | 'neck' | 'body',  one item per slot; face items follow Mochi's gaze;
 *                                      body = clothes (drawn over the body, under the face and arms)
 *     unlock: { level: 1 },            the level that unlocks it (see Levels)
 *     season: 'winter',                optional: worn automatically Dec 15 – Jan 7
 *     hide: ['antenna'],               optional: parts of Mochi it covers
 *     at: [x, y],                      top-left on Mochi's 40×40 grid
 *                                      (body: x 12–27, y 17–31 · eyes: y 22–24 · antenna: y 11–16)
 *     pixels: ['..RR..', '.RRRR.'],    one character per pixel, '.' is empty
 *     back: { at, pixels },            optional: a part drawn behind the body (a cape)
 *     palette: { R: '#d93a3a', O: '@outline' },
 *                                      a hex color, or '@role' for Mochi's own colors
 *                                      (@outline @shade @base @light @highlight @accent),
 *                                      which follow Mochi's color theme
 *   }
 *
 * Accessories are drawn inside Mochi's own sprite groups, so they follow
 * every pose and animation: hop, spin, sleep, stretch and the mood faces.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  const OUTFITS = [
    {
      id: 'santa-hat', name: 'outfit.santa-hat', author: 'Mochi', slot: 'head', unlock: { level: 1 }, season: 'winter', hide: ['antenna'],
      at: [10, 6],
      pixels: [
        '..........OOOO......',
        '........OORRRROO.WW.',
        '.......ORRRRRRRROWWW',
        '......ORRRRRRRRRO.WW',
        '.....ORRRRRRRRRO....',
        '....ORRRRRRRRRRO....',
        '...ORRRRRRRRRRRRO...',
        '..ORRRRRRRRRRRRRRO..',
        '..WWWWWWWWWWWWWWWW..',
        '.WWWWWWWWWWWWWWWWWW.',
        '.OWWWWWWWWWWWWWWWWO.',
      ],
      palette: { O: '@outline', R: '#d93a3a', W: '#fff6e6' },
    },
    {
      id: 'scarf', name: 'outfit.scarf', author: 'Mochi', slot: 'neck', unlock: { level: 1 }, season: 'winter',
      at: [11, 28],
      pixels: [
        'OOOOOOOOOOOOOOOOOO',
        'ORRWRRWRRWRRWRRWRO',
        'OOOOOOOOOOOOORRWOO',
        '.............ORRWO',
        '.............OWRRO',
        '.............ORRWO',
        '.............OOOOO',
      ],
      palette: { O: '@outline', R: '#2f9e6e', W: '#fff6e6' },
    },
    {
      // Online friends: both friends can wear it once their friendship reaches level 5.
      id: 'friend-scarf', name: 'outfit.friend-scarf', author: 'Mochi', slot: 'neck', unlock: { level: 1, friendship: 5 },
      at: [11, 28],
      pixels: [
        'OOOOOOOOOOOOOOOOOO',
        'OPPHPPWPPHPPWPPHPO',
        'OOOOOOOOOOOOOPPWOO',
        '.............OPHPO',
        '.............OWPPO',
        '.............OPHPO',
        '.............OOOOO',
      ],
      palette: { O: '@outline', P: '#ff8fb1', H: '#e0245e', W: '#fff6e6' },
    },
    {
      id: 'bow', name: 'outfit.bow', author: 'Mochi', slot: 'head', unlock: { level: 1 },
      at: [9, 14],
      pixels: [
        '.OO...OO.',
        'OPPOKOPPO',
        'OPPPKPPPO',
        'OPPOKOPPO',
        '.OO...OO.',
      ],
      palette: { O: '@outline', P: '#ff7fa8', K: '#d94f7f' },
    },
    {
      // Worn on Mochi's birthday, and unlocked for good that day (src/birthday-party.js).
      id: 'birthday-hat', name: 'outfit.birthday-hat', author: 'Mochi', slot: 'head', unlock: { birthday: true }, hide: ['antenna'],
      at: [15, 4],
      pixels: [
        '....OO....',
        '...OWWO...',
        '...OWWO...',
        '....OO....',
        '...OPPO...',
        '...OYYO...',
        '..OPPPPO..',
        '..OYYYYO..',
        '.OPPBPPPO.',
        '.OYYYYYYO.',
        'OPPPPPBPPO',
        'OYYYYYYYYO',
        'OOOOOOOOOO',
      ],
      palette: { O: '@outline', W: '#fff6e6', P: '#ff6f8e', Y: '#ffd23f', B: '#6b84e4' },
    },
    {
      id: 'sunglasses', name: 'outfit.sunglasses', author: 'Mochi', slot: 'face', unlock: { level: 2 },
      at: [13, 21],
      pixels: [
        'OOOOOOOOOOOOOO',
        'OKSKKO..OKSKKO',
        'OKKKKO..OKKKKO',
        '.OKKO....OKKO.',
      ],
      palette: { O: '#1b1b2b', K: '#2c2c44', S: '#9fb4ff' },
    },
    {
      id: 'headphones', name: 'outfit.headphones', author: 'Mochi', slot: 'head', unlock: { level: 4 }, hide: ['antenna'],
      at: [9, 11],
      pixels: [
        '......OOOOOOOOOO......',
        '....OOGGGGGGGGGGOO....',
        '...OGGOO......OOGGO...',
        '..OGO............OGO..',
        '..OGO............OGO..',
        '..OGO............OGO..',
        '.OOOO............OOOO.',
        'OCCCO............OCCCO',
        'OCCCO............OCCCO',
        'OCHCO............OCHCO',
        'OCCCO............OCCCO',
        'OCCCO............OCCCO',
        '.OOO..............OOO.',
      ],
      palette: { O: '@outline', G: '#3a3f5c', C: '#6fd6c3', H: '#fff6e6' },
    },
    {
      id: 'wizard-hat', name: 'outfit.wizard-hat', author: 'Mochi', slot: 'head', unlock: { level: 8 }, hide: ['antenna'],
      at: [11, 2],
      pixels: [
        '........OO........',
        '.......OPPO.......',
        '.......OPPO.......',
        '......OPPPPO......',
        '......OPYPPO......',
        '.....OPPPPPPO.....',
        '.....OPPPPYPO.....',
        '....OPPPPPPPPO....',
        '....OPPYPPPPPO....',
        '...OPPPPPPPPPPO...',
        '...OPPPPPPPYPPO...',
        '..OPPPPPPPPPPPPO..',
        'OOOOOOOOOOOOOOOOOO',
        'OBBBBBBBBBBBBBBBBO',
        '.OOOOOOOOOOOOOOOO.',
      ],
      palette: { O: '@outline', P: '#7b5cd6', Y: '#ffd84a', B: '#5b3fb8' },
    },

    // ——— 1.32: more hats, glasses and the first clothes (the "body" slot) ———
    {
      id: 'beanie', name: 'outfit.beanie', author: 'Mochi', slot: 'head', unlock: { level: 1 }, hide: ['antenna'],
      at: [12, 9],
      pixels: [
        '......OOOO......',
        '.....OPPPPO.....',
        '.....OPPPPO.....',
        '...OOOOOOOOOO...',
        '..OBBBBBBBBBBO..',
        '.OBWBBBWBBBWBBO.',
        'OBBBBBBBBBBBBBBO',
        'OWWWWWWWWWWWWWWO',
        'OWBWBWBWBWBWBWBO',
        'OOOOOOOOOOOOOOOO',
      ],
      palette: { O: '@outline', B: '#4d96ff', W: '#dbe9ff', P: '#ff6b6b' },
    },
    {
      id: 'round-glasses', name: 'outfit.round-glasses', author: 'Mochi', slot: 'face', unlock: { level: 1 },
      at: [13, 21],
      pixels: [
        '.OOOO....OOOO.',
        'O....OOOO....O',
        'O....O..O....O',
        'O....O..O....O',
        '.OOOO....OOOO.',
      ],
      palette: { O: '#b07a1e' },
    },
    {
      id: 'bow-tie', name: 'outfit.bow-tie', author: 'Mochi', slot: 'neck', unlock: { level: 1 },
      at: [15, 29],
      pixels: [
        'OO.....OO',
        'ORROOORRO',
        'ORRRKRRRO',
        'ORROOORRO',
        'OO.....OO',
      ],
      palette: { O: '@outline', R: '#e63946', K: '#a4161a' },
    },
    {
      id: 'overalls', name: 'outfit.overalls', author: 'Mochi', slot: 'body', unlock: { level: 1 },
      at: [12, 26],
      pixels: [
        '...J........J...',
        '...J........J...',
        '..JY........YJ..',
        'OJJJJJJJJJJJJJJO',
        '.OJJJJKKKKJJJJO.',
        '..OOOOOOOOOOOO..',
      ],
      palette: { O: '@outline', J: '#4f7cc4', K: '#3b5f9c', Y: '#ffd23f' },
    },
    {
      id: 'flower-crown', name: 'outfit.flower-crown', author: 'Mochi', slot: 'head', unlock: { level: 2 }, hide: ['antenna'],
      at: [11, 14],
      pixels: [
        '..P.....Y.....P...',
        '.PWP.G.YWY.G.PWP..',
        '..PGGGGGYGGGGGPG..',
        '..G..........G....',
      ],
      palette: { P: '#ff8fab', W: '#fff6e6', Y: '#ffd23f', G: '#5fbf4a' },
    },
    {
      id: 'cap', name: 'outfit.cap', author: 'Mochi', slot: 'head', unlock: { level: 2 }, hide: ['antenna'],
      at: [12, 10],
      pixels: [
        '.....OOOOOO.....',
        '...OORRRRRROO...',
        '..ORRRRWWRRRRO..',
        '.ORRRRRWWRRRRRO.',
        '.ORRRRRRRRRRRRO.',
        'OOOOOOOOOOOOOOOO',
        'ODDDDDDDDDDDDDDO',
        '.OOOOOOOOOOOOOO.',
      ],
      palette: { O: '@outline', R: '#e63946', W: '#fff6e6', D: '#b02a37' },
    },
    {
      id: 'heart-glasses', name: 'outfit.heart-glasses', author: 'Mochi', slot: 'face', unlock: { level: 3 },
      at: [12, 20],
      pixels: [
        '.OO.OO....OO.OO.',
        'OPWOPPOOOOPWOPPO',
        'OPPPPPO..OPPPPPO',
        '.OPPPO....OPPPO.',
        '..OPO......OPO..',
        '...O........O...',
      ],
      palette: { O: '#8c1c3a', P: '#ff6f8e', W: '#ffd3dd' },
    },
    {
      id: 'tutu', name: 'outfit.tutu', author: 'Mochi', slot: 'body', unlock: { level: 3 },
      at: [9, 30],
      pixels: [
        '.OPPWPPWPPWPPWPPWPPWO.',
        'OPWPPWPPWPPWPPWPPWPPWO',
        'OPPOPPOPPOPPOPPOPPOPPO',
        '.OO.OO.OO.OO.OO.OO.OO.',
      ],
      palette: { O: '#b24a7a', P: '#ffb3d1', W: '#ffe3ef' },
    },
    {
      id: 'nerd-glasses', name: 'outfit.nerd-glasses', author: 'Mochi', slot: 'face', unlock: { level: 4 },
      at: [13, 21],
      pixels: [
        'OOOOOO..OOOOOO',
        'O....OWWO....O',
        'O....O..O....O',
        'O....O..O....O',
        'OOOOOO..OOOOOO',
      ],
      palette: { O: '#1b1b2b', W: '#fff6e6' },
    },
    {
      id: 'cowboy-hat', name: 'outfit.cowboy-hat', author: 'Mochi', slot: 'head', unlock: { level: 5 }, hide: ['antenna'],
      at: [8, 8],
      pixels: [
        '........OOOOOOOO........',
        '.......OBBBBBBBBO.......',
        '......OBBBBDDBBBBO......',
        '......OBBBBBBBBBBO......',
        '......ORRRRRRRRRRO......',
        'OO....OBBBBBBBBBBO....OO',
        'OBOOOOOOOOOOOOOOOOOOOOBO',
        '.OBBBBBBBBBBBBBBBBBBBBO.',
        '..OOOOOOOOOOOOOOOOOOOO..',
      ],
      palette: { O: '@outline', B: '#b5793f', D: '#8b5a2b', R: '#5a3a1a' },
    },
    {
      id: 'cape', name: 'outfit.cape', author: 'Mochi', slot: 'body', unlock: { level: 6 },
      // The collar shows at the shoulders; the cape itself hangs behind Mochi.
      at: [11, 17],
      pixels: [
        'OO................OO',
        'ORO..............ORO',
      ],
      back: {
        at: [8, 18],
        pixels: [
          '..OOOOOOOOOOOOOOOOOOOO..',
          ...Array(6).fill('.ORRRRRRRRRRRRRRRRRRRRO.'),
          ...Array(7).fill('ODRRRRRRRRRRRRRRRRRRRRDO'),
          'ODDO................ODDO',
          'ODO..................ODO',
          'OO....................OO',
        ],
      },
      palette: { O: '@outline', R: '#e63946', D: '#a4161a' },
    },
    {
      id: '3d-glasses', name: 'outfit.3d-glasses', author: 'Mochi', slot: 'face', unlock: { level: 7 },
      at: [13, 21],
      pixels: [
        'OOOOOOOOOOOOOO',
        'ORRRRO..OBBBBO',
        'ORRRRO..OBBBBO',
        'OOOOOO..OOOOOO',
      ],
      palette: { O: '#f4f1ea', R: '#ff4d4d', B: '#4dc3ff' },
    },
    {
      id: 'top-hat', name: 'outfit.top-hat', author: 'Mochi', slot: 'head', unlock: { level: 9 }, hide: ['antenna'],
      at: [12, 6],
      pixels: [
        '..OOOOOOOOOOOO..',
        '..OKKKKKKKKKKO..',
        '..OKSKKKKKKKKO..',
        '..OKSKKKKKKKKO..',
        '..OKKKKKKKKKKO..',
        '..ORRRRRRRRRRO..',
        '..ORRRRRRRRRRO..',
        '..OKKKKKKKKKKO..',
        'OOOOOOOOOOOOOOOO',
        'OKKKKKKKKKKKKKKO',
        'OOOOOOOOOOOOOOOO',
      ],
      palette: { O: '#14141f', K: '#2b2b3a', S: '#5a5a78', R: '#e63946' },
    },
    {
      id: 'monocle', name: 'outfit.monocle', author: 'Mochi', slot: 'face', unlock: { level: 11 },
      at: [22, 21],
      pixels: [
        '.OOOO.',
        'O....O',
        'O....O',
        'O....O',
        '.OOOO.',
        '.....O',
        '.....O',
        '....O.',
      ],
      palette: { O: '#d4a017' },
    },
    {
      id: 'crown', name: 'outfit.crown', author: 'Mochi', slot: 'head', unlock: { level: 15 }, hide: ['antenna'],
      at: [14, 10],
      pixels: [
        'OO...OO...OO',
        'OYO.OYYO.OYO',
        'OYYOYYYYOYYO',
        'OYYYYYYYYYYO',
        'OYRYYBBYYRYO',
        'OYYYYYYYYYYO',
        'OOOOOOOOOOOO',
      ],
      palette: { O: '@outline', Y: '#ffd23f', R: '#e63946', B: '#4cc9f0' },
    },
  ];

  const SLOTS = ['head', 'face', 'neck', 'body'];
  const custom = []; // outfits made in the outfit editor (feature 16)

  const all = () => [...OUTFITS, ...custom];
  const byId = id => all().find(o => o.id === id);

  /** Is today in the winter window (Dec 15 – Jan 7, local date)? */
  function isWinter(day = Mochi.store.today()) {
    const [, m, d] = day.split('-').map(Number);
    return (m === 12 && d >= 15) || (m === 1 && d <= 7);
  }

  const color = (value, silhouette) => {
    if (silhouette) return 'var(--ui-line)';
    if (typeof value === 'string' && value.startsWith('@')) return Mochi.art.ROLE[value.slice(1)] || Mochi.art.ROLE.outline;
    return value;
  };

  /** The SVG markup for one accessory, at its place on Mochi's grid. */
  function markup(outfit, { silhouette = false } = {}) {
    const legend = {};
    for (const [ch, value] of Object.entries(outfit.palette || {})) legend[ch] = color(value, silhouette);
    // An optional back part ({ at, pixels }, same palette) is drawn behind the body: a cape.
    const back = outfit.back ? Mochi.art.sprite(outfit.back.pixels, outfit.back.at[0], outfit.back.at[1], legend, 'outfit-back') : '';
    return Mochi.art.sprite(outfit.pixels, outfit.at[0], outfit.at[1], legend, `outfit outfit-${outfit.id}`) + back;
  }

  /** A small standalone SVG of one accessory (wardrobe tiles, the editor). */
  function thumbnail(outfit, { silhouette = false, size = 56 } = {}) {
    // The box around every part (the front, and the back part of a cape).
    // Clothes are shown on a faint body, so a skirt isn't just a pink line.
    const onBody = outfit.slot === 'body';
    const parts = [outfit, outfit.back, onBody && { at: [12, 17], pixels: Array(15).fill('.'.repeat(16)) }].filter(Boolean);
    const x0 = Math.min(...parts.map(p => p.at[0])), y0 = Math.min(...parts.map(p => p.at[1]));
    const x1 = Math.max(...parts.map(p => p.at[0] + Math.max(...p.pixels.map(r => r.length))));
    const y1 = Math.max(...parts.map(p => p.at[1] + p.pixels.length));
    const w = x1 - x0, h = y1 - y0;
    const side = Math.max(w, h) + 2;
    const x = x0 - (side - w) / 2, y = y0 - (side - h) / 2;
    const backs = [];
    const front = markup(outfit, { silhouette }).replace(/<g class="outfit-back">[\s\S]*?<\/g>/g, m => { backs.push(m); return ''; });
    const back = backs.join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${side} ${side}" width="${size}" height="${size}" shape-rendering="crispEdges"${silhouette ? ' opacity=".4"' : ''}>${back}${onBody ? `<g opacity=".3">${Mochi.art.MOCHI_PARTS.body.replace(/style="fill:[^"]*"/g, 'style="fill:var(--ui-line)"')}</g>` : ''}${front}</svg>`;
  }

  /** What Mochi wears now: the user's picks, plus the winter set in season. */
  function wearing() {
    const chosen = Mochi.settings.get('outfit') || {};
    const out = {};
    if (Mochi.settings.get('seasonal') !== false && isWinter()) {
      for (const o of all()) if (o.season === 'winter') out[o.slot] = o.id;
    }
    for (const slot of SLOTS) {
      if (slot in chosen) out[slot] = chosen[slot]; // the user's own pick (or "nothing") wins
    }
    return SLOTS.map(slot => byId(out[slot])).filter(o => o && isUnlocked(o));
  }

  const level = () => Mochi.progress?.level?.() ?? 1;
  const isUnlocked = o => {
    if (o.custom) return true;
    if (o.season === 'winter' && isWinter()) return true;
    if (o.unlock?.friendship) return (Mochi.onlineBestFriendship?.() || 0) >= o.unlock.friendship;
    if (o.unlock?.birthday) return !!Mochi.birthday?.hatUnlocked?.();
    return (o.unlock?.level ?? 1) <= level();
  };
  // How a locked outfit says what it needs: a level, or a friendship level (online friends).
  const lockText = (o, key) => (o.unlock?.birthday ? Mochi.t(`wardrobe.birthday${key[0].toUpperCase()}${key.slice(1)}`) : o.unlock?.friendship ? Mochi.t(`wardrobe.friend${key[0].toUpperCase()}${key.slice(1)}`, { level: o.unlock.friendship }) : Mochi.t(`wardrobe.${key}`, { level: o.unlock?.level ?? 1 }));

  // Things a feature puts on for a while (focus glasses): slot → outfit. They cover that slot, then come off.
  const overrides = {};
  function apply(companion) {
    const worn = wearing();
    const shown = SLOTS.map(slot => overrides[slot] || worn.find(o => o.slot === slot)).filter(Boolean);
    companion.setOutfit(shown.map(o => ({ slot: o.slot, markup: markup(o), hide: o.hide || [] })));
    companion.setSnow(Mochi.settings.get('seasonal') !== false && isWinter());
  }

  async function wear(outfit) {
    const chosen = { ...(Mochi.settings.get('outfit') || {}) };
    const isOn = wearing().some(o => o.id === outfit.id);
    chosen[outfit.slot] = isOn ? null : outfit.id;
    await Mochi.settings.set('outfit', chosen);
    return !isOn;
  }

  Mochi.settings.define({ outfit: {}, seasonal: true });

  Mochi.outfits = { OUTFITS, SLOTS, all, byId, custom, markup, thumbnail, wearing, isWinter, isUnlocked, apply, wear, overrides };

  // ——— the Wardrobe section of the menu ———
  Mochi.menu.addView('wardrobe', ctx => {
    const { h } = Mochi.ui;
    const worn = new Set(wearing().map(o => o.id));
    const tile = o => {
      const unlocked = isUnlocked(o);
      const name = Mochi.t(o.name);
      const tile = h('button', {
        class: `ward-tile${worn.has(o.id) ? ' on' : ''}${unlocked ? '' : ' locked'}`, type: 'button', 'data-outfit': o.id,
        'aria-pressed': String(worn.has(o.id)), 'aria-disabled': String(!unlocked),
        title: unlocked ? name : lockText(o, 'locked'),
        onclick: async () => {
          if (!unlocked) { ctx.companion.say(lockText(o, 'lockedSay'), 1800); return; }
          const on = await wear(o);
          ctx.companion.play(on ? 'hop' : 'wiggle');
          if (on) ctx.companion.say(Mochi.tPick('wardrobe.wearSay'), 1500);
        },
      });
      const art = h('span', { class: 'ward-art', 'aria-hidden': 'true' });
      art.innerHTML = thumbnail(o, { silhouette: !unlocked }); // built from our own outfit data only
      tile.append(art, h('span', { class: 'ward-name', text: unlocked ? name : lockText(o, 'level') }));
      return tile;
    };
    // Grouped by slot: hats, glasses, neck, clothes.
    const groups = SLOTS.map(slot => {
      const list = all().filter(o => o.slot === slot);
      return list.length ? [h('h4', { class: 'app-sub ward-sub', 'data-slot': slot, text: Mochi.t(`wardrobe.slot.${slot}`) }), h('div', { class: 'ward-grid', 'data-slot': slot }, ...list.map(tile))] : [];
    }).flat();
    const season = isWinter() && Mochi.settings.get('seasonal') !== false ? h('p', { class: 'note ward-note', text: Mochi.t('wardrobe.seasonOn') }) : null;
    return h('div', { class: 'wardrobe' },
      ...groups,
      season,
      h('div', { class: 'row' }, h('button', {
        class: 'px-btn', type: 'button', 'data-act': 'undress',
        onclick: async () => { await Mochi.settings.set('outfit', Object.fromEntries(SLOTS.map(slot => [slot, null]))); ctx.companion.play('wiggle'); },
      }, Mochi.t('wardrobe.takeOff'))));
  });

  Mochi.menu.addSetting({ path: 'seasonal', type: 'toggle', label: 'settings.seasonal' });

  Mochi.features = Mochi.features || [];
  Mochi.features.push({
    id: 'outfits',
    init(ctx) {
      apply(ctx.companion);
      Mochi.settings.onChange(path => { if (path === 'outfit' || path.startsWith('outfit.') || path === 'seasonal') apply(ctx.companion); });
      ctx.on('dayChanged', () => apply(ctx.companion));
      ctx.on('levelUp', () => apply(ctx.companion));
      ctx.on('outfitsChanged', () => apply(ctx.companion));
      // The season can begin while a tab stays open: look again every few minutes.
      let lastDay = Mochi.store.today();
      ctx.on('tick', () => { const d = Mochi.store.today(); if (d !== lastDay) { lastDay = d; ctx.emit('dayChanged'); } });

      Mochi.debugHooks.today = (value, c) => { Mochi.store.setToday(value || null); c.emit('dayChanged'); };
      Mochi.debugHooks.outfit = async (value, c) => {
        if (value === 'none') await Mochi.settings.set('outfit', Object.fromEntries(SLOTS.map(slot => [slot, null])));
        else { const o = byId(value); if (o) await Mochi.settings.set('outfit', { ...(Mochi.settings.get('outfit') || {}), [o.slot]: o.id }); }
        apply(c.companion);
      };
    },
  });
})();
