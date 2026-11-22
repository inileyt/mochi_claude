/*
 * Mochi's own pages: texts in your language (the same locale files as Mochi),
 * and the list of chat sites with their on/off switches (options + welcome).
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const t = (...a) => Mochi.t(...a);

  /** Fill [data-i18n] (text), [data-i18n-aria] (aria-label) and the <title>. */
  function translate(root = document) {
    for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
    document.documentElement.lang = Mochi.lang();
  }

  const ask = (method, extra = {}) => new Promise(resolve => {
    try {
      chrome.runtime.sendMessage({ type: 'mochi-sites', method, ...extra }, res => {
        void chrome.runtime.lastError;
        resolve(res?.ok ? res.result : null);
      });
    } catch (_) { resolve(null); }
  });

  const ORIGINS = { chatgpt: ['https://chatgpt.com/*'], gemini: ['https://gemini.google.com/*'] };
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    el.append(...kids.filter(Boolean));
    return el;
  };

  /**
   * The site list: Claude (always on), ChatGPT and Gemini (each asks Chrome first).
   * chrome.permissions.request must run straight from the click, before any await.
   */
  function sitesWidget(root, { onChange } = {}) {
    const list = h('ul', { class: 'sites' });
    const msg = h('p', { class: 'msg', role: 'status', 'aria-live': 'polite' });
    root.append(list, msg, h('p', { class: 'note', text: t('page.sitesNote') }));
    let state = {};

    const row = (id, name, sub, on, locked) => {
      const sw = h('button', {
        class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(on), 'data-site': id,
        'aria-label': `${name}: ${on ? t('page.on') : t('page.off')}`,
        ...(locked ? { 'aria-disabled': 'true', title: t('page.claudeAlways') } : {}),
        onclick: () => (locked ? null : toggle(id, name)),
      });
      return h('li', { class: 'site-row', 'data-site': id },
        h('div', { class: 'name' }, h('b', { text: name }), h('span', { text: sub })),
        h('span', { class: `state${on ? ' on' : ''}`, text: on ? t('page.on') : t('page.off') }),
        sw);
    };

    function render() {
      list.replaceChildren(
        row('claude', 'Claude', t('page.claudeAlways'), true, true),
        row('chatgpt', 'ChatGPT', 'chatgpt.com', !!state.chatgpt?.granted, false),
        row('gemini', 'Gemini', 'gemini.google.com', !!state.gemini?.granted, false));
    }

    function toggle(id, name) {
      msg.className = 'msg'; msg.textContent = '';
      if (state[id]?.granted) {
        ask('disable', { id }).then(s => { if (s) state = s; render(); msg.textContent = t('page.siteOff', { site: name }); onChange?.(state); });
        return;
      }
      // Chrome shows its own question now ("Read and change your data on chatgpt.com").
      chrome.permissions.request({ origins: ORIGINS[id] }).then(async yes => {
        if (!yes) { msg.className = 'msg warn'; msg.textContent = t('page.siteDenied', { site: name }); return; }
        const s = await ask('sync');
        if (s) state = s; else state[id] = { granted: true };
        render();
        msg.textContent = t('page.siteOn', { site: name });
        onChange?.(state);
      }, () => { msg.className = 'msg warn'; msg.textContent = t('page.siteDenied', { site: name }); });
    }

    render();
    ask('status').then(s => { if (s) { state = s; render(); } });
    // The permission can also change on chrome://extensions: follow it.
    try {
      chrome.permissions.onAdded.addListener(() => ask('status').then(s => { if (s) { state = s; render(); } }));
      chrome.permissions.onRemoved.addListener(() => ask('status').then(s => { if (s) { state = s; render(); } }));
    } catch (_) { /* not an extension page */ }
    return { refresh: () => ask('status').then(s => { if (s) { state = s; render(); } return state; }) };
  }

  Mochi.pages = { translate, sitesWidget, ask, h };
})();
