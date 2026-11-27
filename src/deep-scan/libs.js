/*
 * Mochi — Deep Scan: which animation / 3D / scroll libraries the page actually runs, by version. The old
 * way was to guess from script file names; this reads the real globals in the page's MAIN world (through
 * the background worker — the content script can't see page globals, and the debugger must never run page
 * code), so the version is measured, not inferred. Knowing it's GSAP 3.12 or Three.js r158 lets an AI
 * rebuild with the same tool instead of a lookalike.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const D = Mochi.deepScan;
  const NAMES = {
    gsap: 'GSAP', scrolltrigger: 'GSAP ScrollTrigger', three: 'Three.js', lottie: 'Lottie', swiper: 'Swiper',
    anime: 'anime.js', pixi: 'PixiJS', matter: 'Matter.js', vue: 'Vue', react: 'React', lenis: 'Lenis (smooth scroll)',
    barba: 'Barba.js (page transitions)', p5: 'p5.js', aos: 'AOS (animate on scroll)', motion: 'Motion One / Framer Motion',
  };

  async function probe() {
    try {
      return await new Promise(resolve => {
        let done = false;
        const t = setTimeout(() => { if (!done) { done = true; resolve({}); } }, 4000);
        chrome.runtime.sendMessage({ type: 'mochi-libprobe' }, res => { if (done) return; done = true; clearTimeout(t); resolve(res && res.ok ? res.result || {} : {}); });
      });
    } catch (_) { return {}; }
  }

  async function run(scan) {
    const found = await probe();
    const detected = Object.entries(found).map(([k, v]) => ({ id: k, name: NAMES[k] || k, version: typeof v === 'string' ? v : null }));
    scan.spec.libraries = {
      detected, evidence: detected.length ? 'measured' : 'unknown',
      note: detected.length
        ? `Read from the live page: ${detected.map(l => l.name + (l.version ? ` ${l.version}` : '')).join(', ')}. Rebuild with the same libraries (and versions) — they drive the motion and behaviour.`
        : 'No known animation/3D library was detected in the page globals (it may be bundled/minified under a different name — check the scripts list).',
    };
  }

  Mochi.deepLibs = { probe };
  D.addPhase({ id: 'libs', order: 76, cdp: false, label: 'deep.step.libs', budget: 5000, weight: 0.3, run });
})();
