/*
 * The robot: beeps, and gets very excited by code in Claude's answers.
 */
(() => {
  const Mochi = globalThis.Mochi;
  const { sprite, ROLE, BODY_LEGEND } = Mochi.art;
  const L = { ...BODY_LEGEND, A: ROLE.accent, G: ROLE.accentLight, K: ROLE.outline };

  const ANTENNA = ['.AA.', 'AGAA', 'AAAA', '.AA.', '.OO.', '.OO.', '.OO.', '.OO.'];
  const BODY = [
    'OOOOOOOOOOOOOOOO',
    'OHBBBBBBBBBBBBDO',
    'OBKBBBBBBBBBBKDO',
    'OBDDDDDDDDDDDDBO',
    ...Array(9).fill('OBDLLLLLLLLLLDBO'),
    'OBDDDDDDDDDDDDBO',
    'OOOOOOOOOOOOOOOO',
  ];
  const CLAW_L = ['OOO.', 'OBBO', 'OBKO', 'OBBO', 'OO.O'];
  const CLAW_R = ['.OOO', 'OBBO', 'OKBO', 'OBBO', 'O.OO'];
  const TREAD = ['.OOOOOOOOOOOO.', 'OKBKBKBKBKBKBO', '.OOOOOOOOOOOO.'];

  const hasCode = (text, el) => !!el?.querySelector?.('pre, code') || /```|\bfunction\b|=>|\bconst\b|\bdef\b|<\/?\w+>/.test(text || '');

  Mochi.characters.register({
    id: 'robot',
    name: 'char.robot.name',
    unlock: { level: 6 },
    colors: { outline: '#28313d', shade: '#7f8c9b', base: '#a9b5c3', light: '#d7e2ec', highlight: '#f2f6fa', accent: '#ff5a5a', accentLight: '#ffd0d0' },
    parts: {
      top: sprite(ANTENNA, 18, 9, L) + `<path class="spark-glow" style="fill:#fff6e6" d="M19 10h1v1h-1z"/>`,
      body: sprite(BODY, 12, 17, L),
      armL: sprite(CLAW_L, 8, 23, L),
      armR: sprite(CLAW_R, 28, 23, L),
      legs: sprite(TREAD, 13, 32, L, 'legs-tread'),
    },
    phrases: { hello: 'char.robot.hello', poke: 'char.robot.poke', happy: 'char.robot.happy', thinking: 'char.robot.thinking', idle: 'char.robot.idle', curious: 'char.robot.curious', excited: 'char.robot.excited' },
    onResponseEnd(text, el, c, engine) {
      if (!hasCode(text, el)) return false;
      engine.react({ mood: 'excited', action: 'celebrate', fx: 'sparkles', say: Mochi.tPick('char.robot.code'), hold: 4500 });
      Mochi.sound?.play('beeps');
      return true;
    },
    idle: [{
      when: () => true,
      run: c => { c.play('wiggle'); c.flashFace({ eyes: 'wide', mouth: 'small-o' }, 900); c.say(Mochi.tPick('char.robot.idle'), 1500); Mochi.sound?.play('beeps'); },
    }],
    hasCode,
  });
})();
