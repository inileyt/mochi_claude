/*
 * The bunny: long ears, a pink nose, a fluffy tail. Bouncy: happier hops, and a carrot when bored.
 */
(() => {
  const Mochi = globalThis.Mochi;
  const { sprite, px, ROLE, BODY_LEGEND } = Mochi.art;
  const L = { ...BODY_LEGEND, A: ROLE.accent };

  const EAR_L = ['.OO.', 'OBBO', 'OBAO', 'OBAO', 'OBAO', 'OBAO', 'OBAO', 'OBAO', 'OBBO', '.OBO', '.OBO'];
  const EAR_R = ['....OO.', '...OBBO', '..OBAO.', '.OBAO..', '.OBAO..', 'OBAO...', 'OBAO...', 'OBAO...', 'OBBO...', 'OBO....', 'OBO....'];
  const TAIL = ['.OO.', 'OHHO', 'OHHO', '.OO.'];

  Mochi.characters.register({
    id: 'bunny',
    name: 'char.bunny.name',
    unlock: { level: 2 },
    colors: { outline: '#5a4658', shade: '#d6c9d2', base: '#f3edf1', light: '#fbf8fa', highlight: '#ffffff', accent: '#ff9fb4', accentLight: '#ffd3dd' },
    parts: {
      top: sprite(EAR_L, 14, 6, L) + sprite(EAR_R, 22, 6, L),
      back: sprite(TAIL, 27, 27, L, 'tail'),
      faceExtra: px([[19, 25], [20, 25]], ROLE.accent, 'nose'),
    },
    phrases: { hello: 'char.bunny.hello', poke: 'char.bunny.poke', happy: 'char.bunny.happy', idle: 'char.bunny.idle', excited: 'char.bunny.excited', curious: 'char.bunny.curious' },
    idle: [{
      when: () => true,
      run: c => { c.play('hop'); setTimeout(() => c.play('hop'), 600); c.flashFx('carrot', 2400); c.say(Mochi.tPick('char.bunny.carrot'), 1700); },
    }],
  });
})();
