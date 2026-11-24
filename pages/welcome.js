// The welcome page: hello → color + name → chat sites → open claude.ai.
(async () => {
  const { pages } = Mochi;
  const t = Mochi.t;
  await Mochi.settings.load();
  pages.translate();
  document.title = t('welcome.pageTitle');

  // ——— Mochi pictures in the chosen color ———
  const colorId = () => Mochi.settings.get('colors.mochi') || 'orange';
  const picture = (id, mood = 'happy', size = 140) => {
    const img = new Image(size, size);
    img.alt = '';
    const colors = { ...Mochi.art.ROLE_DEFAULTS, ...Mochi.colorThemes[id] };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(Mochi.art.staticSvg({ mood, colors, size, withShadow: false }))}`;
    return img;
  };
  const drawAll = () => {
    for (const [el, mood] of [['mochi-1', 'happy'], ['mochi-2', 'happy'], ['mochi-4', 'excited']]) document.getElementById(el).replaceChildren(picture(colorId(), mood));
    const name = Mochi.petName();
    document.getElementById('preview-say').textContent = name ? t('welcome.hiNamed', { name }) : t('welcome.hi');
  };

  // ——— step 2: color + name ———
  const swatches = document.getElementById('swatches');
  const renderSwatches = () => swatches.replaceChildren(...Object.keys(Mochi.colorThemes).map(id => {
    const on = colorId() === id;
    const b = pages.h('button', { class: 'swatch', type: 'button', role: 'radio', 'aria-checked': String(on), 'data-color': id, tabindex: on ? '0' : '-1',
      onclick: () => { Mochi.settings.set('colors.mochi', id); renderSwatches(); drawAll(); swatches.querySelector(`[data-color="${id}"]`).focus(); } },
    picture(id, 'happy', 44), pages.h('span', { text: t(`color.${id}`) }));
    return b;
  }));
  swatches.addEventListener('keydown', ev => {
    const ids = Object.keys(Mochi.colorThemes);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
    if (!step) return;
    ev.preventDefault();
    const next = ids[(ids.indexOf(colorId()) + step + ids.length) % ids.length];
    swatches.querySelector(`[data-color="${next}"]`).click();
  });
  const nameInput = document.getElementById('name');
  nameInput.value = Mochi.petName();
  let nameTimer = 0;
  nameInput.addEventListener('input', () => {
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => { Mochi.settings.set('name', nameInput.value.trim().slice(0, 20)); drawAll(); }, 250);
    document.getElementById('preview-say').textContent = nameInput.value.trim() ? t('welcome.hiNamed', { name: nameInput.value.trim() }) : t('welcome.hi');
  });

  // ——— step 3: sites ———
  pages.sitesWidget(document.getElementById('sites-list'));

  // ——— step 4: image-text languages (OCR) — same codes as src/image-scan/langs.js ———
  (() => {
    const list = document.getElementById('ocr-langs-list');
    if (!list) return;
    const AVAILABLE = ['eng', 'rus', 'hye', 'deu', 'fra', 'spa', 'ita', 'por', 'ukr', 'ell'];
    const DEFAULT = ['eng', 'rus', 'hye'];
    const NAMES = { eng: 'English', rus: 'Русский', hye: 'Հայերեն', deu: 'Deutsch', fra: 'Français', spa: 'Español', ita: 'Italiano', por: 'Português', ukr: 'Українська', ell: 'Ελληνικά' };
    const current = () => { const l = Mochi.settings.get('imageScan.langs'); const c = Array.isArray(l) ? l.filter(x => AVAILABLE.includes(x)) : []; return c.length ? c : DEFAULT.slice(); };
    const on = new Set(current());
    const save = () => Mochi.settings.set('imageScan.langs', AVAILABLE.filter(x => on.has(x)));
    for (const code of AVAILABLE) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'px-btn lang-chip'; btn.dataset.lang = code;
      btn.setAttribute('aria-pressed', String(on.has(code)));
      const label = () => `${on.has(code) ? '● ' : '○ '}${NAMES[code]}`;
      btn.textContent = label();
      btn.addEventListener('click', () => {
        if (on.has(code)) on.delete(code); else on.add(code);
        if (!on.size) on.add(code); // never leave it empty
        btn.setAttribute('aria-pressed', String(on.has(code)));
        btn.textContent = label();
        save();
      });
      list.append(btn);
    }
  })();

  // ——— steps ———
  const steps = [...document.querySelectorAll('.step')];
  const back = document.getElementById('back'), next = document.getElementById('next'), skip = document.getElementById('skip');
  let at = 1;
  function go(n, { focus = true } = {}) {
    at = Math.max(1, Math.min(steps.length, n));
    for (const s of steps) s.hidden = Number(s.dataset.step) !== at;
    back.hidden = at === 1;
    next.hidden = skip.hidden = at === steps.length;
    document.querySelectorAll('.dots i').forEach((d, i) => d.classList.toggle('on', i < at));
    document.getElementById('step-count').textContent = t('welcome.stepOf', { n: at, total: steps.length });
    if (focus) steps[at - 1].querySelector('h1').focus({ preventScroll: true });
    history.replaceState(null, '', `#step${at}`);
  }
  back.addEventListener('click', () => go(at - 1));
  next.addEventListener('click', () => go(at + 1));
  skip.addEventListener('click', () => go(steps.length));
  // Make sure the name/color are saved before leaving for claude.ai.
  document.getElementById('open-claude').addEventListener('click', () => { if (nameInput.value.trim() !== Mochi.petName()) Mochi.settings.set('name', nameInput.value.trim().slice(0, 20)); Mochi.store.flush(); });

  renderSwatches();
  drawAll();
  go(Number((location.hash.match(/^#step(\d)$/) || [])[1]) || 1, { focus: false });
})();
