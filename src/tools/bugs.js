/*
 * Mochi — Bug Reporter (loaded the first time it's used). Press Record, do what goes wrong, press
 * Stop: Mochi has written the steps (what you clicked, which fields you filled in — never what you
 * typed), caught the page's errors and failed requests (through the DevTools connection, report mode:
 * nothing is stopped or changed), and taken a screenshot after each step. You add a title and what
 * you expected, and get a report: for Claude (to find the cause), for a GitHub issue, or as a zip.
 * Everything stays on this computer until you copy or send it yourself.
 *
 * Storage (chrome.storage.local): bug.recording (steps, tied to the tab), bug.shots (≤ 15 screenshots).
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const B = Mochi.bugReport;
  const T = (k, v) => Mochi.t(k, v);
  const REC = 'bug.recording', SHOTS = 'bug.shots', MAX_SHOTS = 15;
  const CLICKABLE = 'a[href], button, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"], [role="checkbox"], input, select, textarea, summary, label';
  const send = (op, extra = {}) => (globalThis.chrome?.runtime?.id ? chrome.runtime.sendMessage({ type: 'mochi-tools', op, ...extra }).then(r => (r?.ok ? r.result : null)).catch(() => null) : Promise.resolve(null));
  const name = el => String(el.getAttribute('aria-label') || (el.labels?.[0]?.textContent) || el.getAttribute('placeholder') || el.innerText || el.value && el.type === 'submit' && el.value || el.getAttribute('title') || el.name || el.tagName.toLowerCase()).replace(/\s+/g, ' ').trim().slice(0, 60);

  let rec = null; // { ctx, scope, card, counts, lastShot }

  async function open(ctx, opts = {}) {
    if (opts.resume) return resume(ctx);
    if (rec) return true;
    const { h } = Mochi.ui;
    Mochi.menuInstance?.close();
    const errors = h('input', { type: 'checkbox', checked: true, id: 'bug-errors' });
    ctx.panel.open(T('bug.title'), location.hostname || T('deep.thisPage'), h('div', { class: 'deep' },
      h('p', { text: T('bug.what') }),
      h('ul', { class: 'deep-list' }, ...['bug.r1', 'bug.r2', 'bug.r3'].map(k => h('li', { text: T(k) }))),
      h('label', { class: 'deep-own' }, errors, h('span', { text: T('bug.withErrors') })),
      h('p', { class: 'note', text: T('bug.private') })),
      h('div', { class: 'row' }, h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'bug-start', onclick: () => start(ctx, { errors: errors.checked }) }, `● ${T('bug.start')}`)));
    ctx.panel.view = 'bug-intro';
    return true;
  }

  async function start(ctx, { errors = true } = {}) {
    ctx.panel.close();
    let cdp = false, why = '';
    if (errors) { try { await Mochi.cdp.attach('report'); cdp = true; } catch (err) { why = String(err?.message || err); } }
    await Mochi.store.set(REC, { startUrl: location.href.split('#')[0], title: document.title.slice(0, 90), steps: [], at: Date.now(), cdp, env: env() });
    await Mochi.store.set(SHOTS, []);
    await send('bugRecordHere');
    if (errors && !cdp) ctx.companion.say(T('bug.noErrors', { why: why.slice(0, 40) }), 4000);
    return resume(ctx, { fresh: true });
  }
  const env = () => ({ url: location.href.split('#')[0], title: document.title.slice(0, 120), ua: navigator.userAgent.replace(/^Mozilla\/5\.0 /, ''), viewport: `${innerWidth}×${innerHeight}`, dpr: devicePixelRatio, lang: navigator.language, time: Date.now() });

  async function resume(ctx, { fresh = false } = {}) {
    const r = await Mochi.store.get(REC, null);
    if (!r) return false;
    if (rec) { rec.scope.dispose(); rec.card.remove(); }
    const { h } = Mochi.ui;
    const scope = Mochi.tools.scope('bugs');
    const count = h('b', {});
    const card = h('section', { class: 'gd-card rec bug', role: 'region', 'aria-label': T('bug.recording') },
      h('header', { class: 'gd-head' }, h('span', { class: 'gd-dot', 'aria-hidden': 'true' }), count),
      h('p', { class: 'note', text: T('bug.recHint') }),
      h('div', { class: 'row' },
        h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'bug-stop', onclick: () => stop(ctx) }, `■ ${T('bug.stop')}`),
        h('button', { class: 'px-btn', type: 'button', 'data-act': 'bug-cancel', onclick: () => cancel(ctx) }, T('deep.cancel'))));
    ctx.companion.shadow.append(card);
    rec = { ctx, scope, card, counts: { steps: r.steps.length, errors: 0, failed: 0 }, lastShot: 0 };
    const label = () => { count.textContent = T('bug.counts', { s: rec.counts.steps, e: rec.counts.errors, f: rec.counts.failed }); };
    label();
    ctx.companion.hold('magnifier');
    // What goes wrong, as it happens (the background keeps them too).
    if (r.cdp) {
      try { for (const e of (await Mochi.cdp.events()) || []) { if (e.kind === 'http' || e.kind === 'failed') rec.counts.failed++; else if (e.level !== 'warning') rec.counts.errors++; } } catch (_) { /* not attached (any more) */ }
      label();
      const off = Mochi.cdp.on('Mochi.report', e => {
        if (!rec) return;
        if (e.kind === 'http' || e.kind === 'failed') rec.counts.failed++; else if (e.level !== 'warning') rec.counts.errors++;
        label();
        if (e.level !== 'warning') { ctx.companion.flashFace({ eyes: 'wide', mouth: 'small-o' }, 900); ctx.companion.flashFx('exclaim', 1200); ctx.companion.say(T('bug.caught'), 1400); }
      });
      rec.offEvents = off;
    }
    const addStep = async text => {
      const cur = await Mochi.store.get(REC, null);
      if (!cur) return;
      if (cur.steps.at(-1)?.text === text) return;
      cur.steps.push({ text, url: location.href.split('#')[0], at: Date.now() });
      await Mochi.store.set(REC, cur);
      rec.counts.steps = cur.steps.length;
      label();
      shot(cur.steps.length - 1, cur.cdp);
    };
    // A new page in the same recording.
    if (!fresh && r.steps.at(-1)?.url !== location.href.split('#')[0]) addStep(`Opened ${location.href.split('#')[0]}`);
    scope.on(document, 'click', ev => {
      if (ev.composedPath().includes(ctx.companion.host)) return;
      const el = ev.target instanceof Element ? ev.target.closest(CLICKABLE) : null;
      if (!el || (/^(INPUT|TEXTAREA)$/.test(el.tagName) && !/^(submit|button|checkbox|radio)$/.test(el.type))) return;
      const n = name(el);
      if (n) addStep(`Click “${n}”`);
    }, { capture: true, passive: true });
    scope.on(document, 'change', ev => {
      const el = ev.target;
      if (!(el instanceof Element) || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || /^(submit|button|checkbox|radio|hidden)$/.test(el.type)) return;
      const n = name(el) || el.type;
      addStep(el.tagName === 'SELECT' ? `Choose an option in “${n}”` : el.type === 'password' ? `Type a password into “${n}”` : `Fill in “${n}”`);
    }, { capture: true, passive: true });
    if (fresh) ctx.companion.say(T('bug.recOn'), 2400);
    return true;
  }

  /** A screenshot after a step (Mochi steps out of the picture), through the DevTools connection. */
  async function shot(step, cdp) {
    if (!cdp || !rec || Date.now() - rec.lastShot < 1200) return;
    rec.lastShot = Date.now();
    const host = rec.ctx.companion.host;
    await new Promise(r => setTimeout(r, 350)); // the page reacts to the click first
    host.style.visibility = 'hidden';
    try {
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const { data } = await Mochi.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 55 });
      await Mochi.store.update(SHOTS, (list = []) => (list.length >= MAX_SHOTS ? list : [...list, { step, data }]), []);
    } catch (_) { /* no screenshot this time */ } finally { host.style.visibility = ''; }
  }

  async function finishRecording() {
    const r = await Mochi.store.get(REC, null);
    let events = [];
    if (r?.cdp) { try { const d = await Mochi.cdp.detachAny('done'); events = d?.events || []; } catch (_) { events = []; } }
    if (rec) { rec.offEvents?.(); rec.scope.dispose(); rec.card.remove(); rec.ctx.companion.hold(null); rec = null; }
    await Mochi.store.set(REC, null);
    send('bugRecordStop');
    return { r, events };
  }
  async function cancel(ctx) { await finishRecording(); await Mochi.store.set(SHOTS, []); ctx.companion.say(T('say.okay'), 1200); }

  async function stop(ctx) {
    const { r, events } = await finishRecording();
    if (!r) return null;
    const shots = ((await Mochi.store.get(SHOTS, [])) || []).map((x, i) => ({ ...x, name: `${String(i + 1).padStart(2, '0')}.jpg` }));
    ctx.companion.play('hop');
    return showReport(ctx, { ...r, events, shots });
  }

  function showReport(ctx, data) {
    const { h, copyText } = Mochi.ui;
    const { panel, companion } = ctx;
    const s = B.summary(data.events);
    const title = h('input', { class: 'lib-input', type: 'text', 'data-field': 'title', placeholder: T('bug.titleHint'), 'aria-label': T('bug.titleLabel') });
    const expected = h('textarea', { class: 'lib-text', rows: '2', 'data-field': 'expected', placeholder: T('bug.expectedHint'), 'aria-label': T('bug.expected') });
    const actual = h('textarea', { class: 'lib-text', rows: '2', 'data-field': 'actual', placeholder: T('bug.actualHint'), 'aria-label': T('bug.actual') });
    const preview = h('textarea', { class: 'export bug-md', readonly: true, spellcheck: 'false', 'aria-label': 'report.md' });
    const md = () => B.markdown({ title: title.value, expected: expected.value, actual: actual.value, steps: data.steps, events: data.events, env: data.env, shots: data.shots });
    const refresh = () => { preview.value = md(); };
    for (const el of [title, expected, actual]) el.addEventListener('input', refresh);
    refresh();
    const thumbs = data.shots.length ? h('div', { class: 'deep-shots bug-shots' }, ...data.shots.slice(0, 6).map(x => h('figure', {}, h('img', { src: `data:image/jpeg;base64,${x.data}`, alt: '' }), h('figcaption', { text: `${x.name} · ${T('bug.afterStep', { n: x.step + 1 })}` })))) : null;
    panel.open(T('bug.reportTitle'), T('bug.summary', { s: data.steps.length, e: s.errors, f: s.failed }), h('div', { class: 'bug-report' },
      h('label', { class: 'lib-label' }, T('bug.titleLabel'), title),
      h('label', { class: 'lib-label' }, T('bug.expected'), expected),
      h('label', { class: 'lib-label' }, T('bug.actual'), actual),
      thumbs,
      h('section', { class: 'blk' }, h('h4', { text: 'report.md' }), preview)),
    h('div', { class: 'row' },
      ctx.isClaude
        ? h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'bug-paste', onclick: async () => { panel.close(); ctx.engine.pasted(await Mochi.insertIntoComposer(B.forClaude(md()))); } }, `✎ ${T('panel.pasteToClaude')}`)
        : h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'bug-claude', onclick: async () => {
          const text = B.forClaude(md());
          await copyText(text, companion.shadow);
          await Mochi.pocket.add({ v: 1, id: `bug_${Date.now().toString(36)}`, kind: 'note', url: data.env?.url, host: location.hostname, title: title.value || T('bug.title'), at: new Date().toISOString(), colors: [], vibe: [{ id: 'bug', label: T('bug.chip') }], paste: text }, { offered: false });
          companion.say(T('bug.toClaude'), 3000);
        } }, `✎ ${T('bug.forClaude')}`),
      h('button', { class: 'px-btn', type: 'button', 'data-act': 'bug-copy', onclick: async () => { await copyText(md(), companion.shadow); ctx.actions.copied(T('bug.forGithub')); } }, `⧉ ${T('bug.forGithub')}`),
      h('button', { class: 'px-btn', type: 'button', 'data-act': 'bug-zip', onclick: () => {
        const files = [{ name: 'report.md', data: md() }, ...data.shots.map(x => ({ name: `screenshots/${x.name}`, data: Uint8Array.from(atob(x.data), c => c.charCodeAt(0)) }))];
        const bytes = Mochi.zip.build(files);
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
        const a = h('a', { href: url, download: `bug-report-${(location.hostname || 'page').replace(/[^a-z0-9.-]/gi, '')}.zip`, style: { display: 'none' } });
        companion.shadow.append(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
        ctx.actions.downloaded('bug-report.zip');
      } }, '⤓ .zip')));
    panel.view = 'bug-report';
    requestAnimationFrame(() => title.focus());
    if (s.errors || s.failed) companion.say(T('bug.found', { n: s.errors + s.failed }), 3000);
    return true;
  }

  Mochi.toolImpl.bugs = {
    open, start, stop, cancel,
    close: () => { if (rec) cancel(rec.ctx); },
    get isOpen() { return !!rec; },
    get state() { return rec ? { recording: true, ...rec.counts } : { recording: false }; },
  };
})();
