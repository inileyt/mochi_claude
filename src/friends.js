/*
 * Mochi — friends. Pick who you are (Mochi, the bunny, the cat, the penguin, the fox, the robot,
 * the bear cub, the ghost or the cloud)
 * and, once unlocked, one friend to stand beside you.
 *
 * The friend is a second little character with its own mood engine: it
 * reacts to the same chat events in its own way (src/characters/*.js), waves
 * at Mochi, copies his hops and looks at him. Friends unlock by level
 * (progress.js): bunny 2, cat 3, penguin 4, fox 5, robot 6, bear 8, ghost 10, cloud 12.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  /** A friend: the same view as Mochi (moods, actions, bubble), drawn inside Mochi's shadow DOM. */
  class Buddy extends Mochi.Companion {
    constructor(parent) {
      super();
      this.parent = parent;
      this.isMain = false;
      this.settings = parent.settings; // tucked / hidden follow Mochi
    }

    mountBeside() {
      const { h } = Mochi.ui;
      this.host = this.parent.host;
      this.shadow = this.parent.shadow;
      this.root = this.parent.root;
      this.wrap = h('div', { class: 'buddy' });
      this.bubble = h('div', { class: 'bubble buddy-bubble', 'aria-hidden': 'true' });
      this.el = h('div', { class: 'character buddy-char', role: 'button', tabindex: '0', 'data-mood': 'neutral' });
      this.el.innerHTML = Mochi.art.svg(); // our own sprite markup
      this.wrap.append(this.bubble, this.el);
      this.parent.root.append(this.wrap);
      this.el.addEventListener('click', ev => { ev.stopPropagation(); this.emit('poke'); });
      this.el.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); this.emit('poke'); } });
      this.el.addEventListener('pointerenter', () => { this.el.dataset.near = '1'; });
      this.el.addEventListener('pointerleave', () => { this.el.dataset.near = ''; });
      this.scheduleBlink();
      return this;
    }

    remove() {
      for (const t of this.timers.values()) clearTimeout(t);
      this.timers.clear();
      this.wrap?.remove();
    }
  }

  Mochi.Buddy = Buddy; // online friends' visiting Mochis use it too

  const unlocked = char => (char.unlock?.level ?? 1) <= (Mochi.progress?.level() ?? 1);
  const t = (k, v) => Mochi.t(k, v);
  const pick = list => list[Math.floor(Math.random() * list.length)];

  Mochi.settings.define({ character: 'mochi', friend: null, friends: true });

  let buddy = null, friendEngine = null;

  /** Who's who now, from settings (anything locked falls back to Mochi / no friend). */
  function resolve() {
    const main = Mochi.characters.get(Mochi.settings.get('character'));
    const mainChar = unlocked(main) ? main : Mochi.characters.get('mochi');
    const fid = Mochi.settings.get('friends') === false ? null : Mochi.settings.get('friend');
    const friend = fid && fid !== mainChar.id ? Mochi.characters.all().find(c => c.id === fid) : null;
    return { main: mainChar, friend: friend && unlocked(friend) ? friend : null };
  }

  function apply(ctx) {
    const { main, friend } = resolve();
    if (ctx.companion.character?.id !== main.id) ctx.companion.setCharacter(main);
    ctx.emit('characterChanged', main);
    if (!friend) {
      buddy?.remove(); buddy = null; friendEngine = null;
      ctx.companion.root.classList.remove('has-friend', 'friend-above');
      return;
    }
    if (!buddy) {
      buddy = new Buddy(ctx.companion).mountBeside();
      friendEngine = new Mochi.MoodEngine(buddy);
      buddy.on('poke', () => {
        // Mochi notices when you play with his friend.
        ctx.companion.lookAtElement(buddy.el, 1200);
        ctx.companion.flashFace({ eyes: 'happy', mouth: 'smile' }, 900);
      });
    }
    if (buddy.character?.id !== friend.id) {
      buddy.setCharacter(friend);
      ctx.emit('friendChanged', friend);
      buddy.setMood('happy');
      buddy.play('wave');
      buddy.say(pick(friendEngine.phr('hello')), 2200);
    }
    ctx.companion.root.classList.add('has-friend');
    place(ctx);
  }

  /** The friend stands to Mochi's left; if that would cover the message box, on top of Mochi instead. */
  function place(ctx) {
    if (!buddy) return;
    const root = ctx.companion.root;
    root.classList.remove('friend-above');
    const b = buddy.wrap.getBoundingClientRect();
    const input = Mochi.findInput?.();
    const r = input?.getBoundingClientRect();
    const overlapsInput = r && r.width && !(b.right <= r.left || b.left >= r.right || b.bottom <= r.top || b.top >= r.bottom);
    if (overlapsInput || b.left < 0) root.classList.add('friend-above');
  }

  // ——— the Friends section of the menu ———
  /** A still picture of a character, as an <img> so nothing in it can touch the page or Mochi. */
  function thumb(char, size = 44) {
    const span = document.createElement('span');
    span.className = 'char-art';
    const img = document.createElement('img');
    img.alt = '';
    img.width = img.height = size;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(Mochi.art.staticSvg({ mood: 'happy', parts: char.parts, colors: { ...Mochi.art.ROLE_DEFAULTS, ...char.colors, ...(Mochi.colorFor?.(char.id) || {}) }, size, withShadow: false }))}`;
    span.append(img);
    return span;
  }

  Mochi.menu.addView('friends', ctx => {
    if (Mochi.settings.get('friends') === false) return null;
    const { h } = Mochi.ui;
    const { main, friend } = resolve();
    const tile = (char, { selected, onPick, role }) => {
      const open = !char || unlocked(char);
      const name = char ? t(char.name) : t('friends.none');
      return h('button', {
        class: `ward-tile char-tile${selected ? ' on' : ''}${open ? '' : ' locked'}`, type: 'button',
        'data-char': char ? char.id : 'none', 'data-role': role, 'aria-pressed': String(!!selected),
        title: open ? name : t('wardrobe.locked', { level: char.unlock.level }),
        onclick: () => {
          if (!open) { ctx.companion.say(t('wardrobe.lockedSay', { level: char.unlock.level }), 1800); return; }
          onPick();
        },
      }, char ? thumb(char) : h('span', { class: 'char-art none', 'aria-hidden': 'true', text: '∅' }), h('span', { class: 'ward-name', text: open ? name : t('wardrobe.level', { level: char.unlock.level }) }));
    };
    const all = Mochi.characters.all();
    return h('div', { class: 'friends' },
      h('h4', { class: 'app-sub', text: t('friends.me') }),
      h('div', { class: 'ward-grid four' }, ...all.map(c => tile(c, {
        role: 'main', selected: c.id === main.id,
        onPick: async () => {
          await Mochi.settings.set('character', c.id);
          if (Mochi.settings.get('friend') === c.id) await Mochi.settings.set('friend', null);
          ctx.companion.play('spin');
        },
      }))),
      h('h4', { class: 'app-sub', text: t('friends.beside') }),
      h('div', { class: 'ward-grid four' },
        tile(null, { role: 'friend', selected: !friend, onPick: () => Mochi.settings.set('friend', null) }),
        ...all.filter(c => c.id !== main.id).map(c => tile(c, { role: 'friend', selected: friend?.id === c.id, onPick: () => Mochi.settings.set('friend', c.id) }))),
      h('p', { class: 'note', text: t('friends.note') }));
  });
  Mochi.menu.addSetting({ path: 'friends', type: 'toggle', label: 'settings.friends' });

  Mochi.features = Mochi.features || [];
  Mochi.features.push({
    id: 'friends',
    init(ctx) {
      apply(ctx);
      Mochi.settings.onChange(path => { if (['character', 'friend', 'friends'].includes(path)) apply(ctx); });
      ctx.on('levelUp', () => apply(ctx));
      ctx.on('levelChanged', () => apply(ctx));
      addEventListener('resize', () => place(ctx), { passive: true });

      // The friend reacts to the chat too, in its own way.
      const fwd = (name, fn) => ctx.on(name, (...a) => { if (friendEngine) fn(...a); });
      fwd('userMessage', (text, el) => friendEngine.userMessage(text, el));
      fwd('responseStart', () => friendEngine.responseStart());
      fwd('responseProgress', el => friendEngine.responseProgress(el));
      fwd('typing', input => friendEngine.typing(input));
      fwd('newChat', () => friendEngine.newChat());
      fwd('scroll', () => friendEngine.scroll());
      fwd('visibility', hidden => friendEngine.visibility(hidden));
      ctx.on('responseEnd', (text, el) => {
        const main = ctx.companion.character;
        main?.onResponseEnd?.(text, el, ctx.companion, ctx.engine);
        if (!friendEngine) return;
        if (buddy.character?.onResponseEnd?.(text, el, buddy, friendEngine)) { friendEngine.phase = 'reacting'; return; }
        // A beat after Mochi, so they don't speak at once.
        setTimeout(() => friendEngine.responseEnd(text), 900);
      });

      // Friends interact: wave hello, copy Mochi's jumps, look at each other.
      ctx.on('hello', () => {
        if (!buddy) return;
        setTimeout(() => { buddy.play('wave'); buddy.setMood('happy'); ctx.companion.lookAtElement(buddy.el, 1400); }, 700);
      });
      ctx.companion.on('action', action => {
        if (buddy && ['hop', 'celebrate', 'wave', 'spin', 'stretch'].includes(action)) setTimeout(() => buddy?.play(action === 'spin' ? 'hop' : action), 380);
      });
      ctx.on('poke', () => { if (buddy) { buddy.lookAtElement(ctx.companion.el, 1400); buddy.flashFace({ eyes: 'wide', mouth: 'o' }, 700); } });
      ctx.on('levelUp', () => { if (buddy) setTimeout(() => { friendEngine.react({ mood: 'excited', action: 'celebrate', fx: 'sparkles', hold: 4000 }); }, 500); });
      ctx.on('tick', () => {
        ctx.companion.character?.tick?.(ctx.companion, ctx.engine, ctx);
        if (buddy) { buddy.character?.tick?.(buddy, friendEngine, ctx); place(ctx); }
      });

      Mochi.debugHooks.character = async value => { await Mochi.settings.set('character', value); };
      Mochi.debugHooks.friend = async value => { await Mochi.settings.set('friend', value || null); };
      Mochi.debugHooks.night = value => { Mochi.ghostClock = value ? () => new Date(2026, 0, 1, 23, 0) : null; ctx.emit('tick'); };
      Mochi.debug && (Mochi.debug.buddy = () => buddy);
      Mochi.friends = { get buddy() { return buddy; }, get engine() { return friendEngine; }, resolve, apply: () => apply(ctx) };
    },
  });
})();
