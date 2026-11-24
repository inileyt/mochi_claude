/*
 * Mochi — Image Scan: the flow. Right-click an image → "Scan image with Mochi" (or the
 * magnifier on a big image, or Menu → Tools → Scan an image) → Mochi takes the image's
 * pixels (src/image-scan/target.js), the offscreen worker page reads the colors, the
 * text and the font (pages/image-scan.js), and the card shows it all
 * (src/image-scan/card.js). Progress and Cancel in the panel; the page never freezes.
 *
 *   Mochi.imageScan.fromMenu({ srcUrl, frame })   from the right-click menu (background)
 *   Mochi.imageScan.scanElement(el)               from the magnifier / a test
 *   Mochi.imageScan.pick()                        "click an image"
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const T = (k, v) => Mochi.t(k, v);
  const STEPS = ['capture', 'crop', 'palette', 'text', 'font'];

  const api = (Mochi.imageScan = Mochi.imageScan || {});
  Mochi.menu.addItem({ section: 'tools', id: 'image-scan', icon: '⌕', label: 'menu.imageScan', run: () => api.pick?.() });

  Mochi.features = Mochi.features || [];
  Mochi.features.push({
    id: 'image-scan',
    init(ctx) {
      const { companion, engine, panel } = ctx;
      const { h } = Mochi.ui;
      const send = Mochi.imageTarget.send;
      const canCapture = !!globalThis.chrome?.runtime?.id;
      let current = null; // { job, cancelled, onProgress }
      let lastContext = null;

      // What was right-clicked last (the menu only tells the image's address).
      document.addEventListener('contextmenu', ev => {
        const el = ev.composedPath?.()[0];
        lastContext = el instanceof Element ? { el, x: ev.clientX, y: ev.clientY, at: Date.now() } : null;
      }, true);

      if (canCapture) {
        chrome.runtime.onMessage.addListener(msg => {
          if (msg?.type === 'mochi-image-progress' && current && msg.job === current.job) current.onProgress?.(msg.step, msg.fraction);
          return false;
        });
      }

      // Mochi and everything of his (bubble, panel, magnifier) out of the picture while it's taken.
      const hide = on => { companion.host.style.visibility = on ? 'hidden' : ''; };

      function progressView() {
        const bar = h('i', { class: 'deep-bar-fill' });
        const step = h('p', { class: 'deep-step', 'aria-live': 'polite', text: T('img.step.capture') });
        const pct = h('span', { class: 'deep-pct', text: '0 %' });
        panel.open(T('img.title'), T('img.working'),
          h('div', { class: 'deep img-progress' }, step, h('div', { class: 'deep-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, bar), pct),
          h('div', { class: 'row' }, h('button', { class: 'px-btn', type: 'button', 'data-act': 'img-cancel', onclick: () => cancel() }, T('deep.cancel'))));
        panel.view = 'image-progress';
        return (id, fraction = 0) => {
          const i = Math.max(0, STEPS.indexOf(id));
          const p = id === 'done' ? 100 : Math.round(((i + Math.max(0, Math.min(1, fraction))) / STEPS.length) * 100);
          if (STEPS.includes(id)) step.textContent = T(`img.step.${id}`);
          bar.style.width = `${p}%`;
          bar.parentElement.setAttribute('aria-valuenow', String(p));
          pct.textContent = `${p} %`;
        };
      }

      function cancel() {
        if (!current) return;
        current.cancelled = true;
        send({ op: 'cancel', job: current.job }).catch(() => {});
        panel.close();
        companion.clearFx();
        companion.say(T('say.okay'), 1200);
      }

      const noAccess = err => /activeTab|permission|Cannot access|all_urls|not allowed|Missing host/i.test(String(err?.message || err));

      /** Scan one element. → the result (also shown on the card), or null. */
      async function scan(target, { source = 'menu' } = {}) {
        if (current) return null;
        if (!canCapture) { companion.say(T('img.unavailable'), 2600); return null; }
        if (!target) { companion.say(T('img.notImage'), 2400); return null; }
        Mochi.menuInstance?.close();
        if (companion.isTucked) companion.setTucked(false);
        if (companion.isHidden) companion.setHidden(false);
        const setProgress = progressView();
        const run = (current = { job: null, cancelled: false, onProgress: setProgress });
        engine.scanStart();
        const keepBusy = setInterval(() => { companion.play('sniff'); companion.flashFx('magnifier', 6000); }, 6000);
        const isCancelled = () => run.cancelled;
        try {
          run.job = (await send({ op: 'begin' })).job;
          let shot = null, direct = null;
          try {
            shot = await Mochi.imageTarget.capture(target, { job: run.job, hide, isCancelled, onTile: (n, of) => setProgress('capture', n / of) });
          } catch (err) {
            if (err?.cancelled) throw err;
            if (!noAccess(err)) throw err;
            // No screenshot allowed here (Mochi came on its own, no click on the toolbar or the menu):
            // read the pixels directly if the image allows it.
            direct = await Mochi.imageTarget.direct(target);
            if (!direct) throw Object.assign(new Error('no-access'), { code: 'no-access' });
          }
          if (run.cancelled) return null;
          const r = target.el.getBoundingClientRect();
          const size = shot ? shot.size : { w: Math.round(r.width), h: Math.round(r.height) };
          const result = await send({ op: 'analyze', job: run.job, size, direct, options: { partial: !!shot?.partial, langs: Mochi.imageLangs?.current?.() } });
          if (run.cancelled) return null;
          result.source = {
            host: location.hostname || 'local', url: location.href.split('#')[0], kind: target.kind, from: source,
            partial: !!shot?.partial, tiles: shot?.tiles || 0, direct: !!direct,
            css: size, full: shot?.full || size,
            natural: target.kind === 'img' ? { w: target.el.naturalWidth, h: target.el.naturalHeight } : null,
            alt: (target.el.getAttribute?.('alt') || '').slice(0, 200),
            at: new Date().toISOString(),
          };
          result.job = run.job;
          clearInterval(keepBusy);
          api.last = result;
          ctx.emit('imageScanned', result);
          companion.clearFx();
          Mochi.imageCard.show(result, ctx);
          // Happy at the end; and proud when there was text to read.
          engine.react({ mood: 'happy', action: 'hop', say: result.ocr?.found ? T('img.canRead') : T('img.done', { n: result.palette?.colors?.length || 0 }), sayMs: 3000, hold: 5000 });
          return result;
        } catch (err) {
          clearInterval(keepBusy);
          if (err?.cancelled || run.cancelled || /cancelled/.test(String(err?.message))) return null;
          engine.scanFailed();
          const code = err?.code || String(err?.message || err);
          panel.open(T('img.title'), T('deep.failed'), h('div', { class: 'deep' }, h('p', { text: code === 'no-access' ? T('img.err.noAccess') : code === 'not-visible' ? T('img.err.notVisible') : T('deep.failedText', { error: code.slice(0, 160) }) })),
            h('div', { class: 'row' }, h('button', { class: 'px-btn', type: 'button', onclick: () => panel.close() }, T('deep.notNow'))));
          panel.view = 'image-error';
          return null;
        } finally {
          clearInterval(keepBusy);
          hide(false);
          if (current === run) current = null;
        }
      }

      api.scan = scan;
      api.scanElement = (el, opts) => scan(Mochi.imageTarget.resolve(el), opts);
      api.fromMenu = ({ srcUrl = '', frame = null } = {}) => {
        const hint = lastContext && Date.now() - lastContext.at < 15000 ? lastContext : null;
        if (frame) return scanFrame(srcUrl, frame);
        const target = Mochi.imageTarget.fromSrc(srcUrl, hint);
        if (!target) { pick(); return null; }
        return scan(target, { source: 'menu' });
      };

      /** An image inside a frame: its rectangle in the top page (the frame's offset + where it sits in the frame). */
      async function scanFrame(srcUrl, frame) {
        const iframe = [...document.querySelectorAll('iframe')].find(f => f.src === frame.frameUrl) || null;
        if (!iframe) { companion.say(T('img.err.frame'), 3000); return null; }
        const fr = iframe.getBoundingClientRect();
        const box = { left: fr.left + iframe.clientLeft + frame.left, top: fr.top + iframe.clientTop + frame.top, width: frame.width, height: frame.height };
        // A stand-in element at that spot, so capture() can measure it like any other.
        const proxy = { getBoundingClientRect: () => ({ ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top }), scrollIntoView() {}, getAttribute: () => '' };
        return scan({ el: proxy, kind: 'img', rect: proxy.getBoundingClientRect() }, { source: 'menu' });
      }

      /** "Click an image": the picker, then the image at that spot. */
      let picker = null;
      async function pick() {
        if (current) return null;
        Mochi.menuInstance?.close();
        if (panel.isOpen) panel.close();
        picker = picker || new Mochi.Picker(companion);
        if (picker.hint?.firstChild) picker.hint.firstChild.textContent = T('menu.imageScan');
        companion.say(T('img.pickHint'), 2600);
        const el = await picker.pick();
        if (!el) { engine.pickCancel(); return null; }
        const target = Mochi.imageTarget.resolve(el);
        if (!target) { companion.say(T('img.notImage'), 2400); return null; }
        return scan(target, { source: 'pick' });
      }
      api.pick = pick;
      api.cancel = cancel;
      Object.defineProperty(api, 'busy', { get: () => !!current, configurable: true });
      api.ready = true;

      // Test hooks (local test pages only): scan the element a selector names → a summary without the big images.
      const summary = r => (r ? { ...r, image: r.image?.length || 0, thumb: r.thumb?.slice(0, 32), imageData: undefined } : null);
      Mochi.debugHooks.imageScan = async ({ selector, src, menu = false } = {}) => {
        if (menu) return summary(await api.fromMenu({ srcUrl: src || document.querySelector(selector)?.currentSrc || '' }));
        return summary(await api.scanElement(document.querySelector(selector), { source: 'test' }));
      };
      Mochi.debugHooks.imageScanImage = () => api.last?.image || null; // the PNG Mochi took (data URL)
      Mochi.debugHooks.imageScanLast = () => summary(api.last || null);
      Mochi.debugHooks.imagePrompts = () => (api.last ? { ...Mochi.imagePrompt.build(api.last), question: Mochi.imagePrompt.question(api.last) } : null);
      // How many pixels of the last capture are far from a color (ΔE 2000 > 10): Mochi must not be in the picture.
      Mochi.debugHooks.imagePixelsOff = async hex => {
        if (!api.last?.image) return null;
        const img = new Image();
        img.src = api.last.image;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const { data } = g.getImageData(0, 0, c.width, c.height);
        const C = Mochi.imageColor, want = C.rgbToLab(C.fromHex(hex));
        let off = 0;
        for (let i = 0; i < data.length; i += 4) if (C.deltaE(C.rgbToLab([data[i], data[i + 1], data[i + 2]]), want) > 10) off++;
        return { off, total: data.length / 4 };
      };
      Mochi.debugHooks.imageScanCancel = () => { cancel(); return true; };
    },
  });
})();
