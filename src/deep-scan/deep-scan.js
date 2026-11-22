/*
 * Mochi — Deep Scan: turns the page you're on into a rebuild spec (structure,
 * sizes, styles, states, motion, scroll), built here in your browser and
 * downloaded as a zip. Nothing is sent anywhere.
 *
 * This file is the conductor and the panel. The work is done by phases that
 * the other files in src/deep-scan/ add:
 *   Mochi.deepScan.addPhase({ id, order, label: 'deep.step.x', budget: ms, cdp: true, run: async scan => { … } })
 * A phase reads the page and writes into scan.spec (the data that becomes
 * spec.json), scan.shots (screenshots) and scan.notes. scan.check() throws if
 * you pressed Cancel; scan.progress(fraction) moves the bar within the phase.
 *
 * Deep scan uses Chrome's "debugger" permission (part of Mochi's permissions:
 * Chrome doesn't allow it to be optional); the connection is made for this tab
 * only, during the scan, and always closed at the end.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const phases = [];
  const SPEC_VERSION = 1;
  const MAX_NODES = 5000;

  class Cancelled extends Error { constructor() { super('cancelled'); this.cancelled = true; } }
  class PhaseTimeout extends Error { constructor() { super('phase-timeout'); this.phaseTimeout = true; } }
  const TOTAL_MS = 170000; // the whole scan (the debugger connection closes itself at 6 minutes anyway)

  Mochi.deepScan = {
    phases,
    MAX_NODES,
    SPEC_VERSION,
    Cancelled,
    cleanup: [], // functions(scan) run after every scan (done, cancelled or failed)
    addPhase(p) { phases.push({ order: 50, budget: 20000, cdp: false, ...p }); phases.sort((a, b) => a.order - b.order); },
    running: null,
  };

  Mochi.menu.addItem({ section: 'mochi', id: 'deep-scan', icon: '⌬', label: 'menu.deepScan', run: () => Mochi.deepScan.open?.() });

  Mochi.features = Mochi.features || [];
  Mochi.features.push({
    id: 'deep-scan',
    init(ctx) {
      const { companion, engine, panel } = ctx;
      const { h } = Mochi.ui;
      const t = Mochi.t;
      const sleep = ms => new Promise(r => setTimeout(r, ms));

      // ——— hiding Mochi while the page is measured or photographed ———
      const hideMochi = on => { companion.host.style.visibility = on ? 'hidden' : ''; };

      // ——— the scan itself ———
      async function run({ ownSite = false, only = null, onProgress = () => {} } = {}) {
        if (Mochi.deepScan.running) throw new Error('busy');
        const started = performance.now();
        const list = phases.filter(p => !only || only.includes(p.id) || p.always);
        const total = list.reduce((n, p) => n + (p.weight || 1), 0) || 1;
        let done = 0;
        const scan = {
          opts: { ownSite: !!ownSite },
          url: location.href, host: location.hostname || 'local', title: document.title,
          started: new Date().toISOString(),
          ignore: companion.host,
          spec: { version: SPEC_VERSION, source: {}, notes: [], approximations: [], limits: [] },
          shots: [], // { name, data: Uint8Array, region?, state? }
          cancelled: false,
          partial: [],
          hideMochi,
          cdp: Mochi.cdp,
          deadline: Infinity,
          check() { if (scan.cancelled) throw new Cancelled(); if (Date.now() > scan.deadline) throw new PhaseTimeout(); },
          step: null,
          progress(f) { onProgress({ step: scan.step, fraction: Math.min(1, (done + Math.max(0, Math.min(1, f)) * (scan.stepWeight || 1)) / total) }); },
          sleep,
          /** Yield to the page now and then so it never freezes. */
          async breathe() { await new Promise(r => setTimeout(r, 0)); scan.check(); },
        };
        Mochi.deepScan.running = scan;
        let attached = false;
        try {
          if (list.some(p => p.cdp)) { await Mochi.cdp.attach(); attached = true; }
          const phaseMs = {};
          const t0 = Date.now();
          for (const p of list) {
            scan.check();
            // Out of time overall: skip what's left (it's listed as partial), keep what we have.
            if (Date.now() - t0 > TOTAL_MS && !p.always) { scan.partial.push(p.id); continue; }
            scan.step = p.label;
            scan.stepWeight = p.weight || 1;
            scan.progress(0);
            const started = Date.now();
            scan.deadline = started + p.budget;
            const work = Promise.resolve().then(() => p.run(scan));
            let result;
            try { result = await Promise.race([work.then(() => 'ok'), sleep(p.budget + 250).then(() => 'timeout')]); } catch (err) {
              if (err?.phaseTimeout) result = 'timeout';
              else if (err?.cancelled) throw err;
              else { result = 'failed'; scan.partial.push(p.id); scan.spec.notes.push(`Phase "${p.id}" stopped with an error (${String(err?.message || err).slice(0, 120)}); the rest of the spec is fine.`); }
            }
            if (result === 'timeout') {
              scan.deadline = 0; // the phase stops at its next check()
              await Promise.race([work.catch(() => {}), sleep(3000)]);
              scan.partial.push(p.id);
              scan.spec.notes.push(`Phase "${p.id}" ran out of its ${Math.round(p.budget / 1000)} s budget; its part of the spec may be incomplete.`);
            }
            scan.deadline = Infinity;
            phaseMs[p.id] = Date.now() - started;
            done += p.weight || 1;
            scan.progress(0);
          }
          scan.phaseMs = phaseMs;
          scan.spec.source = { phaseMs: scan.phaseMs, url: location.origin + location.pathname, title: scan.opts.ownSite ? document.title : '(placeholder title)', scannedAt: scan.started, ms: Math.round(performance.now() - started), partial: scan.partial, ownSite: scan.opts.ownSite, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio } };
          return scan;
        } finally {
          Mochi.deepScan.cleanup?.forEach(fn => { try { fn(scan); } catch (_) { /* best effort */ } });
          hideMochi(false);
          if (attached) { try { scan.blocked = await Mochi.cdp.blocked(); } catch (_) { scan.blocked = []; } await Mochi.cdp.detach(scan.cancelled ? 'cancel' : 'done').catch(() => {}); }
          scan.spec.safety = { ...(scan.safety || {}), blockedNavigations: (scan.blocked || []).length, note: 'Mochi never submits forms, types, follows links or presses risky buttons during a scan.' };
          Mochi.deepScan.lastSafety = { ...scan.spec.safety, blocked: scan.blocked || [], detached: !Mochi.cdp.attached };
          Mochi.deepScan.running = null;
        }
      }
      Mochi.deepScan.run = run;

      // ——— the panel: explain → (permission) → progress → results ———
      function intro() {
        const own = h('input', { type: 'checkbox', id: 'deep-own' });
        const body = h('div', { class: 'deep' },
          h('p', { text: t('deep.what') }),
          h('ul', { class: 'deep-list' }, ...['deep.capture1', 'deep.capture2', 'deep.capture3'].map(k => h('li', { text: t(k) }))),
          h('p', { class: 'deep-why', text: t('deep.whyBar') }),
          h('p', { class: 'note', text: t('deep.local') }),
          h('label', { class: 'deep-own' }, own, h('span', { text: t('deep.ownSite') })),
          h('p', { class: 'note', text: t('deep.placeholders') }));
        const footer = h('div', { class: 'row' },
          h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'deep-start', onclick: () => start({ ownSite: own.checked }) }, t('deep.start')),
          h('button', { class: 'px-btn', type: 'button', 'data-act': 'deep-cancel', onclick: () => panel.close() }, t('deep.notNow')));
        panel.open(t('deep.title'), location.hostname || t('deep.thisPage'), body, footer);
        panel.view = 'deep-intro';
      }

      let current = null;
      async function start({ ownSite = false, only = null } = {}) {
        if (Mochi.deepScan.running) return null;
        if (companion.isTucked) companion.setTucked(false);
        Mochi.menuInstance?.close();
        const bar = h('i', { class: 'deep-bar-fill' });
        const step = h('p', { class: 'deep-step', 'aria-live': 'polite', text: t('deep.starting') });
        const pct = h('span', { class: 'deep-pct', text: '0 %' });
        panel.open(t('deep.title'), t('deep.working'), h('div', { class: 'deep' }, step, h('div', { class: 'deep-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, bar), pct, h('p', { class: 'note', text: t('deep.keepTab') })),
          h('div', { class: 'row' }, h('button', { class: 'px-btn', type: 'button', 'data-act': 'deep-stop', onclick: () => { if (current) current.cancelled = true; step.textContent = t('deep.stopping'); } }, t('deep.cancel'))));
        panel.view = 'deep-progress';
        engine.scanStart();
        const keepBusy = setInterval(() => { companion.play('sniff'); companion.flashFx('magnifier', 6000); }, 6000);
        const onProgress = ({ step: s, fraction }) => {
          if (s) step.textContent = t(s);
          const p = Math.round(fraction * 100);
          bar.style.width = `${p}%`;
          bar.parentElement.setAttribute('aria-valuenow', String(p));
          pct.textContent = `${p} %`;
        };
        let scan = null;
        try {
          const promise = run({ ownSite, only, onProgress });
          current = Mochi.deepScan.running;
          scan = await promise;
          clearInterval(keepBusy);
          engine.scanDone({});
          ctx.emit('deepScanned', scan);
          Mochi.deepScan.last = scan;
          await Mochi.deepScan.finish?.(scan, ctx); // builds the files and shows the results (src/deep-scan/output.js)
          return scan;
        } catch (err) {
          clearInterval(keepBusy);
          if (err?.cancelled) { companion.clearFx(); companion.say(t('deep.cancelled'), 2400); panel.close(); }
          else { engine.scanFailed(); showError(String(err?.message || err), { ownSite }); }
          return null;
        } finally { current = null; }
      }

      /** A failed scan, explained: what happened and what to do (instead of a raw error code). */
      function showError(code, { ownSite = false } = {}) {
        const known = { 'restart-needed': 'deep.err.restart', 'already-attached': 'deep.err.attached', 'page-not-allowed': 'deep.err.page', 'no-permission': 'deep.err.permission' }[code];
        const buttons = [];
        if (code === 'restart-needed') buttons.push(h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'deep-restart', onclick: () => { Mochi.cdp.restart().catch(() => {}); panel.open(t('deep.title'), t('deep.failed'), h('div', { class: 'deep' }, h('p', { text: t('deep.err.restarting') })), null); } }, t('deep.restartMochi')));
        else if (code !== 'page-not-allowed') buttons.push(h('button', { class: 'px-btn primary', type: 'button', 'data-act': 'deep-retry', onclick: () => (code === 'no-permission' ? Mochi.deepScan.open() : start({ ownSite })) }, t('deep.retry')));
        buttons.push(h('button', { class: 'px-btn', type: 'button', onclick: () => panel.close() }, t('deep.notNow')));
        panel.open(t('deep.title'), t('deep.failed'), h('div', { class: 'deep' }, h('p', { text: known ? t(known) : t('deep.failedText', { error: code.slice(0, 160) }) })), h('div', { class: 'row' }, ...buttons));
        panel.view = 'deep-error';
      }
      Mochi.deepScan.showError = showError;

      Mochi.deepScan.open = async () => {
        if (Mochi.deepScan.running) return;
        const s = await Mochi.cdp.status().catch(() => ({ permission: false }));
        if (!s.permission) { showError('no-permission'); return; }
        if (s.api === false) { showError('restart-needed'); return; } // allowed, but not usable yet
        intro();
      };
      Mochi.deepScan.start = start;

      // Test hook (local test pages only): run without the intro (permission already granted). → a summary.
      Mochi.debugHooks.deepScan = async ({ ownSite = false, only = null, cancelAfter = 0, holdMs = 0 } = {}) => {
        if (cancelAfter) setTimeout(() => { if (Mochi.deepScan.running) Mochi.deepScan.running.cancelled = true; }, cancelAfter);
        // holdMs: a test-only phase that keeps the scan (and the debugger) running for a while.
        const hold = holdMs ? { id: 'test-hold', order: 99, cdp: true, label: 'deep.step.prepare', budget: holdMs + 2000, run: async s => { const end = Date.now() + holdMs; while (Date.now() < end) { await s.sleep(100); s.check(); } } } : null;
        if (hold) Mochi.deepScan.addPhase(hold);
        const scan = await start({ ownSite, only: only && hold ? [...only, 'test-hold'] : only }).finally(() => { if (hold) phases.splice(phases.indexOf(phases.find(p => p.id === 'test-hold')), 1); });
        const safety = Mochi.deepScan.lastSafety || {};
        return scan ? { ok: true, partial: scan.partial, spec: scan.spec, shots: scan.shots.map(s => s.name), safety } : { ok: false, cancelled: true, safety };
      };
      Mochi.debugHooks.deepIntro = () => Mochi.deepScan.open();
      Mochi.debugHooks.deepError = code => { showError(code); return true; };
    },
  });
})();
