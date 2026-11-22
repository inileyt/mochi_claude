/*
 * Mochi — saying hello properly.
 *
 * What's new: after an update, the next time Mochi appears it says what's new
 * in this version, once (the newest version seen is kept in sync, so your
 * other computers don't repeat it). Texts: src/changelog.js.
 *
 * The tour: the first time Mochi is in a chat, three little cards show how
 * Mochi works: the menu, dragging, playing. Next / Skip. Done or skipped, it
 * never comes back on its own (also on your other computers); Settings →
 * "Replay the tour" shows it again. People who used Mochi before this
 * version already know it, so they don't get the tour.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const META = 'mochi.meta';
  const STEPS = ['menu', 'drag', 'play'];

  const version = () => { try { return chrome.runtime.getManifest().version; } catch (_) { return Mochi.testVersion || null; } };
  const meta = () => Mochi.store.get(META, {});
  const setMeta = patch => Mochi.store.update(META, m => ({ ...(m || {}), ...patch }), {});

  /** The changelog entry to tell about, or null. */
  function whatsNewFor(m, current) {
    if (!current) return null;
    const cmp = Mochi.store.compareVersions;
    if (m.whatsNewSeen && cmp(m.whatsNewSeen, current) >= 0) return null;
    // A fresh install (today, not migrated): nothing is "new" yet.
    if (!m.whatsNewSeen && !m.installMigrated && m.installDate === Mochi.store.today()) return null;
    return Mochi.changelog?.find(e => e.version === current) || null;
  }
  const wantsTour = m => !m.onboardingDone && !m.tourSkipped && !m.installMigrated;

  Mochi.menu.addSetting({ id: 'replay-tour', type: 'action', label: 'settings.replayTour', when: ctx => ctx.isChat, run: () => Mochi.onboarding.tour?.() });
  Mochi.onboarding = { whatsNewFor, wantsTour, STEPS };

  Mochi.features = Mochi.features || [];
  Mochi.features.push({
    id: 'onboarding',
    init(ctx) {
      const { companion, panel } = ctx;
      const { h } = Mochi.ui;
      const t = Mochi.t;
      let card = null;
      let step = 0;

      const busy = () => document.hidden || companion.isHidden || companion.isTucked || panel.isOffering || !!companion.root.querySelector('.offer:not(.tour)');
      function close() { card?.remove(); card = null; }

      async function finish(skipped) {
        close();
        await setMeta(skipped ? { onboardingDone: true, tourSkipped: true } : { onboardingDone: true });
        if (!skipped) { companion.play('hop'); companion.flashFace({ eyes: 'happy', mouth: 'smile' }, 1200); }
        companion.say(t(skipped ? 'tour.skipped' : 'tour.bye'), 2600);
        ctx.emit('tourEnd', skipped ? 'skipped' : 'done');
      }

      function show(i) {
        close();
        step = i;
        const id = STEPS[i];
        const last = i === STEPS.length - 1;
        companion.bubble.classList.remove('show');
        companion.play(id === 'menu' ? 'wave' : 'hop');
        card = h('div', { class: 'offer tour', role: 'dialog', 'aria-label': t('tour.title'), 'data-step': id },
          h('span', { class: 'tour-step', text: t('tour.step', { n: i + 1, total: STEPS.length }) }),
          h('p', { text: t(`tour.${id}`) }),
          h('div', { class: 'row' },
            h('button', { class: 'px-btn primary', type: 'button', 'data-act': last ? 'done' : 'next', onclick: () => (last ? finish(false) : show(i + 1)) }, t(last ? 'tour.done' : 'tour.next')),
            last ? null : h('button', { class: 'px-btn', type: 'button', 'data-act': 'skip', onclick: () => finish(true) }, t('tour.skip'))));
        companion.root.append(card);
        card.querySelector('[data-act]')?.focus({ preventScroll: true });
        ctx.emit('tourStep', id);
      }

      /** Start the tour (Settings → Replay the tour starts it even if it was done). */
      function tour() { if (companion.isTucked) companion.setTucked(false); show(0); }
      Mochi.onboarding.tour = tour;
      Mochi.onboarding.state = () => ({ open: !!card, step: card ? STEPS[step] : null });

      async function sayWhatsNew(entry) {
        await setMeta({ whatsNewSeen: version() });
        companion.play('hop');
        companion.flashFace({ eyes: 'happy', mouth: 'open' }, 1400);
        companion.say(`${t('whatsNew.title', { version: entry.version })} ${t(entry.key)}`, 9000);
        ctx.emit('whatsNew', entry.version);
      }

      // After the hello: the tour (first time in a chat), else what's new (after an update).
      async function start(tries = 0) {
        if (busy()) { if (tries < 20) setTimeout(() => start(tries + 1), 4000); return; }
        await Mochi.store.ready;
        const m = await meta();
        if (ctx.isChat && wantsTour(m)) { tour(); if (version()) setMeta({ whatsNewSeen: version() }); return; }
        const entry = whatsNewFor(m, version());
        if (entry) sayWhatsNew(entry);
        else if (version() && !m.whatsNewSeen) setMeta({ whatsNewSeen: version() });
      }
      setTimeout(start, 3800);

      document.addEventListener('keydown', ev => { if (card && ev.key === 'Escape') finish(true); });

      Mochi.debugHooks.tour = async value => {
        if (value === 'reset') { await setMeta({ onboardingDone: false, tourSkipped: false, installMigrated: false }); return; }
        if (value === 'start') return tour();
        if (value === 'next') return card?.querySelector('[data-act="next"],[data-act="done"]')?.click();
        if (value === 'skip') return card?.querySelector('[data-act="skip"]')?.click();
        return Mochi.onboarding.state();
      };
      Mochi.debugHooks.whatsNew = async ({ seen, version: v } = {}) => {
        Mochi.testVersion = v || Mochi.testVersion;
        await setMeta({ whatsNewSeen: seen || undefined, installMigrated: true });
        const entry = whatsNewFor(await meta(), version());
        if (entry) await sayWhatsNew(entry);
        return entry?.version || null;
      };
    },
  });
})();
