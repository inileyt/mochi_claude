/*
 * Mochi — note reminders on revisit (only after you turned them on and Chrome said yes).
 * A tiny script on every page: it reads Mochi's notes index (in this browser) and, when this
 * page or its site has a note, a little Mochi peeks in from the corner. It reads nothing on
 * the page and sends nothing anywhere; the full Mochi comes only if you click him.
 */
(() => {
  if (window.top !== window || globalThis.__mochiPeek) return;
  globalThis.__mochiPeek = true;
  const TEXT = {
    en: 'You have a note here!', ru: 'У тебя тут заметка!', uk: 'У тебе тут нотатка!', hy: 'Այստեղ նշում ունես։', de: 'Du hast hier eine Notiz!',
    es: '¡Tienes una nota aquí!', fr: 'Tu as une note ici !', it: 'Hai una nota qui!', pt: 'Você tem uma nota aqui!', ja: 'ここにメモがあるよ！', zh: '这里有你的笔记！',
  };
  const CLOSE = { en: 'Close', ru: 'Закрыть', uk: 'Закрити', hy: 'Փակել', de: 'Schließen', es: 'Cerrar', fr: 'Fermer', it: 'Chiudi', pt: 'Fechar', ja: '閉じる', zh: '关闭' };

  setTimeout(async () => {
    if (document.querySelector('mochi-companion')) return; // Mochi is here already: his own paper shows the notes
    const n = globalThis.Mochi?.noteUrl?.normalize(location.href);
    if (!n) return;
    let data = {};
    try { data = await chrome.storage.local.get(['notes.index', 'mochi.settings']); } catch (_) { return; }
    const index = data['notes.index'] || {};
    const count = [`page:${n.page}`, `site:${n.site}`].filter(k => index[k]?.len > 0).length;
    if (!count) return;
    let lang = data['mochi.settings']?.lang;
    if (!lang || lang === 'auto') lang = (navigator.language || 'en').slice(0, 2);
    const say = TEXT[lang] || TEXT.en;

    const host = document.createElement('mochi-peek');
    host.setAttribute('data-count', String(count));
    host.style.cssText = 'all:initial;display:block;position:fixed;right:16px;bottom:0;z-index:2147483000;';
    const root = host.attachShadow({ mode: 'closed' });
    // A tiny pixel Mochi (orange, two eyes) peeking up from the bottom edge.
    root.innerHTML = `<style>
      :host{all:initial}
      .wrap{display:flex;align-items:flex-end;gap:6px;font:700 12px/1.3 ui-monospace,Menlo,Consolas,monospace;animation:up .5s steps(4,end) both}
      .bubble{position:relative;margin-bottom:46px;padding:5px 24px 5px 9px;background:#fffaf0;color:#2b1208;border:3px solid #4a2410;box-shadow:3px 3px 0 rgba(0,0,0,.25);cursor:pointer}
      .x{all:unset;position:absolute;right:3px;top:2px;width:16px;text-align:center;cursor:pointer;color:#4a2410}
      .mochi{all:unset;cursor:pointer;display:block;width:48px;height:40px;image-rendering:pixelated}
      .bubble:focus-visible,.mochi:focus-visible,.x:focus-visible{outline:3px solid #f28c38;outline-offset:2px}
      @keyframes up{from{transform:translateY(60px)}to{transform:none}}
      @media (prefers-reduced-motion:reduce){.wrap{animation:none}}
    </style>
    <div class="wrap"><div class="bubble" role="button" tabindex="0"></div>
    <button class="mochi" type="button"><svg viewBox="0 0 12 10" width="48" height="40" shape-rendering="crispEdges" aria-hidden="true">
      <rect x="1" y="1" width="10" height="9" fill="#4a2410"/><rect x="2" y="2" width="8" height="8" fill="#f28c38"/>
      <rect x="2" y="2" width="8" height="1" fill="#ffb26b"/><rect x="4" y="4" width="1" height="2" fill="#2b1208"/><rect x="7" y="4" width="1" height="2" fill="#2b1208"/>
      <rect x="5" y="0" width="2" height="1" fill="#f28c38"/></svg></button></div>`;
    const bubble = root.querySelector('.bubble');
    bubble.textContent = say;
    const x = document.createElement('button');
    x.className = 'x'; x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', CLOSE[lang] || CLOSE.en);
    bubble.append(x);
    root.querySelector('.mochi').setAttribute('aria-label', say);
    const go = () => { host.remove(); chrome.runtime.sendMessage({ type: 'mochi-tools', op: 'peekOpen' }).catch(() => {}); };
    x.addEventListener('click', ev => { ev.stopPropagation(); host.remove(); });
    bubble.addEventListener('click', go);
    bubble.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
    root.querySelector('.mochi').addEventListener('click', go);
    document.documentElement.append(host);
    setTimeout(() => host.remove(), 15000); // a peek, not a guest
  }, 1200);
})();
