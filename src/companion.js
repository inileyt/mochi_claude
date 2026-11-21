/*
 * Mochi — the view. Knows how to draw Mochi and play animations; knows
 * nothing about chats. The mood engine tells it what to do.
 *
 *   companion.setMood('happy')         switch face + looping animation
 *   companion.play('wave')             one-shot action
 *   companion.say('Hi!')               speech bubble
 *   companion.lookAt(x, y) / lookAtElement(el) / lookDefault()
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const { MOODS, LABELS } = Mochi.art;

  const ACTION_MS = { swipe: 1000, wave: 1500, stretch: 1600, hop: 1200, spin: 900, wiggle: 600, look: 2600, squish: 450, dizzy: 1800, sniff: 8000, pocket: 1700, yawn: 2000, juggle: 2000, read: 4000, celebrate: 1500 };
  const STORE_KEY = 'mochi.v1';

  const storage = {
    async get() {
      try {
        if (globalThis.chrome?.storage?.local) {
          const out = await chrome.storage.local.get(STORE_KEY);
          return out[STORE_KEY] || {};
        }
      } catch (_) { /* storage unavailable: defaults */ }
      return {};
    },
    async set(value) {
      try {
        if (globalThis.chrome?.storage?.local) await chrome.storage.local.set({ [STORE_KEY]: value });
      } catch (_) { /* ignore */ }
    },
  };

  class Companion {
    constructor() {
      this.mood = 'neutral';
      this.settings = { right: null, bottom: null, tucked: false };
      this.timers = new Map();
      this.listeners = { poke: [], menu: [], untuck: [], reposition: [], action: [], mood: [] };
      this.lookOverride = null; // {x,y} while following the pointer
      this.moodLook = [0, 0];
    }

    async mount() {
      this.host = document.createElement('mochi-companion');
      this.host.setAttribute('data-mood', 'neutral');
      // A closed shadow root: claude.ai's styles and scripts can't reach in, Mochi's can't leak out.
      this.shadow = this.host.attachShadow({ mode: 'closed' });
      this.shadow.innerHTML = `
        <style>${Mochi.styles}</style>
        <div class="root">
          <div class="bubble" aria-hidden="true"></div>
          <div class="character" role="button" tabindex="0" aria-haspopup="menu" aria-expanded="false" data-mood="neutral" aria-label="Mochi">
            ${Mochi.art.svg()}
          </div>
          <button class="tuck" type="button" aria-label="Tuck Mochi away" title="Tuck Mochi away">–</button>
          <div class="tag" aria-hidden="true">Mochi · <b>chilling</b></div>
        </div>`;
      this.root = this.shadow.querySelector('.root');
      this.el = this.shadow.querySelector('.character');
      this.bubble = this.shadow.querySelector('.bubble');
      this.tag = this.shadow.querySelector('.tag b');
      this.tuckButton = this.shadow.querySelector('.tuck');
      document.documentElement.appendChild(this.host);

      this.settings = { ...this.settings, ...(await storage.get()) };
      this.applyPosition();
      if (this.settings.tucked) this.root.classList.add('tucked');

      this.setMood('neutral');
      this.bindPointer();
      this.scheduleBlink();
      this.watchTheme();
      return this;
    }

    on(name, fn) { this.listeners[name]?.push(fn); }
    emit(name, ...args) { for (const fn of this.listeners[name] || []) fn(...args); }

    // ——— mood & face ———
    setMood(requested) {
      // A character can feel moods its own way (a lazy cat is "happy" where Mochi is "excited").
      const mood = this.moodMap?.[requested] || requested;
      const recipe = MOODS[mood] || MOODS.neutral;
      this.mood = MOODS[mood] ? mood : 'neutral';
      const el = this.el;
      // Restart looping animations cleanly when the mood changes.
      const changed = el.dataset.mood !== this.mood;
      if (changed) {
        el.dataset.mood = '';
        void el.offsetWidth;
      }
      el.dataset.mood = this.mood;
      el.dataset.eyes = recipe.eyes;
      el.dataset.mouth = recipe.mouth;
      el.dataset.brows = recipe.brows;
      el.dataset.fx = recipe.fx;
      this.moodLook = recipe.look;
      if (this.isMain !== false) {
        this.host.setAttribute('data-mood', this.mood);
        this.tag.textContent = LABELS[this.mood];
        el.setAttribute('aria-label', `${this.charName || 'Mochi'}, your companion — ${LABELS[this.mood]}. Click for the menu.`);
      }
      this.applyLook();
      if (changed) this.emit('mood', this.mood);
    }

    /** Briefly shows extra effects (e.g. 'love', 'note') on top of the mood. */
    flashFx(fx, ms = 1600) {
      const el = this.el;
      const base = (MOODS[this.mood] || MOODS.neutral).fx;
      el.dataset.fx = `${base} ${fx}`.trim();
      this.later('fx', ms, () => { el.dataset.fx = (MOODS[this.mood] || MOODS.neutral).fx; });
    }

    /** Temporarily overrides the face (e.g. happy eyes during a poke). */
    flashFace(parts, ms = 900) {
      const el = this.el;
      Object.assign(el.dataset, parts);
      this.later('face', ms, () => {
        const r = MOODS[this.mood] || MOODS.neutral;
        el.dataset.eyes = r.eyes; el.dataset.mouth = r.mouth; el.dataset.brows = r.brows;
      });
    }

    /** Drops any effect flashed on top of the mood. */
    clearFx() {
      clearTimeout(this.timers.get('fx'));
      this.el.dataset.fx = (MOODS[this.mood] || MOODS.neutral).fx;
    }

    play(action) {
      if (!ACTION_MS[action]) return;
      const el = this.el;
      for (const name of Object.keys(ACTION_MS)) el.classList.remove(`act-${name}`);
      void el.offsetWidth;
      el.classList.add(`act-${action}`);
      this.later('action', ACTION_MS[action], () => el.classList.remove(`act-${action}`));
      this.emit('action', action);
    }

    say(text, ms = 2600) {
      if (!text || this.settings.tucked) return;
      this.bubble.textContent = text;
      this.bubble.classList.add('show');
      this.later('bubble', ms, () => this.bubble.classList.remove('show'));
    }

    // ——— looking ———
    lookAt(dx, dy) { this.lookOverride = { x: dx, y: dy }; this.applyLook(); }
    lookDefault() { this.lookOverride = null; this.applyLook(); }

    /** Turns Mochi's face toward an element on the page (e.g. the latest message). */
    lookAtElement(target, ms = 0) {
      if (!target?.getBoundingClientRect) return;
      const t = target.getBoundingClientRect();
      const m = this.el.getBoundingClientRect();
      const dx = t.left + t.width / 2 - (m.left + m.width / 2);
      const dy = t.top + Math.min(t.height, 80) / 2 - (m.top + m.height / 2);
      const len = Math.hypot(dx, dy) || 1;
      this.lookAt((dx / len) * 8, (dy / len) * 6);
      if (ms) this.later('look', ms, () => this.lookDefault());
    }

    applyLook() {
      const [x, y] = this.lookOverride ? [this.lookOverride.x, this.lookOverride.y] : this.moodLook;
      // Pixel art: the face shifts by whole art pixels only (face ±1, eyes ±1 more).
      // A mood's gaze moves the face 1 pixel; following the pointer sideways adds 1 more for the eyes.
      const step = v => Math.max(-1, Math.min(1, Math.round(v / 5))) || 0;
      const s = this.el.style;
      s.setProperty('--lx', `${step(x)}px`);
      s.setProperty('--ly', `${step(y)}px`);
      s.setProperty('--px', `${Math.abs(x) >= 7.5 ? Math.sign(x) : 0}px`);
      s.setProperty('--py', '0px');
    }

    // ——— blinking ———
    scheduleBlink() {
      const { blinkMin, blinkMax } = Mochi.config.timing;
      const wait = blinkMin + Math.random() * (blinkMax - blinkMin);
      this.later('blink', wait, () => {
        if (this.mood !== 'sleeping') {
          this.blink();
          if (Math.random() < 0.22) setTimeout(() => this.blink(), 260); // double blink
        }
        this.scheduleBlink();
      });
    }
    blink() {
      this.el.classList.add('blink');
      setTimeout(() => this.el.classList.remove('blink'), 130);
    }

    // ——— pointer: click, drag, hover-look, tuck ———
    bindPointer() {
      const el = this.el;
      let start = null;
      let dragging = false;

      el.addEventListener('pointerdown', ev => {
        if (ev.button !== 0) return;
        const rect = this.root.getBoundingClientRect();
        start = { x: ev.clientX, y: ev.clientY, right: innerWidth - rect.right, bottom: innerHeight - rect.bottom };
        dragging = false;
        el.setPointerCapture(ev.pointerId);
      });
      el.addEventListener('pointermove', ev => {
        if (!start || this.settings.tucked) return;
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        if (!dragging && Math.hypot(dx, dy) > 6) {
          dragging = true;
          this.root.classList.add('dragging');
        }
        if (dragging) {
          const size = this.root.offsetWidth;
          this.settings.right = clamp(start.right - dx, 0, innerWidth - size);
          this.settings.bottom = clamp(start.bottom - dy, 0, innerHeight - size);
          this.applyPosition();
        }
      });
      const end = ev => {
        if (!start) return;
        const wasDrag = dragging;
        start = null;
        dragging = false;
        this.root.classList.remove('dragging');
        try { el.releasePointerCapture(ev.pointerId); } catch (_) { /* fine */ }
        if (wasDrag) {
          storage.set(this.settings);
          this.play('squish');
        } else if (ev.type === 'pointerup') {
          this.handlePress();
        }
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); this.handlePress(); }
      });
      // Double-click: go back to the automatic spot beside the message box.
      el.addEventListener('dblclick', ev => {
        ev.preventDefault();
        if (!this.hasCustomPosition() || this.settings.tucked) return;
        this.resetPosition();
      });

      this.tuckButton.addEventListener('click', ev => { ev.stopPropagation(); this.setTucked(true); });

      // Eyes follow the pointer when it comes close (cheap: one rAF per move at most).
      let raf = 0;
      addEventListener('pointermove', ev => {
        if (raf || this.mood === 'sleeping' || this.settings.tucked) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          const m = this.el.getBoundingClientRect();
          const cx = m.left + m.width / 2;
          const cy = m.top + m.height / 2;
          const dx = ev.clientX - cx;
          const dy = ev.clientY - cy;
          const dist = Math.hypot(dx, dy);
          this.el.dataset.near = dist < 140 ? '1' : '';
          if (dist < 220 && dist > 4) {
            this.following = true;
            this.lookAt((dx / dist) * 8, (dy / dist) * 6);
          } else if (this.following) {
            this.following = false;
            this.lookDefault();
          }
        });
      }, { passive: true });
    }

    handlePress() {
      if (this.settings.tucked) {
        this.setTucked(false);
        this.emit('untuck');
        return;
      }
      // A click opens Mochi's menu (Scan this UI, Play, Pocket); "Play" is the old poke.
      this.emit(this.listeners.menu.length ? 'menu' : 'poke');
    }

    setTucked(tucked) {
      this.settings.tucked = tucked;
      this.root.classList.toggle('tucked', tucked);
      this.bubble.classList.remove('show');
      storage.set(this.settings);
    }

    applyPosition() {
      const { right, bottom } = this.settings;
      if (right != null) this.root.style.setProperty('--right', `${right}px`);
      if (bottom != null) this.root.style.setProperty('--bottom', `${bottom}px`);
    }

    /** Back to the automatic spot beside the message box. */
    resetPosition() {
      if (this.settings.tucked) this.setTucked(false);
      this.settings.right = null;
      this.settings.bottom = null;
      this.root.style.removeProperty('--right');
      this.root.style.removeProperty('--bottom');
      storage.set(this.settings);
      this.emit('reposition');
    }

    hasCustomPosition() { return this.settings.right != null || this.settings.bottom != null; }

    /** Default spot, chosen by the layout watcher so Mochi never covers the message box. */
    setAutoPosition(right, bottom) {
      if (this.hasCustomPosition()) return;
      this.root.style.setProperty('--right', `${Math.round(right)}px`);
      this.root.style.setProperty('--bottom', `${Math.round(bottom)}px`);
    }

    /**
     * Become another character (src/characters/*.js): its body parts, colors,
     * phrases and mood map. The face, moods, effects and outfits are shared.
     */
    setCharacter(char) {
      if (!char) return;
      this.character = char;
      this.charName = Mochi.t(char.name);
      this.phrases = char.phrases;
      this.moodMap = char.moodMap || null;
      this.sleepAfter = char.sleepAfter || null;
      this.charIdle = char.idle || [];
      const svg = this.el.querySelector('.mochi-svg');
      const fresh = document.createElement('template');
      fresh.innerHTML = Mochi.art.svg(char.parts || Mochi.art.MOCHI_PARTS); // our own sprite markup
      svg.replaceWith(fresh.content.firstElementChild);
      this.el.dataset.char = char.id;
      this.applyColors();
      if (this.outfitItems) this.setOutfit(this.outfitItems);
      this.setMood(this.mood || 'neutral');
    }

    /** Body colors: the character's own, then any color theme chosen for it. */
    applyColors(theme) {
      if (theme !== undefined) this.colorTheme = theme;
      const colors = { ...Mochi.art.ROLE_DEFAULTS, ...(this.character?.colors || {}), ...(this.colorTheme || {}) };
      for (const [role, value] of Object.entries(colors)) {
        this.el.style.setProperty(`--m-${role.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`, value);
      }
    }

    /**
     * Accessories: [{ slot: 'head'|'face'|'neck', markup, hide: ['antenna'] }].
     * They're drawn inside Mochi's own sprite groups, so they follow every pose.
     */
    setOutfit(items) {
      this.outfitItems = items;
      const hide = new Set();
      for (const layer of this.el.querySelectorAll('.outfit-layer')) {
        const item = items.find(i => i.slot === layer.dataset.slot);
        layer.innerHTML = item ? item.markup : ''; // markup from Mochi's own outfit data
        for (const part of item?.hide || []) hide.add(part);
      }
      this.el.dataset.hide = [...hide].join(' ');
      this.el.dataset.outfit = items.map(i => i.slot).join(' ');
    }

    /** Falling pixel snow around Mochi (winter). */
    setSnow(on) {
      if (!on) { this.snow?.remove(); this.snow = null; return; }
      if (this.snow) return;
      this.snow = document.createElement('div');
      this.snow.className = 'snow';
      this.snow.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 9; i++) {
        const flake = document.createElement('i');
        flake.style.left = `${(i * 37 + 11) % 100}%`;
        flake.style.animationDelay = `${-((i * 0.83) % 4).toFixed(2)}s`;
        flake.style.animationDuration = `${3.2 + (i % 4) * 0.6}s`;
        this.snow.append(flake);
      }
      this.root.prepend(this.snow);
    }

    setPaused(paused) { this.root.classList.toggle('paused', paused); }

    /** Hidden by the toolbar button (this page only, until it is pressed again or the page reloads). */
    setHidden(hidden) {
      this.hidden = hidden;
      this.root.classList.toggle('hidden', hidden);
      this.host.setAttribute('data-hidden', String(hidden));
      if (hidden) this.bubble.classList.remove('show');
    }
    get isHidden() { return !!this.hidden; }

    get size() { return this.root.offsetWidth || 120; }
    get isTucked() { return this.settings.tucked; }

    // ——— theme: match claude.ai light/dark ———
    watchTheme() {
      const apply = () => {
        const bg = getComputedStyle(document.body || document.documentElement).backgroundColor;
        const rgb = (bg.match(/\d+(\.\d+)?/g) || []).map(Number);
        let dark = matchMedia('(prefers-color-scheme: dark)').matches;
        if (rgb.length >= 3 && (rgb[3] === undefined || rgb[3] > 0)) {
          dark = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] < 110;
        }
        this.host.setAttribute('data-theme', dark ? 'dark' : 'light');
      };
      apply();
      new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-mode', 'style'] });
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);
    }

    later(name, ms, fn) {
      clearTimeout(this.timers.get(name));
      this.timers.set(name, setTimeout(fn, ms));
    }
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  Mochi.Companion = Companion;
})();
