/*
 * Mochi — Image Scan: the magnifier. While Mochi is visible, pointing at a big image
 * (≥ 120 × 120) shows a small magnifier button in its corner; a click scans it.
 * On by default on other sites; off by default on claude.ai (Settings toggles both).
 * The button lives in Mochi's shadow root, so it hides with Mochi during the screenshot.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const MIN = 120;
  Mochi.settings.define({ imageScan: { claude: false, web: true } });
  Mochi.menu.addSetting({ path: 'imageScan.claude', type: 'toggle', label: 'settings.imgHover', when: ctx => ctx.isClaude });
  Mochi.menu.addSetting({ path: 'imageScan.web', type: 'toggle', label: 'settings.imgHover', when: ctx => !ctx.isClaude });

  Mochi.features = Mochi.features || [];
  Mochi.features.push({
    id: 'image-hover',
    init(ctx) {
      const { companion } = ctx;
      const { h } = Mochi.ui;
      const on = () => Mochi.settings.get(ctx.isClaude ? 'imageScan.claude' : 'imageScan.web') === true;
      const btn = h('button', { class: 'img-hover px-btn', type: 'button', hidden: true, 'aria-label': Mochi.t('img.hoverButton'), title: Mochi.t('img.hoverButton') }, '⌕');
      companion.shadow.append(btn);
      let target = null;
      let hideTimer = null;

      const inside = (r, x, y, pad = 0) => x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
      const hide = () => { btn.hidden = true; target = null; };
      const place = () => {
        if (!target) return;
        const r = target.el.getBoundingClientRect();
        if (r.width < MIN || r.height < MIN || r.bottom < 0 || r.top > innerHeight) { hide(); return; }
        btn.style.left = `${Math.round(Math.min(innerWidth - 40, Math.max(4, r.right - 38)))}px`;
        btn.style.top = `${Math.round(Math.min(innerHeight - 40, Math.max(4, r.top + 8)))}px`;
      };

      document.addEventListener('pointerover', ev => {
        if (!on() || companion.isHidden || Mochi.imageScan?.busy || ev.pointerType === 'touch') return;
        const el = ev.composedPath?.()[0];
        if (!(el instanceof Element) || el.closest('mochi-companion') || !Mochi.imageTarget) return;
        const t = Mochi.imageTarget.resolve(el, { x: ev.clientX, y: ev.clientY });
        if (!t || t.rect.width < MIN || t.rect.height < MIN) return;
        clearTimeout(hideTimer);
        target = t;
        btn.hidden = false;
        place();
      }, { passive: true, capture: true });
      // Gone when the pointer leaves the image (the button itself counts as the image).
      document.addEventListener('pointermove', ev => {
        if (!target) return;
        if (ev.composedPath?.().includes(companion.host)) { clearTimeout(hideTimer); return; }
        if (!inside(target.el.getBoundingClientRect(), ev.clientX, ev.clientY, 4)) { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 250); }
      }, { passive: true, capture: true });
      addEventListener('scroll', () => { if (target) place(); }, { passive: true, capture: true });
      Mochi.settings.onChange(path => { if (path?.startsWith?.('imageScan') && !on()) hide(); });

      btn.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const t = target;
        hide();
        if (t) Mochi.imageScan?.scan(Mochi.imageTarget.resolve(t.el) || t, { source: 'hover' });
      });

      // Test hook: where the magnifier is for an element (after pointing at it), or null.
      Mochi.debugHooks.imageHover = selector => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        hide();
        el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
        return btn.hidden ? null : { left: parseFloat(btn.style.left), top: parseFloat(btn.style.top) };
      };
    },
  });
})();
