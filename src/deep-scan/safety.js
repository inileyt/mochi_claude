/*
 * Mochi — Deep Scan safety: the scan looks, it never acts for you.
 *
 * While a deep scan runs:
 *   - links don't navigate (capture-phase click/auxclick → preventDefault), forms
 *     don't submit (capture-phase submit → preventDefault), and the debugger
 *     proxy fails any main-frame document request (src/debugger-proxy.js);
 *   - Mochi only ever clicks controls that pass isSafeToClick(): UI controls
 *     that open/close things (menus, tabs, accordions, dialogs, carousels),
 *     never links, form fields, submit buttons, or anything whose words or
 *     attributes look like buying, paying, deleting, sending, logging out,
 *     subscribing or signing up (English and Russian);
 *   - the scroll position is put back at the end.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  // Words (and word starts) that make a control off-limits. Lowercase; matched against text, labels, names, ids, classes, data attributes, href/action.
  const DENY = [
    'buy', 'purchase', 'pay', 'payment', 'checkout', 'check out', 'order', 'cart', 'basket', 'donate', 'subscribe', 'subscription', 'upgrade', 'billing', 'book now', 'reserve',
    'delete', 'remove', 'destroy', 'erase', 'discard', 'trash', 'archive', 'reset', 'revoke', 'deactivate', 'close account',
    'send', 'submit', 'post', 'publish', 'reply', 'comment', 'share', 'invite', 'transfer', 'withdraw', 'confirm', 'accept', 'agree', 'approve',
    'log out', 'logout', 'log-out', 'sign out', 'signout', 'sign-out', 'sign up', 'signup', 'sign-up', 'register', 'join', 'log in', 'login', 'sign in', 'signin', 'install', 'download',
    'купить', 'покупк', 'оплат', 'заказ', 'корзин', 'оформить', 'подписк', 'подписат', 'пожертв',
    'удалить', 'удали', 'стереть', 'очистить', 'сбросить', 'отключить',
    'отправ', 'опубликов', 'ответить', 'комментир', 'поделит', 'пригласит', 'перевести', 'вывести', 'подтверд', 'принять', 'согласен',
    'выйти', 'выход', 'зарегистр', 'регистрац', 'войти', 'вход', 'установить', 'скачать',
  ];
  const DENY_RE = new RegExp(`(^|[^\\p{L}])(${DENY.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s_-]?')).join('|')})`, 'iu');

  /** Every bit of text that describes a control (what it says, and its attributes). */
  function describe(el) {
    const attrs = ['aria-label', 'title', 'name', 'value', 'id', 'class', 'href', 'action', 'formaction', 'data-action', 'data-testid', 'data-track', 'data-analytics', 'alt'];
    return [el.textContent || '', ...attrs.map(a => el.getAttribute?.(a) || ''), ...Object.entries(el.dataset || {}).map(([k, v]) => `${k} ${v}`)].join(' ').replace(/\s+/g, ' ').slice(0, 600);
  }
  const looksRisky = el => DENY_RE.test(describe(el));

  /** May the scan click this element? Only UI controls that open/close/switch something, never anything that leaves, sends or changes data. */
  function isSafeToClick(el, { ignore = null } = {}) {
    if (!el || el.nodeType !== 1 || !el.isConnected) return { ok: false, why: 'gone' };
    if (ignore && (el === ignore || ignore.contains?.(el))) return { ok: false, why: 'mochi' };
    if (el.closest('input, textarea, select, [contenteditable="true"], option')) return { ok: false, why: 'form field' };
    const a = el.closest('a[href]');
    if (a) {
      const href = a.getAttribute('href').trim();
      const inPage = href === '#' || (href.startsWith('#') && (a.hasAttribute('aria-controls') || a.getAttribute('role') === 'tab' || a.hasAttribute('data-bs-toggle')));
      if (!inPage && !/^javascript:\s*(void\(0\)|;)?\s*$/i.test(href)) return { ok: false, why: 'link' };
    }
    const btn = el.closest('button, [role="button"], input[type="submit"], input[type="image"]');
    if (btn && btn.tagName === 'BUTTON') {
      const type = (btn.getAttribute('type') || '').toLowerCase();
      if (type === 'submit' || (!type && btn.closest('form'))) return { ok: false, why: 'submit button' };
    }
    if (el.closest('form') && !el.closest('[aria-expanded], [role="tab"], summary')) return { ok: false, why: 'inside a form' };
    if (el.hasAttribute('download') || el.closest('[download]')) return { ok: false, why: 'download' };
    if (looksRisky(el) || (btn && btn !== el && looksRisky(btn))) return { ok: false, why: 'risky words' };
    return { ok: true };
  }

  // ——— the guard while a scan runs ———
  const counts = { clicks: 0, submits: 0 };
  const onClick = ev => {
    const a = ev.target?.closest?.('a[href]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#') && href.length > 1 && !a.hasAttribute('aria-controls')) { ev.preventDefault(); counts.clicks++; return; } // hash jumps scroll the page
    if (!href.startsWith('#') && !/^javascript:/i.test(href)) { ev.preventDefault(); counts.clicks++; }
  };
  const onSubmit = ev => { ev.preventDefault(); counts.submits++; };
  let on = false;
  function install() {
    if (on) return;
    on = true;
    counts.clicks = counts.submits = 0;
    for (const type of ['click', 'auxclick']) addEventListener(type, onClick, true);
    addEventListener('submit', onSubmit, true);
  }
  function uninstall() {
    if (!on) return;
    on = false;
    for (const type of ['click', 'auxclick']) removeEventListener(type, onClick, true);
    removeEventListener('submit', onSubmit, true);
  }

  Mochi.deepSafety = { isSafeToClick, looksRisky, describe, install, uninstall, counts, DENY };
  Mochi.debugHooks = Mochi.debugHooks || {};
  // Test hook: what would the scan be allowed to click? selectors → [{ sel, ok, why }]
  Mochi.debugHooks.deepSafe = selectors => selectors.map(sel => ({ sel, ...isSafeToClick(document.querySelector(sel)) }));

  // The first phase: guard on, remember where you were, start at the top.
  let saved = null;
  Mochi.deepScan.addPhase({
    id: 'prepare', order: 0, always: true, cdp: true, label: 'deep.step.prepare', budget: 8000, weight: 0.3,
    async run(scan) {
      install();
      saved = { x: scrollX, y: scrollY };
      scan.spec.source.startScroll = saved;
      if (document.fonts?.ready) await Promise.race([document.fonts.ready, scan.sleep(3000)]);
      scrollTo({ left: 0, top: 0, behavior: 'instant' });
      await scan.sleep(150);
    },
  });
  Mochi.deepScan.cleanup.push(scan => {
    uninstall();
    if (scan) scan.safety = { blockedLinkClicks: counts.clicks, blockedSubmits: counts.submits };
    if (saved) {
      const { x, y } = saved;
      saved = null;
      scrollTo({ left: x, top: y, behavior: 'instant' });
      // A sticky header that changes height (often with a transition) makes Chrome's scroll anchoring
      // nudge the page while it animates: check again after the usual transition times.
      const again = () => { if (Math.abs(scrollY - y) > 1 || Math.abs(scrollX - x) > 1) scrollTo({ left: x, top: y, behavior: 'instant' }); };
      for (const ms of [50, 350, 800]) setTimeout(again, ms);
    }
  });
})();
