/*
 * The ghost: shy (fades when you come close), drifts in and out, and gets
 * spooky at night (9 pm – 6 am, local time).
 */
(() => {
  const Mochi = globalThis.Mochi;
  const { sprite, ROLE, BODY_LEGEND } = Mochi.art;
  const L = { ...BODY_LEGEND };

  const BODY = [
    '....OOOOOOOO....',
    '..OOHHLLLLLLOO..',
    '.OHHLLBBBBBBBDO.',
    'OHLBBBBBBBBBBBDO',
    ...Array(11).fill('OLBBBBBBBBBBBBDO'),
    'OBBBBBBBBBBBBBBO',
    'OBBOBBBOOBBBOBBO',
    '.OO.OOO..OOO.OO.',
  ];
  const NUB_L = ['..OO', 'OOBO', 'OBBO', '.OO.'];
  const NUB_R = ['OO..', 'OBOO', 'OBBO', '.OO.'];
  const isNight = (d = new Date()) => d.getHours() >= 21 || d.getHours() < 6;

  Mochi.characters.register({
    id: 'ghost',
    name: 'char.ghost.name',
    unlock: { level: 10 },
    colors: { outline: '#5d5a8a', shade: '#cfcdf0', base: '#efeefe', light: '#fbfbff', highlight: '#ffffff', accent: '#b9a8ff', accentLight: '#e4dcff' },
    parts: {
      top: '',
      body: sprite(BODY, 12, 15, L),
      armL: sprite(NUB_L, 9, 24, L),
      armR: sprite(NUB_R, 27, 24, L),
      legs: '',
    },
    phrases: { hello: 'char.ghost.hello', poke: 'char.ghost.poke', happy: 'char.ghost.happy', idle: 'char.ghost.idle', surprised: 'char.ghost.surprised', sad: 'char.ghost.sad' },
    moodMap: { excited: 'happy' }, // shy: quietly happy
    idle: [{
      when: () => isNight(Mochi.ghostClock?.() || new Date()),
      run: c => { c.setMood('surprised'); c.play('hop'); c.say(Mochi.tPick('char.ghost.boo'), 1600); setTimeout(() => c.setMood('neutral'), 2200); },
    }],
    tick(c) {
      c.el.dataset.night = isNight(Mochi.ghostClock?.() || new Date()) ? '1' : '';
    },
    isNight,
  });
})();
