/*
 * Mochi — Deep Scan, Task 7: media, and what can't be cloned exactly.
 * Images and videos are described by their box (size, ratio, fit, radius,
 * overlay, role) and become placeholders (unless "this is my own site").
 * Canvas/WebGL, Lottie, background videos, iframes/embeds and third-party
 * widgets are described and marked approximate. And the spec says honestly
 * what a scan can't see.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const D = Mochi.deepScan;
  const selOf = el => Mochi.deepStructure.sel({ tag: el.tagName.toLowerCase(), id: el.id || null, cls: [...el.classList].filter(c => !/^(is-|has-|active|open|show)/.test(c)).slice(0, 2) });
  const visible = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const WIDGETS = [[/intercom/i, 'Intercom chat'], [/crisp/i, 'Crisp chat'], [/drift/i, 'Drift chat'], [/zendesk|zopim/i, 'Zendesk chat'], [/hubspot/i, 'HubSpot widget'], [/tawk/i, 'tawk.to chat'],
    [/onetrust|cookiebot|cookieconsent|cookie-?banner|consent/i, 'cookie banner'], [/recaptcha|hcaptcha|turnstile/i, 'captcha'], [/youtube|youtu\.be/i, 'YouTube video'], [/vimeo/i, 'Vimeo video'],
    [/google\.com\/maps|maps\.google/i, 'Google Map'], [/calendly/i, 'Calendly'], [/typeform/i, 'Typeform'], [/twitter|x\.com\/|platform\.twitter/i, 'X/Twitter embed'], [/instagram/i, 'Instagram embed'], [/spotify/i, 'Spotify embed'], [/stripe/i, 'Stripe element']];

  function roleOfImage(el, r, logos) {
    if (logos?.has(el)) return 'logo';
    const inHeader = !!el.closest('header, [role="banner"], nav');
    const name = `${el.getAttribute('alt') || ''} ${el.className || ''} ${el.getAttribute('src') || ''}`.toLowerCase();
    if (/logo/.test(name) || (inHeader && r.width <= 220 && r.height <= 80)) return 'logo';
    if (r.width <= 40 && r.height <= 40) return 'icon';
    if (Math.abs(r.width - r.height) <= 2 && r.width <= 120 && getComputedStyle(el).borderTopLeftRadius !== '0px') return 'avatar';
    if (r.width >= innerWidth * 0.9) return 'full-width image';
    if (r.width >= 400) return 'large image (hero/feature)';
    return 'image';
  }
  /** Something laid over the picture (a gradient or a tinted layer) — read from the parent's absolute children. */
  function overlayOf(el) {
    const parent = el.parentElement;
    if (!parent) return null;
    const r = el.getBoundingClientRect();
    for (const sib of parent.children) {
      if (sib === el) continue;
      const cs = getComputedStyle(sib), s = sib.getBoundingClientRect();
      if (cs.position === 'absolute' && s.width >= r.width * 0.8 && s.height >= r.height * 0.8 && (cs.backgroundImage.includes('gradient') || Mochi.color.parseColor(cs.backgroundColor)?.a < 1)) return { kind: cs.backgroundImage.includes('gradient') ? 'gradient' : 'tint', value: cs.backgroundImage !== 'none' ? cs.backgroundImage : cs.backgroundColor };
    }
    return null;
  }
  const box = (el, r = el.getBoundingClientRect()) => { const cs = getComputedStyle(el); return { w: Math.round(r.width), h: Math.round(r.height), ratio: Mochi.deepGeometry.ratio(r.width, r.height), objectFit: cs.objectFit, objectPosition: cs.objectPosition, radius: cs.borderTopLeftRadius }; };

  /** Where on the canvas a region sits, in words. */
  function describeRegion(r) {
    if (r.w > 0.8 && r.h > 0.8) return 'across the whole canvas';
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const v = cy < 0.4 ? 'top' : cy > 0.6 ? 'bottom' : 'middle', h = cx < 0.4 ? 'left' : cx > 0.6 ? 'right' : 'centre';
    return v === 'middle' && h === 'centre' ? 'in the centre' : `in the ${v}-${h}`.replace('-centre', '').replace('middle-', '');
  }

  const PNG_N = 10, PNG_GAP = 120, GW = 64, GH = 48;
  const b64ToBytes = s => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };

  /** Watch a canvas: N frames over ~1.2 s, diffed → { animated, motion } (measured), or { animated:null } if it can't look. */
  async function analyzeCanvas(scan, el) {
    const r0 = el.getBoundingClientRect();
    if (!r0.width || !r0.height || typeof OffscreenCanvas === 'undefined') return { animated: null };
    try {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      await scan.sleep(120);
      const b = el.getBoundingClientRect();
      const clip = { x: b.left + scrollX, y: b.top + scrollY, width: Math.min(b.width, 600), height: Math.min(b.height, 400), scale: 0.5 };
      const cv = new OffscreenCanvas(GW, GH), g = cv.getContext('2d', { willReadFrequently: true });
      const frames = [];
      scan.hideMochi(true);
      for (let i = 0; i < PNG_N; i++) {
        const shot = (await scan.cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true })).data;
        const bmp = await createImageBitmap(new Blob([b64ToBytes(shot)], { type: 'image/png' }));
        g.clearRect(0, 0, GW, GH); g.drawImage(bmp, 0, 0, GW, GH);
        frames.push(g.getImageData(0, 0, GW, GH).data);
        bmp.close?.();
        if (i < PNG_N - 1) await scan.sleep(PNG_GAP);
        scan.check();
      }
      scan.hideMochi(false);
      const m = Mochi.deepCanvasMotion.analyze(frames, GW, GH, { gapMs: PNG_GAP });
      return { animated: m.movingFraction > 0.01, motion: m };
    } catch (_) { scan.hideMochi(false); return { animated: null }; }
  }

  async function run(scan) {
    const own = scan.opts.ownSite;
    const images = [], videos = [], canvases = [], embeds = [], widgets = [];
    const approx = scan.spec.approximations;
    // Pictures the structure map found as a repeated "Logo" component (a logos strip).
    const logos = new Set((scan.components || []).filter(c => c.name === 'Logo').flatMap(c => c.items.map(i => (i.el.tagName === 'IMG' ? i.el : i.el.querySelector('img, svg')))).filter(Boolean));
    for (const el of document.querySelectorAll('img, picture > img, svg, video, canvas, iframe, embed, object, lottie-player, dotlottie-player, [data-lottie], [data-animation-path]')) {
      if (scan.ignore.contains(el) || (el.tagName.toLowerCase() === 'svg' && el.parentElement?.closest('svg'))) continue;
      const tag = el.tagName.toLowerCase();
      const r = el.getBoundingClientRect();
      if (!visible(el) && tag !== 'iframe') continue;
      if (tag === 'img' || tag === 'svg') {
        if (tag === 'svg' && r.width <= 48) continue; // icons: described with their components
        const role = roleOfImage(el, r, logos);
        images.push({ selector: selOf(el), role, ...box(el, r), overlay: overlayOf(el), filter: getComputedStyle(el).filter !== 'none' ? getComputedStyle(el).filter : null,
          placeholder: `[${role === 'logo' ? 'logo' : 'image'} ${Math.round(r.width)}×${Math.round(r.height)}${box(el, r).ratio ? `, ${box(el, r).ratio}` : ''}${getComputedStyle(el).objectFit !== 'fill' ? `, ${getComputedStyle(el).objectFit}` : ''}${getComputedStyle(el).borderTopLeftRadius !== '0px' ? `, radius ${getComputedStyle(el).borderTopLeftRadius}` : ''}]`,
          ...(own ? { src: (el.getAttribute('src') || '').split(/[?#]/)[0].split('/').pop() || null, alt: el.getAttribute('alt') || '' } : {}) });
      } else if (tag === 'video') {
        const bg = el.autoplay && el.muted && el.loop && r.width >= innerWidth * 0.6;
        videos.push({ selector: selOf(el), ...box(el, r), autoplay: el.autoplay, muted: el.muted, loop: el.loop, controls: el.controls, background: bg, poster: !!el.poster });
        approx.push({ what: bg ? 'background video' : 'video', where: selOf(el), note: `${bg ? 'A looping, muted background video' : 'A video'} (${Math.round(r.width)}×${Math.round(r.height)}). Use your own video or a still placeholder of the same size.` });
      } else if (tag === 'canvas') {
        const { animated, motion } = await analyzeCanvas(scan, el);
        let kind = 'canvas';
        try { kind = el.getContext('webgl2') || el.getContext('webgl') ? 'WebGL canvas' : el.getContext('2d') ? '2D canvas' : 'canvas'; } catch (_) { kind = 'canvas'; } // a context already exists: getContext returns it, makes no new one
        const evidence = animated === null ? 'unknown' : 'measured';
        const where = motion?.regions?.length ? describeRegion(motion.regions[0]) : null;
        const loops = motion?.periodMs ? ` and loops about every ${(motion.periodMs / 1000).toFixed(1)}s` : '';
        canvases.push({ selector: selOf(el), w: Math.round(r.width), h: Math.round(r.height), animated, kind, evidence, ...(motion ? { motion: { movingFraction: motion.movingFraction, regions: motion.regions, periodMs: motion.periodMs } } : {}) });
        approx.push({ what: kind, where: selOf(el), evidence,
          note: animated === null
            ? `A ${kind} (${Math.round(r.width)}×${Math.round(r.height)}) — couldn't be watched. What it draws comes from JavaScript and can't be read; rebuild it as an approximation or a static image.`
            : animated
              ? `An animated ${kind} (${Math.round(r.width)}×${Math.round(r.height)}): measured motion ${where ? `${where}` : ''}${loops}, covering ~${Math.round(motion.movingFraction * 100)}% of it. What it draws comes from JavaScript and can't be read — recreate the effect (e.g. drifting particles / shapes in the same colours), matching where it moves.`
              : `A static ${kind} (${Math.round(r.width)}×${Math.round(r.height)}): no motion measured over ~1s. A still image of the same size is a faithful stand-in.` });
      } else if (tag === 'iframe' || tag === 'embed' || tag === 'object') {
        const src = el.getAttribute('src') || el.getAttribute('data') || '';
        let host = null; try { host = new URL(src, location.href).hostname; } catch (_) { /* none */ }
        const w = WIDGETS.find(([re]) => re.test(src) || re.test(el.className || ''));
        embeds.push({ selector: selOf(el), host, kind: w ? w[1] : 'embedded page', w: Math.round(r.width), h: Math.round(r.height), visible: visible(el) });
        approx.push({ what: w ? w[1] : 'embedded content', where: selOf(el), note: `Content from ${host || 'another page'} (${Math.round(r.width)}×${Math.round(r.height)}) can't be read. Use a placeholder box or the provider's own embed.` });
      } else {
        canvases.push({ selector: selOf(el), w: Math.round(r.width), h: Math.round(r.height), animated: true, kind: 'Lottie animation' });
        approx.push({ what: 'Lottie animation', where: selOf(el), note: `A Lottie (After Effects) animation, ${Math.round(r.width)}×${Math.round(r.height)}. Use your own Lottie file or a simple CSS animation.` });
      }
      if (images.length + videos.length + canvases.length + embeds.length > 300) break;
      scan.check();
    }
    // Background images (photos/illustrations set in CSS).
    for (const n of (scan.nodes || []).slice(0, 3000)) {
      const cs = getComputedStyle(n.el);
      if (!cs.backgroundImage.includes('url(') || n.hidden) continue;
      images.push({ selector: Mochi.deepStructure.sel(n), role: 'background image', w: n.rect.w, h: n.rect.h, ratio: Mochi.deepGeometry.ratio(n.rect.w, n.rect.h), backgroundSize: cs.backgroundSize, backgroundPosition: cs.backgroundPosition, radius: cs.borderTopLeftRadius, placeholder: `[background image ${n.rect.w}×${n.rect.h}, ${cs.backgroundSize}]` });
      if (images.length > 300) break;
    }
    // Third-party widgets found by their elements.
    for (const el of document.querySelectorAll('[id*="intercom"], [class*="intercom"], [id*="crisp"], [class*="crisp"], [id*="onetrust"], [id*="cookie"], [class*="cookie"], [class*="consent"], [id*="hubspot"], .grecaptcha-badge')) {
      if (scan.ignore.contains(el) || !visible(el)) continue;
      const w = WIDGETS.find(([re]) => re.test(`${el.id} ${el.className}`));
      if (w && !widgets.some(x => x.kind === w[1])) widgets.push({ kind: w[1], selector: selOf(el) });
    }
    for (const w of widgets) approx.push({ what: w.kind, where: w.selector, note: `A third-party ${w.kind}. Leave it out or use the provider's own snippet.` });
    if (scan.spec.motion?.js?.length) approx.push({ what: 'JavaScript motion', where: scan.spec.motion.js.map(j => j.target).join(', '), note: 'Fitted from samples: the curve and timing are close, not exact.' });

    scan.spec.media = { images, videos, canvases, embeds, widgets, note: own ? 'Original file names and alt texts are kept (your own site).' : 'Pictures are placeholders of the same size and shape; no image addresses or alt texts are kept.' };
    scan.spec.limits = [
      'Backend logic and data (accounts, search, checkout, forms) — only the look and the front-end behaviour are captured.',
      'Anything behind a login, personal or logged-in content, and A/B test variants other than the one you saw.',
      'Behaviour that needs real input: typing, dragging, submitting forms, keyboard shortcuts, hover effects that follow the pointer.',
      'The inside of canvases, videos, iframes and third-party widgets.',
      'Exact curves of JavaScript-driven motion (described from samples).',
      'Fonts and images themselves: check licences; the spec only names them.',
      ...(scan.partial.length ? [`Parts that ran out of time: ${scan.partial.join(', ')}.`] : []),
      ...((scan.spec.structure?.nodes?.skipped || 0) > 0 && (scan.spec.structure.nodes.analysed >= D.MAX_NODES) ? [`Very large page: only the first ${D.MAX_NODES} elements were analysed in detail.`] : []),
    ];
  }

  D.addPhase({ id: 'media', order: 70, cdp: true, label: 'deep.step.media', budget: 20000, weight: 1, run });
})();
