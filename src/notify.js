/*
 * Mochi — "Claude answered" (claude.ai only).
 *
 * If Claude finishes an answer while you're in another tab, the claude.ai tab
 * gets a "✓ " in front of its title and a tiny pixel Mochi with a green check
 * as its icon, so you can see it from the tab strip. Coming back puts the
 * title and icon back as they were, and Mochi says hello. No browser
 * notifications, no permission. Settings → "Claude answered" badge.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const MARK = '✓ ';

  Mochi.settings.define({ notify: true });
  Mochi.menu.addSetting({ path: 'notify', type: 'toggle', label: 'settings.notify', when: ctx => ctx.isClaude });

  /** A 32×32 pixel icon: Mochi's face in its current colors with a green check badge. */
  async function badgeIcon(companion) {
    const cs = getComputedStyle(companion.el);
    const role = name => cs.getPropertyValue(`--m-${name}`).trim();
    const colors = { outline: role('outline'), shade: role('shade'), base: role('base'), light: role('light'), highlight: role('highlight'), accent: role('accent'), accentLight: role('accent-light'), ink: role('ink') };
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    try {
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(Mochi.art.staticSvg({ mood: 'happy', colors, size: 40, withShadow: false, parts: companion.character?.parts }))}`;
      await img.decode();
      // The 40-grid sprite's body sits around x 8..32, y 10..36: crop to it.
      g.drawImage(img, 6, 8, 28, 28, 0, 0, 32, 32);
    } catch (_) {
      g.fillStyle = colors.outline || '#55230d'; g.fillRect(4, 6, 24, 22);
      g.fillStyle = colors.base || '#ef8140'; g.fillRect(6, 8, 20, 18);
    }
    // The check badge, bottom right.
    g.fillStyle = '#ffffff'; g.fillRect(17, 17, 15, 15);
    g.fillStyle = '#1f9d55'; g.fillRect(18, 18, 13, 13);
    g.fillStyle = '#ffffff';
    for (const [x, y] of [[20, 24], [21, 25], [22, 26], [23, 27], [24, 26], [25, 25], [26, 24], [27, 23], [28, 22]]) g.fillRect(x, y, 1, 2);
    return canvas.toDataURL('image/png');
  }

  Mochi.features = Mochi.features || [];
  Mochi.features.push({
    id: 'notify',
    init(ctx) {
      if (!ctx.isClaude) return;
      const { companion } = ctx;
      let marked = false;
      let saved = []; // [link, original href] for each icon we swapped
      let added = null; // our own <link> if the page had none
      let titleWatch = null;

      const iconLinks = () => [...document.querySelectorAll('link[rel~="icon"]')];
      const addMark = () => { if (!document.title.startsWith(MARK)) document.title = MARK + document.title; };

      async function mark() {
        if (marked || Mochi.settings.get('notify') === false) return;
        marked = true;
        addMark();
        // claude.ai renames the tab as the chat gets a title: keep the check in front.
        const titleEl = document.querySelector('title');
        if (titleEl) {
          titleWatch = new MutationObserver(() => { if (marked) addMark(); });
          titleWatch.observe(titleEl, { childList: true, characterData: true, subtree: true });
        }
        const icon = await badgeIcon(companion);
        if (!marked) return; // you came back while we were drawing
        const links = iconLinks();
        if (links.length) {
          saved = links.map(l => [l, l.getAttribute('href')]);
          for (const l of links) l.href = icon;
        } else {
          added = document.createElement('link');
          added.rel = 'icon'; added.href = icon; added.dataset.mochi = 'badge';
          document.head.append(added);
        }
        ctx.emit('notified');
      }

      function unmark({ greet = true } = {}) {
        if (!marked) return;
        marked = false;
        titleWatch?.disconnect(); titleWatch = null;
        if (document.title.startsWith(MARK)) document.title = document.title.slice(MARK.length);
        for (const [l, href] of saved) { if (href == null) l.removeAttribute('href'); else l.setAttribute('href', href); }
        saved = [];
        added?.remove(); added = null;
        if (greet && !companion.isHidden && !companion.isTucked) {
          setTimeout(() => {
            companion.play('wave');
            companion.flashFace({ eyes: 'happy', mouth: 'big' }, 1200);
            companion.say(Mochi.tPick('notify.welcome'), 2600);
          }, 350);
        }
      }

      ctx.on('responseEnd', () => { if (document.hidden) mark(); });
      ctx.on('visibility', hidden => { if (!hidden) unmark(); });
      addEventListener('focus', () => { if (!document.hidden) unmark(); });
      Mochi.settings.onChange(p => { if (p === 'notify' && Mochi.settings.get('notify') === false) unmark({ greet: false }); });

      // Test page: {"notify": "mark"} / {"notify": "back"}.
      Mochi.debugHooks.notify = value => (value === 'back' ? unmark() : mark());
      Mochi.notify = { mark, unmark, get marked() { return marked; }, badgeIcon: () => badgeIcon(companion) };
    },
  });
})();
