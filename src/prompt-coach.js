/*
 * Mochi — the prompt coach (claude.ai only).
 *
 * When you stop typing in the claude.ai message box for ~1.5 s, Mochi reads
 * the draft (in memory, never stored or sent) and, if it looks weak, makes a
 * thinking face and offers one gentle tip. At most one tip per draft; it
 * never blocks sending and never changes your text. Settings → Prompt tips.
 *
 * Edit the rules below: the first rule that matches gives the tip. Each
 * rule sees a draft `d`: { text, lower, words, chars, hasCode, newChat }.
 * Patterns cover English and Russian drafts; tip texts live in the locale
 * files (coach.tip.*), so they follow Mochi's language.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  // Word edges that work for Cyrillic too (JavaScript's \b only knows Latin letters).
  const B = '(?<![\\p{L}\\p{N}_])', E = '(?![\\p{L}\\p{N}_])';
  const re = (source, flags = 'u') => new RegExp(source, flags);

  const P = {
    // "fix it", "help", "make it better", "исправь", "помоги", "сделай лучше" …
    vague: re(`^(?:pls |please |пожалуйста )?(?:fix(?: it| this)?|help(?: me)?|make it better|improve(?: it| this)?|do it|again|continue|redo(?: it)?|any ideas\\??|thoughts\\??|why\\??|исправь(?: это)?|помоги(?: мне)?|сделай(?: это)? лучше|улучши(?: это)?|продолжи|ещё раз|еще раз|почему\\??|переделай)[.!?…\\s]*$`),
    // talking about code or an error…
    code: re(`${B}(?:error|bug|exception|stack ?trace|traceback|crash(?:es|ing)?|doesn'?t (?:work|compile|run)|not working|my (?:code|function|script|component|query|regex)|this (?:code|function|script|component|query))${E}|ошибк|не работает|не компилир|мой код|эт(?:от|у) (?:код|функци)|падает`),
    error: re(`${B}(?:error|exception|stack ?trace|traceback|crash)|ошибк|падает`),
    // …with nothing that looks like code or an error message pasted
    codeish: re('```|`[^`]+`|[{};]|=>|\\(\\)|</?\\w+[^>]*>|^\\s{2,}\\S|\\b\\w+Error\\b|Traceback|at \\w+ \\(|line \\d+|строк[аеи] \\d+', 'mu'),
    // "it", "this", "that" with nothing to point at (in a new chat)
    reference: re(`^(?:fix |explain |improve |rewrite |check |translate |исправь |объясни |улучши |перепиши |проверь |переведи )?(?:it|this|that|these|those|это|этот|эту|его|её|ее)${E}`),
    // asking for something…
    ask: re(`^(?:please |pls |can you |could you |пожалуйста |можешь )?(?:write|create|make|build|draft|generate|design|plan|напиши|создай|сделай|придумай|составь|сгенерируй|спланируй)${E}`),
    // …with no word about what it's for or who reads it
    goal: re(`${B}(?:for|so that|so i|because|since|audience|readers?|users?|customers?|my (?:boss|team|class|client|kid|mom|dad)|to help|to explain|to convince|used in|about|для|чтобы|потому что|так как|о|об|про)${E}|аудитори|читател|пользовател|клиент`),
  };

  const RULES = [
    { id: 'vague', tip: 'coach.tip.vague', when: d => d.words <= 6 && P.vague.test(d.lower) },
    { id: 'reference', tip: 'coach.tip.reference', when: d => d.newChat && P.reference.test(d.lower) && !d.hasCode && d.words < 25 },
    // In an ongoing chat, "explain this" points at Claude's last answer: that's fine.
    { id: 'short', tip: 'coach.tip.short', when: d => d.words <= 2 && d.chars < 16 && !d.hasCode && !P.reference.test(d.lower) },
    { id: 'error', tip: 'coach.tip.error', when: d => P.error.test(d.lower) && !d.hasCode && d.words < 80 },
    { id: 'code', tip: 'coach.tip.code', when: d => P.code.test(d.lower) && !d.hasCode && d.words < 80 },
    { id: 'goal', tip: 'coach.tip.goal', when: d => d.words >= 3 && d.words <= 20 && P.ask.test(d.lower) && !P.goal.test(d.lower) },
  ];

  /** Looks at a draft; returns the first rule that matches, or null. */
  function check(text, { newChat = false } = {}) {
    const clean = String(text || '').trim();
    if (!clean || clean.startsWith('/')) return null;
    const words = clean.split(/\s+/).filter(Boolean).length;
    if (words > 150) return null; // a long, detailed prompt needs no tip
    const d = { text: clean, lower: clean.toLowerCase(), words, chars: clean.length, hasCode: P.codeish.test(clean), newChat };
    return RULES.find(rule => { try { return rule.when(d); } catch (_) { return false; } }) || null;
  }

  const draftText = () => {
    const el = Mochi.findEditor?.();
    if (!el) return '';
    return (el.value ?? el.innerText ?? el.textContent ?? '').trim();
  };

  Mochi.settings.define({ coach: true });
  Mochi.coach = { RULES, P, check };
  Mochi.menu.addSetting({ path: 'coach', type: 'toggle', label: 'settings.coach', when: ctx => ctx.isClaude });

  Mochi.features = Mochi.features || [];
  Mochi.features.push({
    id: 'prompt-coach',
    init(ctx) {
      if (!ctx.isClaude) return;
      let timer = null;
      let tipped = false; // one tip per draft
      let lastDraft = '';

      const evaluate = () => {
        if (Mochi.settings.get('coach') === false) return;
        const text = draftText();
        if (!text) { tipped = false; lastDraft = ''; return; }
        if (tipped || text === lastDraft) return;
        lastDraft = text;
        const rule = check(text, { newChat: (ctx.watcher.userCount || 0) === 0 });
        if (!rule) return;
        tipped = true;
        ctx.engine.react({ mood: 'thinking', say: Mochi.t(rule.tip), sayMs: 5000, hold: 5000 });
        ctx.emit('coachTip', rule.id);
      };

      ctx.on('typing', () => {
        clearTimeout(timer);
        timer = setTimeout(evaluate, 1500);
      });
      // A sent message starts a new draft.
      ctx.on('userMessage', () => { clearTimeout(timer); tipped = false; lastDraft = ''; });

      Mochi.debugHooks.coachCheck = () => evaluate();
    },
  });
})();
