/*
 * Mochi — birthdays and milestones (the party part; the dates are in
 * src/birthday.js).
 *
 * 7 days, 1 month, 100 days together: a happy bubble and a little confetti,
 * once each. On Mochi's birthday (every year on the install day) it wears a
 * party hat all day and brings a pixel cake with one candle per year: click
 * the cake to blow them out. The birthday hat is then yours to keep in the
 * wardrobe (it can only be unlocked on that day). A share card ("1 year with
 * Mochi 🎂") can be saved as a PNG.
 *
 * Once per day across tabs: the tab that throws the party writes
 * mochi.meta.lastCelebrated first (under a lock), so other tabs only put on
 * the hat. Everything stays in your browser.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const D = Mochi.birthdayDates;
  const META = 'mochi.meta';
  const COLORS = ['#ff6f8e', '#ffd23f', '#77d3b2', '#6b84e4', '#f9a35c', '#b9a8ff'];

  const getMeta = () => Mochi.store.get(META, {});
  const setMeta = fn => Mochi.store.update(META, m => fn({ ...(m || {}) }), {});
  /** One tab at a time decides about today's party (the lock is shared by tabs of the same site). */
  const locked = fn => (navigator.locks?.request ? navigator.locks.request('mochi-birthday', fn) : fn());

  Mochi.birthday = { years: () => 0, isToday: () => false };

  Mochi.features = Mochi.features || [];
  Mochi.features.push({
    id: 'birthday',
    init(ctx) {
      const { companion, panel } = ctx;
      const { h } = Mochi.ui;
      const t = Mochi.t;
      let today = null;
      let years = 0;
      let running = false;
      let last = null; // the last plan, for tests

      function confetti(ms = 3600, count = 14) {
        const box = h('div', { class: 'confetti bday-confetti', 'aria-hidden': 'true' });
        for (let i = 0; i < count; i++) {
          const bit = document.createElement('i');
          bit.style.left = `${(i * 29 + 7) % 100}%`;
          bit.style.background = COLORS[i % COLORS.length];
          bit.style.animationDelay = `${-((i * 0.37) % 1.8).toFixed(2)}s`;
          box.append(bit);
        }
        companion.root.append(box);
        setTimeout(() => box.remove(), ms);
        return box;
      }

      const busy = () => document.hidden || companion.isHidden || companion.isTucked || panel.isOffering || !!companion.root.querySelector('.offer');

      function milestone(c) {
        companion.setMood('excited');
        companion.play('celebrate');
        companion.flashFace({ eyes: 'happy', mouth: 'big' }, 2000);
        confetti();
        Mochi.sound?.play?.('levelUp');
        const name = Mochi.petName();
        companion.say(t(`birthday.${c.id}`, { name: name || 'Mochi' }), 5000);
        ctx.emit('milestone', c.id);
      }

      async function party(c) {
        if (c.kind === 'milestone') return milestone(c);
        return Mochi.birthday.anniversary?.(c);
      }

      /** Look at today's date and celebrate what's due (at most once a day, across tabs). */
      async function check(tries = 0) {
        if (running) return last;
        running = true;
        try {
          await Mochi.store.ready;
          today = Mochi.store.today();
          let plan = null, go = false;
          await locked(async () => {
            const m = await getMeta();
            plan = D.plan({ installDate: m.installDate, installMigrated: !!m.installMigrated, today, celebrated: m.celebrated || [], lastCelebrated: m.lastCelebrated || null });
            if (plan.celebrate && busy()) return; // later, when Mochi is free (nothing saved yet)
            go = !!plan.celebrate;
            if (!plan.mark.length && !go) return;
            await setMeta(x => ({
              ...x,
              celebrated: [...new Set([...(x.celebrated || []), ...plan.mark])],
              ...(go ? { lastCelebrated: today } : {}),
            }));
          });
          last = { today, ...plan };
          setYears(plan.birthday);
          if (go) await party(plan.celebrate);
          else if (plan.celebrate) { last.waiting = true; if (tries < 40) setTimeout(() => check(tries + 1), 5000); }
          return last;
        } finally { running = false; }
      }

      function setYears(n) {
        const was = years;
        years = n || 0;
        if (was !== years) Mochi.birthday.onYears?.(years, was);
      }
      Mochi.birthday.years = () => years;
      Mochi.birthday.isToday = () => years > 0;
      Mochi.birthday.check = check;
      Mochi.birthday.confetti = confetti;

      // After the hello (and the tour, if it's the first time), and when the date changes.
      setTimeout(check, 6500);
      ctx.on('tick', () => { if (today && Mochi.store.today() !== today) check(); });

      // Test page: pretend another day / install day. { today, installDate, migrated, reset }
      Mochi.debugHooks.birthday = async ({ today: day, installDate, migrated = false, reset = false } = {}) => {
        if (day !== undefined) Mochi.store.setToday(day || null);
        await setMeta(x => ({
          ...x,
          ...(installDate ? { installDate, installMigrated: !!migrated } : {}),
          ...(reset ? { celebrated: [], lastCelebrated: null, unlocked: (x.unlocked || []).filter(id => id !== 'birthday-hat') } : {}),
        }));
        return check();
      };
      Mochi.birthday.state = () => last;
    },
  });
})();
