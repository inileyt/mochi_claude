/*
 * The penguin: a little waddle, a white tummy, an orange beak and feet. Loves fish and the cold:
 * extra happy in winter (Dec 15 – Jan 7), and slides on its belly when bored.
 */
(() => {
  const Mochi = globalThis.Mochi;
  const { sprite, px, ROLE, BODY_LEGEND } = Mochi.art;
  const W = '#f5f7fb';
  const L = { ...BODY_LEGEND, W, A: ROLE.accent, G: ROLE.accentLight };

  const BODY = [
    '..OOOOOOOOOOOO..',
    '.OLLLLLLLLLLLLO.',
    'OLLBBBBBBBBBBDDO',
    'OLBBWWWBBWWWBBDO',
    'OLBWWWWWWWWWWBDO',
    'OBWWWWWWWWWWWWDO',
    'OBWWWWWWWWWWWWDO',
    'OBWWWWWWWWWWWWDO',
    'OBWWWWWWWWWWWWDO',
    'OBWWWWWWWWWWWWDO',
    'OBWWWWWWWWWWWWDO',
    'OBWWWWWWWWWWWWDO',
    'OBBWWWWWWWWWWDDO',
    '.ODDWWWWWWWWDDO.',
    '..OOOOOOOOOOOO..',
  ];
  const FLIP_L = ['..OO', '.OBO', 'OBBO', 'OBBO', 'OBO.', 'OO..'];
  const FLIP_R = ['OO..', 'OBO.', 'OBBO', 'OBBO', '.OBO', '..OO'];
  const FOOT_L = ['OAAO.', 'OAAAO', '.OOOO'];
  const FOOT_R = ['.OAAO', 'OAAAO', 'OOOO.'];
  const isWinter = () => !!Mochi.outfits?.isWinter?.();

  Mochi.characters.register({
    id: 'penguin',
    name: 'char.penguin.name',
    unlock: { level: 4 },
    colors: { outline: '#141a2a', shade: '#232b45', base: '#334064', light: '#4b5884', highlight: '#7d89b3', accent: '#ff9f1c', accentLight: '#ffd166' },
    parts: {
      top: '',
      body: sprite(BODY, 12, 17, L),
      armL: sprite(FLIP_L, 8, 23, L),
      armR: sprite(FLIP_R, 28, 23, L),
      legs: sprite(FOOT_L, 13, 32, L, 'leg leg-l') + sprite(FOOT_R, 22, 32, L, 'leg leg-r'),
      faceExtra: px([[18, 25], [19, 25], [20, 25], [21, 25]], ROLE.accent, 'beak') + px([[19, 26], [20, 26]], ROLE.accent, 'beak'),
    },
    phrases: { hello: 'char.penguin.hello', poke: 'char.penguin.poke', happy: 'char.penguin.happy', idle: 'char.penguin.idle', thinking: 'char.penguin.thinking', sad: 'char.penguin.sad' },
    idle: [
      { when: () => isWinter(), run: c => { c.setMood('excited'); c.play('celebrate'); c.say(Mochi.tPick('char.penguin.snow'), 1800); setTimeout(() => c.setMood('neutral'), 2600); } },
      { when: () => true, run: c => { c.play('wiggle'); c.flashFx('fish', 2200); c.say(Mochi.tPick('char.penguin.fish'), 1700); } },
    ],
  });
})();
