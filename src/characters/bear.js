/*
 * The bear cub: soft, round ears and a light muzzle. Sleepy (naps after a minute and a half), and
 * when bored has a little honey.
 */
(() => {
  const Mochi = globalThis.Mochi;
  const { sprite, px, ROLE, BODY_LEGEND } = Mochi.art;
  const L = { ...BODY_LEGEND, I: ROLE.accentLight, A: ROLE.accent };

  const EAR = ['.OOO.', 'OBBBO', 'OBIBO', 'OBIBO', 'OBBBO'];
  const MUZZLE = ['.IIIIII.', 'IIIIIIII', 'IIIIIIII', 'IIIIIIII', '.IIIIII.'];

  Mochi.characters.register({
    id: 'bear',
    name: 'char.bear.name',
    unlock: { level: 8 },
    colors: { outline: '#3a2212', shade: '#77461f', base: '#9c6434', light: '#bb8250', highlight: '#dcae7c', accent: '#e8bd8e', accentLight: '#f3d6b2' },
    parts: {
      top: sprite(EAR, 11, 13, L) + sprite(EAR, 24, 13, L),
      faceExtra: sprite(MUZZLE, 16, 25, L) + px([[18, 25], [19, 25], [20, 25], [21, 25], [19, 26], [20, 26]], ROLE.ink, 'nose'),
    },
    phrases: { hello: 'char.bear.hello', poke: 'char.bear.poke', happy: 'char.bear.happy', idle: 'char.bear.idle', sleepy: 'char.bear.sleepy', wake: 'char.bear.wake', sad: 'char.bear.sad' },
    moodMap: { excited: 'happy' }, // a calm little bear
    sleepAfter: 90 * 1000,
    idle: [{
      when: () => true,
      run: c => { c.flashFx('honey', 2600); c.flashFace({ eyes: 'happy', mouth: 'big' }, 1400); c.say(Mochi.tPick('char.bear.honey'), 1800); },
    }],
  });
})();
