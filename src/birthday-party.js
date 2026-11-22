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
  // On the birthday: Menu → Tools → Birthday card 🎂.
  Mochi.menu.addItem({ section: 'tools', id: 'birthday-card', icon: '🎂', label: 'menu.birthdayCard', when: () => Mochi.birthday.isToday(), run: () => Mochi.birthday.shareCard?.() });

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

      // ——— the birthday: party hat all day, the hat unlocked for good ———
      let hatUnlocked = false;
      getMeta().then(m => { hatUnlocked = (m.unlocked || []).includes('birthday-hat'); });
      Mochi.birthday.hatUnlocked = () => hatUnlocked || years > 0;
      const yearsText = n => {
        let form = 'other';
        try { form = new Intl.PluralRules(Mochi.lang()).select(n); } catch (_) { /* old browser */ }
        return t(`birthday.years.${['one', 'few', 'many'].includes(form) ? form : 'other'}`, { n });
      };
      Mochi.birthday.yearsText = yearsText;

      function setYears(n) {
        const was = years;
        years = n || 0;
        if (was === years) return;
        const outfits = Mochi.outfits;
        if (years) {
          if (outfits) { outfits.overrides.head = outfits.byId('birthday-hat'); outfits.apply(companion); }
          if (!hatUnlocked) {
            hatUnlocked = true;
            setMeta(x => ({ ...x, unlocked: [...new Set([...(x.unlocked || []), 'birthday-hat'])] }));
          }
        } else if (outfits?.overrides.head?.id === 'birthday-hat') {
          delete outfits.overrides.head;
          outfits.apply(companion);
          cake?.remove(); cake = null;
        }
      }

      // ——— the cake: one candle per year (up to 10 drawn) ———
      let cake = null, cakeTimer = 0;
      function cakeSvg(candles) {
        const W = 24, H = 20;
        const r = (x, y, w, h, c, cls = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"${cls ? ` class="${cls}"` : ''}/>`;
        let out = '';
        out += r(0, 19, 24, 1, '#55230d'); // plate shadow
        out += r(1, 18, 22, 1, '#d8d2e6'); // plate
        out += r(2, 9, 20, 9, '#55230d'); // outline
        out += r(3, 10, 18, 7, '#f3c48f'); // sponge
        out += r(3, 13, 18, 1, '#ff6f8e'); // jam
        out += r(3, 10, 18, 2, '#fff6e6'); // frosting
        for (const x of [4, 8, 13, 17]) out += r(x, 12, 2, 1, '#fff6e6'); // drips
        for (const [x, c] of [[5, '#ff6f8e'], [9, '#77d3b2'], [12, '#6b84e4'], [16, '#ffd23f'], [19, '#ff6f8e']]) out += r(x, 15, 1, 1, c); // sprinkles
        const n = Math.max(1, Math.min(10, candles));
        for (let i = 0; i < n; i++) {
          const x = n === 1 ? 11 : Math.round(4 + (i * 15) / (n - 1));
          out += r(x, 5, 1, 4, i % 2 ? '#6b84e4' : '#ff6f8e'); // candle
          out += r(x, 4, 1, 1, '#55230d'); // wick
          out += `<g class="flame">${r(x, 2, 1, 2, '#ffd23f')}${r(x, 3, 1, 1, '#f97b2e')}</g>`;
          out += `<g class="smoke">${r(x, 2, 1, 1, '#b9b3c4')}${r(x + 1, 0, 1, 1, '#d8d2e6')}</g>`;
        }
        return `<svg viewBox="0 0 ${W} ${H}" width="${W * 3}" height="${H * 3}" shape-rendering="crispEdges" aria-hidden="true">${out}</svg>`;
      }
      function showCake(n) {
        cake?.remove();
        cake = h('button', { class: 'bday-cake', type: 'button', 'aria-label': t('birthday.cakeLabel', { n }), title: t('birthday.cakeLabel', { n }) });
        cake.innerHTML = cakeSvg(n); // our own markup, no page text in it
        cake.append(h('span', { class: 'cake-tip', text: t('birthday.blowTip') }));
        if (n > 10) cake.append(h('span', { class: 'cake-n', text: `×${n}` }));
        cake.addEventListener('click', () => blowOut(n), { once: true });
        companion.root.append(cake);
        clearTimeout(cakeTimer);
        cakeTimer = setTimeout(() => { cake?.remove(); cake = null; }, 3 * 60 * 1000); // not blown out: it goes away after a while
        ctx.emit('cake', n);
      }
      function blowOut(n) {
        if (!cake) return;
        cake.classList.add('out');
        cake.querySelector('.cake-tip')?.remove();
        companion.play('hop');
        companion.flashFace({ eyes: 'happy', mouth: 'o' }, 900);
        confetti(4500, 24);
        Mochi.sound?.play?.('happy');
        setTimeout(() => companion.say(t('birthday.wish'), 2400), 600);
        setTimeout(() => thanksCard(n), 3200);
        ctx.emit('candlesOut', n);
      }
      function thanksCard(n) {
        if (companion.root.querySelector('.offer')) return;
        companion.bubble.classList.remove('show');
        const close = () => { card.remove(); cake?.remove(); cake = null; };
        const card = h('div', { class: 'offer bday-card', role: 'dialog', 'aria-label': t('birthday.cardTitle', { years: yearsText(n), name: Mochi.petName() || 'Mochi' }) },
          h('p', { text: t('birthday.thanks', { years: yearsText(n) }) }),
          h('p', { class: 'bday-note', text: t('birthday.hatUnlocked') }),
          h('div', { class: 'row' },
            h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'birthday-card', onclick: () => { Mochi.birthday.shareCard?.(); close(); } }, t('birthday.saveCard')),
            h('button', { class: 'px-btn', type: 'button', 'data-act': 'close', onclick: close }, t('birthday.close'))));
        companion.root.append(card);
        setTimeout(() => { if (card.isConnected) close(); }, 45000);
      }

      Mochi.birthday.anniversary = c => {
        const name = Mochi.petName();
        companion.setMood('excited');
        companion.play('celebrate');
        companion.flashFace({ eyes: 'happy', mouth: 'big' }, 2200);
        confetti(5000, 20);
        Mochi.sound?.play?.('levelUp');
        companion.say(name ? t('birthday.todayNamed', { name, years: yearsText(c.years) }) : t('birthday.today', { years: yearsText(c.years) }), 6000);
        setTimeout(() => showCake(c.years), 1800);
        ctx.emit('anniversary', c.years);
      };
      // ——— the share card: "1 year with Mochi 🎂" as a PNG ———
      async function shareCard(n = years || 1) {
        const W = 1200, H = 630;
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const g = canvas.getContext('2d');
        g.imageSmoothingEnabled = false;
        // Mochi's colors right now (its color theme), read from its sprite.
        const cs = getComputedStyle(companion.el);
        const role = name => cs.getPropertyValue(`--m-${name}`).trim();
        const colors = { outline: role('outline') || '#55230d', shade: role('shade'), base: role('base') || '#ef8140', light: role('light'), highlight: role('highlight'), accent: role('accent') || '#f7b23b', accentLight: role('accent-light'), ink: role('ink') };
        const resolve = markup => markup.replace(/var\(--m-([a-z-]+)\)/g, (m, r) => colors[r.replace(/-([a-z])/g, (_, x) => x.toUpperCase())] || m);
        const hat = Mochi.outfits?.byId('birthday-hat');
        const outfits = hat ? [{ slot: 'head', markup: resolve(Mochi.outfits.markup(hat)), hide: hat.hide || [] }] : [];
        const image = async src => { const im = new Image(); im.src = src; await im.decode(); return im; };
        const mochi = await image(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(Mochi.art.staticSvg({ mood: 'excited', outfits, colors, size: 400, parts: companion.character?.parts }))}`);
        const cakeImg = await image(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(cakeSvg(n).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ').replace(/<g class="smoke">.*?<\/g>/g, ''))}`);

        // Background: cream checker, confetti pixels, a pixel border in Mochi's outline color.
        g.fillStyle = '#fff6e6'; g.fillRect(0, 0, W, H);
        g.fillStyle = '#ffe9cf';
        for (let y = 0; y < H; y += 30) for (let x = (y / 30) % 2 ? 30 : 0; x < W; x += 60) g.fillRect(x, y, 30, 30);
        for (let i = 0; i < 46; i++) { g.fillStyle = COLORS[i % COLORS.length]; g.fillRect((i * 263 + 41) % (W - 40) + 20, (i * 151 + 23) % (H - 40) + 20, 12, 18); }
        g.fillStyle = colors.outline;
        g.fillRect(0, 0, W, 12); g.fillRect(0, H - 12, W, 12); g.fillRect(0, 0, 12, H); g.fillRect(W - 12, 0, 12, H);
        g.drawImage(mochi, 80, 90, 420, 420);
        g.drawImage(cakeImg, 40, 400, 192, 160);

        const font = (size, weight = 800) => `${weight} ${size}px ui-monospace, "SFMono-Regular", Menlo, Consolas, "Courier New", monospace`;
        const fit = (text, size, max, weight) => { let s2 = size; g.font = font(s2, weight); while (g.measureText(text).width > max && s2 > 24) { s2 -= 2; g.font = font(s2, weight); } };
        const name = Mochi.petName() || 'Mochi';
        const title = t('birthday.cardTitle', { years: yearsText(n), name });
        fit(title, 64, 620);
        g.fillStyle = colors.outline; g.fillText(title, 554, 234);
        g.fillStyle = colors.base; g.fillText(title, 550, 230);
        g.fillStyle = '#2b1208';
        const level = Mochi.progress?.level?.();
        if (level) { g.font = font(44, 700); g.fillText(t('share.level', { level }), 550, 310); }
        const meta = await getMeta();
        if (meta.installDate) {
          let since = meta.installDate;
          try { since = new Date(`${meta.installDate}T12:00:00`).toLocaleDateString(Mochi.lang(), { year: 'numeric', month: 'long', day: 'numeric' }); } catch (_) { /* keep ISO */ }
          g.fillStyle = '#6b4a33'; fit(t('birthday.since', { date: since }), 30, 620, 600); g.fillText(t('birthday.since', { date: since }), 550, 370);
        }
        g.font = font(30, 800); g.fillStyle = '#2b1208'; g.fillText('github.com/inileyt/mochi_claude', 550, 560);

        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
        const url = URL.createObjectURL(blob);
        const a = h('a', { href: url, download: `mochi-birthday-${n}.png`, style: { display: 'none' } });
        companion.shadow.append(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
        ctx.actions?.downloaded?.(`mochi-birthday-${n}.png`);
        ctx.emit('birthdayCard', n);
        return blob;
      }
      Mochi.birthday.shareCard = shareCard;
      Mochi.debugHooks.birthdayCard = n => shareCard(n || undefined);

      Mochi.birthday.showCake = showCake;
      Mochi.birthday.blowOut = () => cake && cake.click();
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
