/*
 * Mochi — Deep Scan, Task 4b: what clicking does — only on safe UI controls
 * (menus, dropdowns, tabs, accordions, <details>, dialog triggers, carousel
 * arrows, the burger at 390px; see isSafeToClick in safety.js). For each:
 * what appeared (where, how it animated in), how it closes (Esc, the same
 * button, a close button, a click outside), a screenshot, and a check that
 * the page went back to how it was.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const D = Mochi.deepScan;
  const CANDIDATES = '[aria-expanded], [aria-haspopup], [role="tab"], summary, [data-bs-toggle], [data-toggle], [aria-controls], [data-dialog-open], [class*="burger"], [class*="hamburger"], [class*="menu-toggle"], [aria-label*="next" i], [aria-label*="prev" i]';
  const MAX_CONTROLS = 12;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const sel = el => Mochi.deepStructure.sel({ tag: el.tagName.toLowerCase(), id: el.id || null, cls: [...el.classList].filter(c => !/^(is-|has-|active|open|show)/.test(c)).slice(0, 2) });
  const visible = el => { if (!el?.isConnected) return false; const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.01 && r.width > 0 && r.height > 0; };

  function kindOf(el) {
    if (el.getAttribute('role') === 'tab') return 'tab';
    if (el.tagName === 'SUMMARY') return 'details';
    const hp = el.getAttribute('aria-haspopup');
    if (hp === 'dialog' || el.hasAttribute('data-dialog-open')) return 'dialog';
    if (/burger|hamburger|menu-toggle/i.test(el.className) || /menu/i.test(el.getAttribute('aria-label') || '') && el.hasAttribute('aria-controls')) return 'burger';
    if (hp) return 'dropdown';
    if (/next|prev/i.test(el.getAttribute('aria-label') || '')) return 'carousel';
    if (el.hasAttribute('aria-expanded')) return 'accordion';
    return 'toggle';
  }

  /** Visibility of everything that could appear or disappear, plus the states that say "open". */
  function snapshot(scan) {
    const vis = new Map();
    for (const el of document.body.querySelectorAll('*')) { if (!scan.ignore.contains(el) && vis.size < 6000) vis.set(el, visible(el)); }
    const aria = [...document.querySelectorAll('[aria-expanded], [aria-selected], details, dialog')].map(e => `${e.getAttribute('aria-expanded')}|${e.getAttribute('aria-selected')}|${e.open}`).join(',');
    // Horizontal scrollers (carousels): their position, and transforms of slide tracks.
    const scrollers = (scan.scrollers ||= (scan.nodes || []).filter(n => ['auto', 'scroll'].includes(n.style.overflowX)).map(n => n.el));
    const pos = scrollers.map(e => e.scrollLeft).join(',');
    return { vis, aria, scrollY, scrollers: pos };
  }
  function appeared(before, after) {
    const out = [];
    for (const [el, v] of after.vis) {
      if (!v || before.vis.get(el)) continue;
      if (el.parentElement && after.vis.get(el.parentElement) && !before.vis.get(el.parentElement)) continue; // only the topmost
      out.push(el);
    }
    return out;
  }
  /** What is different from the start (empty = the page is back as it was). */
  const differences = (a, b) => {
    const out = [];
    if (a.aria !== b.aria) out.push('open/selected states (aria-expanded / aria-selected / details / dialog)');
    for (const [el, v] of a.vis) if (el.isConnected && b.vis.get(el) !== v && out.length < 6) out.push(`${sel(el)} ${v ? 'hidden' : 'visible'} now`);
    if (a.scrollers !== b.scrollers) out.push('a carousel position');
    return out;
  };

  /** The animations that start right after a click (they're over by the time we look at the result). */
  function runningAnimations(scan) {
    return document.getAnimations().filter(a => a.playState === 'running' && a.effect?.target && !scan.ignore.contains(a.effect.target)).map(a => {
      const kf = a.effect.getKeyframes?.().map(k => Object.fromEntries(Object.entries(k).filter(([key]) => ['offset', 'opacity', 'transform', 'easing'].includes(key)))).slice(0, 4) || [];
      const timing = a.effect.getTiming();
      // CSS animations keep their timing function on the keyframes.
      const easing = timing.easing === 'linear' && kf[0]?.easing && kf.every(k => k.easing === kf[0].easing) ? kf[0].easing : timing.easing;
      return { target: a.effect.target, name: a.animationName || (a.transitionProperty ? `transition: ${a.transitionProperty}` : 'animation'), duration: Math.round(timing.duration || 0), easing, delay: Math.round(timing.delay || 0), keyframes: kf.map(({ easing: e, ...k }) => k) };
    });
  }

  function describeAppearance(el, trigger, started = []) {
    const r = el.getBoundingClientRect(), t = trigger.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const anims = started.filter(a => a.target === el || el.contains(a.target) && a.target.parentElement === el).map(({ target, ...a }) => a);
    const where = el.matches('dialog[open]') || cs.position === 'fixed'
      ? (r.width >= innerWidth * 0.95 ? 'full screen overlay' : r.right >= innerWidth - 2 && r.height >= innerHeight * 0.8 ? 'drawer from the right' : r.left <= 2 && r.height >= innerHeight * 0.8 ? 'drawer from the left' : 'centred overlay')
      : r.top >= t.bottom - 2 ? `below the trigger (${Math.round(r.top - t.bottom)}px gap, left ${Math.round(r.left - t.left)}px)` : r.bottom <= t.top + 2 ? 'above the trigger' : 'in place (the content below moves)';
    return {
      selector: sel(el), where, position: el.matches('dialog[open]') ? 'top layer (modal dialog)' : cs.position, zIndex: cs.zIndex,
      size: { w: Math.round(r.width), h: Math.round(r.height) },
      animation: anims.length ? anims : (cs.transitionDuration !== '0s' ? [{ name: `transition: ${cs.transitionProperty}`, duration: Math.round(parseFloat(cs.transitionDuration) * 1000), easing: cs.transitionTimingFunction }] : []),
      backdrop: el.matches('dialog[open]') ? getComputedStyle(el, '::backdrop').backgroundColor : null,
    };
  }

  const escape = scan => scan.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).then(() => scan.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }));
  const closeButtonIn = el => [...el.querySelectorAll('button, [role="button"]')].find(b => /close|dismiss|✕|×|закрыть/i.test(`${b.getAttribute('aria-label') || ''} ${b.textContent} ${b.className} ${Object.keys(b.dataset).join(' ')}`));

  async function tryClose(scan, trigger, shown, before) {
    const SAFE = e => Mochi.deepSafety.isSafeToClick(e, { ignore: scan.ignore }).ok;
    const ways = [
      ['Esc', async () => escape(scan)],
      ['the same button again', async () => { if (visible(trigger) && SAFE(trigger)) trigger.click(); }],
      ['a close button inside', async () => { const b = shown.map(closeButtonIn).find(Boolean); if (b && SAFE(b)) b.click(); }],
      ['a click outside', async () => { const dlg = shown.find(e => e.matches('dialog')); (dlg || document.body).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 2, clientY: innerHeight - 2 })); }],
    ];
    const worked = [];
    for (const [name, act] of ways) {
      if (!shown.some(visible)) { // closed already: open it again to test the next way
        trigger.click();
        await sleep(350);
        if (!shown.some(visible)) break;
      }
      await act();
      await sleep(400);
      if (!shown.some(visible)) worked.push(name);
    }
    if (shown.some(visible)) { await escape(scan).catch(() => {}); if (visible(trigger) && SAFE(trigger)) trigger.click(); await sleep(400); }
    return worked;
  }

  async function shot(scan, name, els, meta) {
    const rects = els.filter(e => e.isConnected).map(e => e.getBoundingClientRect()).filter(r => r.width > 0);
    if (!rects.length) return null;
    const x = Math.min(...rects.map(r => r.left)) - 24, y = Math.min(...rects.map(r => r.top)) - 24;
    const w = Math.max(...rects.map(r => r.right)) + 24 - x, h = Math.max(...rects.map(r => r.bottom)) + 24 - y;
    const clip = w * h > innerWidth * innerHeight * 0.6 ? { x: scrollX, y: scrollY, width: innerWidth, height: innerHeight } : { x: x + scrollX, y: y + scrollY, width: w, height: h };
    await Mochi.deepShots.capture(scan, { name: `states/${name}.png`, clip, meta });
    return `screenshots/states/${name}.png`;
  }

  async function exercise(scan, trigger, k, extra = {}) {
    const kind = kindOf(trigger);
    trigger.scrollIntoView({ block: 'center', behavior: 'instant' });
    await sleep(250);
    const before = snapshot(scan);
    const name = `${kind}-${k}${extra.width ? `-${extra.width}` : ''}`;
    trigger.click();
    await new Promise(r => requestAnimationFrame(() => r()));
    const started = runningAnimations(scan);
    await sleep(kind === 'carousel' ? 700 : 450);
    const after = snapshot(scan);
    const shown = appeared(before, after);
    const changedAria = before.aria !== after.aria;
    const moved = before.scrollers !== after.scrollers;
    const entry = { kind, trigger: sel(trigger), opens: [], ...extra };
    if (!shown.length && !changedAria && !moved) { entry.effect = 'nothing visible changed'; return entry; }
    if (moved) {
      const target = document.getElementById(trigger.getAttribute('aria-controls') || '') || (scan.scrollers || []).find(e => e.scrollLeft > 0);
      const step = target ? Math.round(target.scrollLeft) : null;
      entry.effect = `scrolls the carousel${step ? ` by ${step}px` : ''}${target && getComputedStyle(target).scrollBehavior === 'smooth' ? ' (smooth)' : ''}`;
      entry.shot = await shot(scan, name, [target || trigger], { kind, trigger: entry.trigger });
      if (target) target.scrollTo({ left: 0, behavior: 'instant' }); // back to the start
      entry.closes = [];
      return entry;
    }
    entry.opens = shown.slice(0, 3).map(el => describeAppearance(el, trigger, started));
    entry.shot = await shot(scan, name, [trigger, ...shown.slice(0, 2)], { kind, trigger: entry.trigger });
    if (kind === 'tab') entry.closes = ['another tab'];
    else if (kind === 'details') { entry.closes = ['the same summary again']; const d = trigger.closest('details'); if (d?.open) { trigger.click(); await sleep(300); } }
    else if (shown.length) entry.closes = await tryClose(scan, trigger, shown, before);
    else if (changedAria && visible(trigger) && Mochi.deepSafety.isSafeToClick(trigger, { ignore: scan.ignore }).ok) { trigger.click(); await sleep(350); entry.closes = ['the same button again']; }
    return entry;
  }

  async function run(scan) {
    const S = Mochi.deepSafety;
    // "Next" arrows first (a "previous" arrow at the start does nothing).
    const all = [...document.querySelectorAll(CANDIDATES)].filter(el => !scan.ignore.contains(el) && visible(el))
      .sort((a, b) => (/prev/i.test(a.getAttribute('aria-label') || '') ? 1 : 0) - (/prev/i.test(b.getAttribute('aria-label') || '') ? 1 : 0));
    const seen = new Set();
    const picked = [];
    const refused = [];
    for (const el of all) {
      const ok = S.isSafeToClick(el, { ignore: scan.ignore });
      if (!ok.ok) { refused.push({ selector: sel(el), why: ok.why }); continue; }
      const kind = kindOf(el);
      // One of each accordion/details/carousel, every tab and dropdown, up to three dialog triggers.
      const key = ['accordion', 'details', 'carousel'].includes(kind) ? kind : kind === 'dialog' ? `dialog-${seen.has('dialog-2') ? 3 : seen.has('dialog-1') ? 2 : 1}` : `${kind}-${sel(el)}-${picked.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(el);
      if (picked.length >= MAX_CONTROLS) break;
    }
    const states = [{ name: 'initial', shot: 'screenshots/full-1440.png' }];
    const controls = [];
    const firstTab = document.querySelector('[role="tab"][aria-selected="true"]');
    const start = snapshot(scan);
    for (const [k, el] of picked.entries()) {
      scan.check();
      try { controls.push(await exercise(scan, el, k + 1)); } catch (err) { controls.push({ trigger: sel(el), error: String(err.message || err) }); }
      scan.progress((k + 1) / (picked.length + 1));
    }
    if (firstTab && firstTab.getAttribute('aria-selected') !== 'true') { firstTab.click(); await sleep(300); } // back to the first tab

    // The mobile navigation, at 390px.
    try {
      await D.setWidth(scan, 390);
      const burger = [...document.querySelectorAll('button, [role="button"]')].find(b => visible(b) && !scan.ignore.contains(b) && kindOf(b) === 'burger' && S.isSafeToClick(b, { ignore: scan.ignore }).ok);
      if (burger) controls.push(await exercise(scan, burger, 'mobile', { width: 390 }));
    } finally {
      await scan.cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
      await sleep(300);
    }
    document.activeElement?.blur?.();
    scrollTo({ top: 0, behavior: 'instant' });
    await sleep(650); // let scroll-driven fades (a "back to top" button…) settle before comparing
    const end = snapshot(scan);
    for (const c of controls) {
      if (!c.opens?.length && !(c.kind === 'tab' && !c.effect)) continue;
      const label = { tab: 'tab active', dropdown: 'menu open', dialog: 'modal open', burger: 'mobile nav open', accordion: 'accordion item open', details: 'details open', carousel: 'carousel moved' }[c.kind] || 'open';
      states.push({ name: `${label}${c.width ? ` (${c.width}px)` : ''}`, trigger: c.trigger, shot: c.shot || null });
    }
    scan.spec.states = {
      ...(scan.spec.states || {}),
      clicks: controls,
      pageStates: states,
      notClicked: refused.slice(0, 30),
      restored: differences(start, end).length === 0,
      notRestored: differences(start, end),
    };
  }

  Mochi.deepClicks = { kindOf, snapshot, appeared };
  D.addPhase({ id: 'clicks', order: 55, cdp: true, label: 'deep.step.clicks', budget: 60000, weight: 2, run });
})();
