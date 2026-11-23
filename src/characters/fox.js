/*
 * The fox: clever and quick. Big ears, a bushy tail that swishes, a white chin. Pounces when bored,
 * and every so often finds a long answer from Claude very clever indeed.
 */
(() => {
  const Mochi = globalThis.Mochi;
  const { sprite, ROLE, BODY_LEGEND } = Mochi.art;
  const L = { ...BODY_LEGEND, K: ROLE.accent, I: ROLE.accentLight };

  const EAR_L = ['OO....', 'OKO...', 'OKKO..', 'OBIBO.', 'OBIIBO', 'OBBBBO'];
  const EAR_R = ['....OO', '...OKO', '..OKKO', '.OBIBO', 'OBIIBO', 'OBBBBO'];
  const BODY = [
    '..OOOOOOOOOOOO..',
    '.OLLLLLLLLLLLLO.',
    'OLLBBBBBBBBBBDDO',
    'OLBBBBBBBBBBBBDO',
    'OLBBBBBBBBBBBBDO',
    'OBBBBBBBBBBBBBDO',
    'OBBBBBBBBBBBBBDO',
    'OBBBBBBBBBBBBBDO',
    'OHHBBBBBBBBBBHHO',
    'OHHHBBBBBBBBHHHO',
    'OHHHHBBBBBBHHHHO',
    'OHHHHHHHHHHHHHHO',
    'OHHHHHHHHHHHHHHO',
    '.OHHHHHHHHHHHHO.',
    '..OOOOOOOOOOOO..',
  ];
  const TAIL = [
    '....OOO.',
    '...OHHHO',
    '...OHHHO',
    '..OBHHBO',
    '..OBBBBO',
    '.OBBBBBO',
    '.OBBBBDO',
    'OBBBBDO.',
    'OBBBDO..',
    'OBDDO...',
    'OOOO....',
  ];
  const ARM = ['.OO.', 'OBBO', 'OBBO', 'OKKO', '.OO.'];
  const LEG = ['OKKO', 'OKKO', '.OO.'];

  Mochi.characters.register({
    id: 'fox',
    name: 'char.fox.name',
    unlock: { level: 5 },
    colors: { outline: '#4a1d0c', shade: '#c2531b', base: '#ec7a2f', light: '#f6a05a', highlight: '#fff3e3', accent: '#3a2219', accentLight: '#ffe1c4' },
    parts: {
      top: sprite(EAR_L, 12, 11, L) + sprite(EAR_R, 22, 11, L),
      back: sprite(TAIL, 26, 18, L, 'tail'),
      body: sprite(BODY, 12, 17, L),
      armL: sprite(ARM, 8, 23, L),
      armR: sprite(ARM, 28, 23, L),
      legs: sprite(LEG, 14, 32, L, 'leg leg-l') + sprite(LEG, 22, 32, L, 'leg leg-r'),
    },
    phrases: { hello: 'char.fox.hello', poke: 'char.fox.poke', happy: 'char.fox.happy', idle: 'char.fox.idle', thinking: 'char.fox.thinking', curious: 'char.fox.curious' },
    onResponseEnd(text, el, c, engine) {
      // A long, careful answer: the fox is impressed (not every time).
      if ((text || '').length < 1200 || Math.random() > 0.4) return false;
      engine.react({ mood: 'excited', action: 'hop', fx: 'thumb', say: Mochi.tPick('char.fox.clever'), hold: 3500 });
      return true;
    },
    idle: [{
      when: () => true,
      run: c => { c.setMood('curious'); setTimeout(() => { c.play('hop'); c.flashFace({ eyes: 'happy', mouth: 'big' }, 900); c.say(Mochi.tPick('char.fox.pounce'), 1500); }, 700); setTimeout(() => c.setMood('neutral'), 2600); },
    }],
  });
})();
