/*
 * Mochi — secrets. 🤫
 *
 * (The README only hints at these. If you're reading this, you found them!)
 *   - The Konami code (↑ ↑ ↓ ↓ ← → ← → B A) → party mode.
 *   - Tell Mochi you love it ("I love you Mochi", "люблю тебя, Mochi") in a
 *     message to Claude → Mochi blushes, with hearts.
 *   - Click Mochi 50 times in one day → a golden Mochi for the rest of that day.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  // "I love you" in the languages Mochi speaks, next to Mochi's name (either order).
  const LOVES = [
    'i\\s*(?:love|luv|❤️?|<3)\\s*(?:you|u|ya)', 'люблю\\s+тебя', 'я\\s+тебя\\s+люблю', 'тебя\\s+люблю', 'люблю\\s+тебе', 'я\\s+тебе\\s+люблю',
    'te\\s+quiero', 'te\\s+amo', 'je\\s+t[’\']aime', 'ti\\s+amo', 'ti\\s+voglio\\s+bene', 'ich\\s+liebe\\s+dich', 'hab\\s+dich\\s+lieb',
    'eu\\s+te\\s+amo', '我爱你', '我愛你', '愛してる', '大好き', 'սիրում\\s+եմ\\s+քեզ', 'քեզ\\s+սիրում\\s+եմ',
  ].join('|');
  const NAME = '(?:mochi|моч[иы]|モチ|もち|麻糬|麻薯|մոչի)';
  const GAP = '[\\s,，、!！.。~♥❤️]*';
  const LOVE = [
    new RegExp(`(?<![\\p{L}])(?:${LOVES})${GAP}${NAME}`, 'iu'),
    new RegExp(`${NAME}${GAP}(?:${LOVES})`, 'iu'),
  ];
  const CLICKS_FOR_GOLD = 50;
  const GOLD = { outline: '#6b4a00', shade: '#d9a400', base: '#ffd23f', light: '#ffe57a', highlight: '#fff6c4', accent: '#ffffff', accentLight: '#fff6c4', ink: '#3a2600' };
  const PARTY_MS = 8000;

  const lovesMochi = text => LOVE.some(re => re.test(String(text || '')));
  Mochi.eggs = { KONAMI, lovesMochi, GOLD, CLICKS_FOR_GOLD };

  Mochi.features = Mochi.features || [];
  Mochi.features.push({
    id: 'easter-eggs',
    init(ctx) {
      const { companion } = ctx;
      const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
      let partying = false;

      // ——— golden Mochi ———
      let golden = false;
      async function checkGolden() {
        const day = await Mochi.store.get('eggs.golden', null);
        const was = golden;
        golden = day === Mochi.store.today();
        if (golden !== was || golden) {
          Mochi.colorOverride = golden ? GOLD : (partying ? Mochi.colorOverride : null);
          companion.root.classList.toggle('golden', golden);
          Mochi.applyColorTheme?.();
        }
      }
      async function countClick() {
        const today = Mochi.store.today();
        const c = await Mochi.store.update('eggs.clicks', v => (v && v.day === today ? { day: today, n: v.n + 1 } : { day: today, n: 1 }), null);
        if (c.n === CLICKS_FOR_GOLD && !golden) {
          await Mochi.store.set('eggs.golden', today);
          await checkGolden();
          companion.play('celebrate');
          companion.flashFx('sparkles', 2400);
          companion.say(Mochi.t('eggs.golden'), 3200);
          Mochi.sound?.play('levelUp');
          ctx.emit('egg', 'golden');
        }
      }
      companion.on('menu', countClick);
      companion.on('poke', countClick);
      ctx.on('dayChanged', checkGolden);
      checkGolden();

      // ——— party mode ———
      const PARTY_THEMES = ['sakura', 'lemon', 'mint', 'blueberry', 'night'];
      function party() {
        if (partying) return;
        partying = true;
        ctx.emit('egg', 'party');
        companion.root.classList.add('party');
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.setAttribute('aria-hidden', 'true');
        const colors = ['#ff6f8e', '#ffd23f', '#77d3b2', '#6b84e4', '#f9a35c', '#b9a8ff'];
        for (let i = 0; i < 16; i++) {
          const bit = document.createElement('i');
          bit.style.left = `${(i * 29 + 7) % 100}%`;
          bit.style.background = colors[i % colors.length];
          bit.style.animationDelay = `${-((i * 0.37) % 1.8).toFixed(2)}s`;
          confetti.append(bit);
        }
        companion.root.append(confetti);
        companion.say(Mochi.t('eggs.party'), 2600);
        companion.setMood('excited');
        Mochi.sound?.play('levelUp');
        const moves = ['spin', 'celebrate', 'hop', 'wiggle', 'spin', 'celebrate'];
        let i = 0;
        const dance = setInterval(() => {
          companion.play(moves[i % moves.length]);
          // Colors change to the beat (not with Reduce motion: no flashing).
          if (!reduced() && !golden) { Mochi.colorOverride = Mochi.colorThemes?.[PARTY_THEMES[i % PARTY_THEMES.length]] || null; Mochi.applyColorTheme?.(); }
          i++;
        }, 1000);
        setTimeout(() => {
          clearInterval(dance);
          confetti.remove();
          companion.root.classList.remove('party');
          partying = false;
          Mochi.colorOverride = golden ? GOLD : null;
          Mochi.applyColorTheme?.();
          companion.setMood('happy');
          companion.say(Mochi.t('eggs.partyOver'), 2000);
          setTimeout(() => { if (companion.mood === 'happy') companion.setMood('neutral'); }, 2400);
        }, PARTY_MS);
      }
      let pos = 0;
      addEventListener('keydown', ev => {
        if (!ev.isTrusted && !Mochi.eggs.testKeys) return;
        const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
        pos = key === KONAMI[pos] ? pos + 1 : key === KONAMI[0] ? 1 : 0;
        if (pos === KONAMI.length) { pos = 0; party(); }
      }, { capture: true, passive: true });

      // ——— "I love you, Mochi" ———
      let lastLove = 0;
      function blush() {
        if (Date.now() - lastLove < 20000) return;
        lastLove = Date.now();
        ctx.emit('egg', 'love');
        companion.el.classList.add('blushing');
        // Through the mood engine, so it wins over the "curious" look a new message gets.
        ctx.engine.react({ mood: 'happy', action: 'wiggle', fx: 'love', hold: 3500 });
        companion.flashFace({ eyes: 'happy', mouth: 'smile' }, 3400);
        setTimeout(() => companion.say(Mochi.tPick('eggs.love'), 3000), 400);
        Mochi.sound?.play('happy');
        setTimeout(() => companion.el.classList.remove('blushing'), 4000);
      }
      ctx.on('userMessage', text => { if (lovesMochi(text)) setTimeout(blush, 300); });

      Mochi.debugHooks.egg = value => {
        if (value === 'party') party();
        if (value === 'love') { lastLove = 0; blush(); }
        if (value === 'golden') return Mochi.store.set('eggs.clicks', { day: Mochi.store.today(), n: CLICKS_FOR_GOLD - 1 }).then(countClick);
        if (value === 'reset') return Promise.all([Mochi.store.set('eggs.golden', null), Mochi.store.set('eggs.clicks', null)]).then(checkGolden);
      };
    },
  });
})();
