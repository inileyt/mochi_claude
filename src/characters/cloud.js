/*
 * The cloud: a little cloud that floats instead of walking, and wears its mood as weather:
 * a rainbow when it's happy, a little rain when it's sad (CSS on data-mood, styles.js).
 */
(() => {
  const Mochi = globalThis.Mochi;
  const { sprite, ROLE, BODY_LEGEND } = Mochi.art;
  const L = { ...BODY_LEGEND };

  const BODY = [
    '...........OO...........',
    '.........OOHHOO.........',
    '........OHHLLLLO........',
    '.......OHLLBBBBBO.......',
    '.......OHLBBBBBBO.......',
    '....OOOHLBBBBBBBDOOO....',
    '...OHHLLBBBBBBBBDOLLO...',
    '..OHLLBBBBBBBBBBBBBBDO..',
    '..OHLBBBBBBBBBBBBBBBDO..',
    '..OLBBBBBBBBBBBBBBBBDO..',
    '..OLBBBBBBBBBBBBBBBBDO..',
    '.OOLBBBBBBBBBBBBBBBBDOO.',
    'OHLBBBBBBBBBBBBBBBBBBBDO',
    'OLBBBBBBBBBBBBBBBBBBBBDO',
    'OLBBBBBBBBBBBBBBBBBBBBDO',
    'OBBBBBBBBBBBBBBBBBBBBDDO',
    '.ODDDDDDDDDDDDDDDDDDDDO.',
    '..OOOOOOOOOOOOOOOOOOOO..',
  ];
  const NUB_L = ['.OO', 'OBB', '.OO'];
  const NUB_R = ['OO.', 'BBO', 'OO.'];

  Mochi.characters.register({
    id: 'cloud',
    name: 'char.cloud.name',
    unlock: { level: 12 },
    colors: { outline: '#6b7fa8', shade: '#c4d2ec', base: '#e8eefa', light: '#f6f9ff', highlight: '#ffffff', accent: '#8fb8ff', accentLight: '#d6e6ff' },
    parts: {
      top: '',
      body: sprite(BODY, 8, 13, L),
      armL: sprite(NUB_L, 5, 26, L),
      armR: sprite(NUB_R, 32, 26, L),
      legs: '',
    },
    phrases: { hello: 'char.cloud.hello', poke: 'char.cloud.poke', happy: 'char.cloud.happy', idle: 'char.cloud.idle', sad: 'char.cloud.sad', thinking: 'char.cloud.thinking' },
    idle: [{
      when: () => true,
      run: c => { c.setMood('happy'); c.say(Mochi.tPick('char.cloud.float'), 1800); setTimeout(() => c.setMood('neutral'), 2600); },
    }],
  });
})();
