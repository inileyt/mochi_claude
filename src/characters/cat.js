/*
 * The cat: lazy, naps a lot, and knocks things over.
 */
(() => {
  const Mochi = globalThis.Mochi;
  const { sprite, px, ROLE, BODY_LEGEND } = Mochi.art;
  const L = { ...BODY_LEGEND, A: ROLE.accent, I: ROLE.accentLight };

  const EAR_L = ['O....', 'OO...', 'OAO..', 'OAAO.', 'OBBBO'];
  const EAR_R = ['....O', '...OO', '..OAO', '.OAAO', 'OBBBO'];
  const TAIL = ['....OO', '...OBO', '...OBO', '..OBO.', 'OOBBO.', 'OBBO..', 'OOO...'];

  Mochi.characters.register({
    id: 'cat',
    name: 'char.cat.name',
    unlock: { level: 3 },
    colors: { outline: '#3b3346', shade: '#8d8799', base: '#b7b2c2', light: '#d6d2de', highlight: '#f1eff5', accent: '#ff9fb4', accentLight: '#ffd3dd' },
    parts: {
      top: sprite(EAR_L, 12, 13, L) + sprite(EAR_R, 23, 13, L),
      back: sprite(TAIL, 27, 25, L, 'tail'),
      faceExtra:
        px([[19, 26], [20, 26]], ROLE.accent) + // nose
        px([[12, 27], [13, 27], [12, 29], [13, 28], [26, 27], [27, 27], [26, 28], [27, 29]], ROLE.outline, 'whiskers'),
    },
    phrases: { hello: 'char.cat.hello', poke: 'char.cat.poke', happy: 'char.cat.happy', idle: 'char.cat.idle', sleepy: 'char.cat.sleepy', wake: 'char.cat.wake', thinking: 'char.cat.thinking' },
    // Lazy: never too excited, and naps while Claude writes.
    moodMap: { excited: 'happy', focused: 'sleeping' },
    sleepAfter: 60 * 1000,
    idle: [{
      when: () => true,
      run: (c) => {
        c.play('swipe');
        c.flashFx('cup', 1800);
        setTimeout(() => c.say(Mochi.tPick('char.cat.oops'), 1600), 700);
      },
    }],
  });
})();
