/*
 * Mochi — the long-chat warning (claude.ai only).
 *
 * Very long conversations get slow and use up your limits faster. Mochi
 * measures the chat on the screen after each answer (how many messages, how
 * many characters, read in memory and never stored) and grows tired as it gets
 * long: droopy eyes, then a yawn now and then. Once per conversation, at the
 * "warn" step, Mochi offers a ready prompt that asks Claude to summarize the
 * chat so you can carry on in a fresh one. Mochi only copies it: you paste
 * and send it yourself. Settings → Long-chat warning.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  /** Tiredness steps: the first threshold reached (messages or characters) wins. */
  const CONFIG = {
    steps: [
      { tired: 1, messages: 30, chars: 80000 },
      { tired: 2, messages: 50, chars: 160000, warn: true },
      { tired: 3, messages: 80, chars: 300000 },
    ],
    remember: 100, // conversations we remember having warned about
  };

  const first = list => {
    for (const sel of list) {
      try { const found = document.querySelectorAll(sel); if (found.length) return found; } catch (_) { /* next */ }
    }
    return [];
  };

  /** How long is the chat on screen? (Counts only; no text is kept.) */
  function measure() {
    const S = Mochi.config.selectors;
    const nodes = [...first(S.userMessage), ...first(S.assistantMessage)];
    let chars = 0;
    for (const n of nodes) chars += (n.textContent || '').length;
    return { messages: nodes.length, chars };
  }

  function tirednessFor(size) {
    let level = 0;
    for (const step of CONFIG.steps) if (size.messages >= step.messages || size.chars >= step.chars) level = step.tired;
    return level;
  }
  const warnLevel = CONFIG.steps.find(s => s.warn).tired;

  Mochi.settings.define({ longChat: true });
  Mochi.menu.addSetting({ path: 'longChat', type: 'toggle', label: 'settings.longChat', when: ctx => ctx.isClaude });
  Mochi.longChat = { CONFIG, measure, tirednessFor };

  Mochi.features = Mochi.features || [];
  Mochi.features.push({
    id: 'long-chat',
    init(ctx) {
      if (!ctx.isClaude) return;
      const { companion, engine, panel } = ctx;
      const { h } = Mochi.ui;
      let tired = 0;
      let override = null; // the test page can pretend a size
      let card = null, cardTimer = null, checkTimer = null;
      let path = location.pathname;

      const on = () => Mochi.settings.get('longChat') !== false;
      const setTired = level => {
        tired = on() ? level : 0;
        if (tired) companion.el.dataset.tired = String(tired);
        else delete companion.el.dataset.tired;
      };

      async function warned(key) {
        const map = (await Mochi.store.get('longChat.warned')) || {};
        return !!map[key];
      }
      async function markWarned(key) {
        await Mochi.store.update('longChat.warned', map => {
          const next = { ...map, [key]: Date.now() };
          const keys = Object.keys(next).sort((a, b) => next[b] - next[a]);
          return Object.fromEntries(keys.slice(0, CONFIG.remember).map(k => [k, next[k]]));
        }, {});
      }

      function hideCard() {
        clearTimeout(cardTimer);
        card?.remove();
        card = null;
      }

      function showCard(key) {
        hideCard();
        companion.bubble.classList.remove('show');
        companion.play('yawn');
        companion.flashFace({ eyes: 'closed', mouth: 'o' }, 1600);
        const done = text => { hideCard(); if (text) companion.say(text, 3200); };
        card = h('div', { class: 'offer long-chat', role: 'alertdialog', 'aria-label': Mochi.t('longChat.title') },
          h('p', { text: Mochi.t('longChat.say') }),
          h('div', { class: 'row' },
            h('button', {
              class: 'px-btn primary', type: 'button', 'data-act': 'copy-summary',
              onclick: async () => {
                const ok = await Mochi.ui.copyText(Mochi.t('longChat.prompt'), companion.shadow);
                done(ok ? Mochi.t('longChat.copied') : Mochi.t('longChat.copyFailed'));
                if (ok) companion.play('hop');
              },
            }, Mochi.t('longChat.copy')),
            h('button', { class: 'px-btn', type: 'button', 'data-act': 'not-now', onclick: () => done(Mochi.t('longChat.later')) }, Mochi.t('longChat.notNow'))));
        companion.root.append(card);
        cardTimer = setTimeout(hideCard, 30000);
        markWarned(key);
        ctx.emit('longChatWarned', key);
      }

      async function check() {
        if (!on()) { setTired(0); return; }
        const size = override || measure();
        const level = tirednessFor(size);
        const was = tired;
        setTired(level);
        if (level > was && level >= 1 && was === 0) companion.flashFace({ eyes: 'closed', mouth: 'small-o' }, 700);
        if (level < warnLevel || card) return;
        const key = location.pathname;
        if (!/\/chat\//.test(key) && !override && !document.documentElement.dataset.mochiTest) return; // only real conversations
        if (await warned(key)) return;
        if (document.hidden || companion.isHidden || companion.isTucked || panel.isOffering || ctx.watcher.isStreamingNow()) {
          clearTimeout(checkTimer);
          checkTimer = setTimeout(check, 8000);
          return;
        }
        showCard(key);
      }

      const soon = (ms = 2600) => { clearTimeout(checkTimer); checkTimer = setTimeout(check, ms); };
      // After each answer (a beat after Mochi's reaction), on load, and when you open another chat.
      ctx.on('responseEnd', () => soon(3200));
      ctx.on('hello', () => soon(2500));
      ctx.on('newChat', () => { hideCard(); setTired(0); });
      ctx.on('tick', () => { if (location.pathname !== path) { path = location.pathname; hideCard(); soon(1500); } });
      Mochi.settings.onChange(p => { if (p === 'longChat') { if (!on()) hideCard(); check(); } });

      // A tired Mochi yawns now and then (only while the chat is long).
      Mochi.idleExtras = Mochi.idleExtras || [];
      Mochi.idleExtras.push({
        when: c => c.isMain !== false && tired >= 2,
        run: c => { c.play('yawn'); c.flashFace({ eyes: 'closed', mouth: 'o' }, 1600); c.say(Mochi.tPick('longChat.tiredSay'), 1800); },
      });

      // Test page: pretend the chat has this size ({messages, chars}), or null to measure again.
      Mochi.debugHooks.chatSize = async value => {
        override = value || null;
        if (value?.forget) await Mochi.store.set('longChat.warned', {});
        await check();
        return { tired, size: override || measure() };
      };
      Mochi.longChat.state = () => ({ tired, size: override || measure(), showing: !!card });
    },
  });
})();
