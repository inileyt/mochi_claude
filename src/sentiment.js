/*
 * Mochi — a tiny, fully local mood reader.
 *
 * No model, no network: a few weighted word lists (English, Russian,
 * Armenian) and punctuation hints. It only has to tell "this feels sad",
 * "this feels exciting" and "this feels surprising" apart well enough to
 * pick a fitting face. The text is read in memory and never stored or sent.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  // English: whole words (a trailing * means "starts with").
  const EN = {
    pos: {
      2: 'amazing awesome fantastic incredible congrat* celebrat* thrilled excited exciting wonderful brilliant woohoo yay hooray love* perfect delighted proud success* won win* nailed',
      1: 'great good nice cool fun glad happy enjoy* beautiful lovely excellent impressive neat sweet thanks thank cute best',
    },
    neg: {
      2: 'sorry passed died death grief griev* depress* lonely heartbroken devastat* suicid* cancer funeral miss* crying cry hopeless anxious anxiety',
      1: 'sad unfortunately afraid scared hurt pain painful difficult hard tired lost lose failing failed fail worried worry stress* upset broke broken alone bad terrible awful ill sick',
    },
    surprise: {
      2: 'wow whoa woah omg unbelievable shocking',
      1: 'surprising surprised unexpected unexpectedly really suddenly strange weird actually',
    },
  };

  // Russian and Armenian: stems, matched anywhere in the text.
  const STEMS = {
    pos: {
      2: ['ура!', 'потрясающ', 'восхитительн', 'поздравля', 'обожаю', 'великолепн', 'шикарн', 'շնորհավոր', 'հիանալի', 'հրաշալի', 'սիրում եմ', 'ապրե'],
      1: ['круто', 'отличн', 'хорош', 'класс', 'спасибо', 'рад', 'красив', 'լավ', 'շնորհակալ', 'ուրախ', 'գեղեցիկ', 'սիրուն'],
    },
    neg: {
      2: ['умер', 'смерт', 'горе', 'депресс', 'одинок', 'плачу', 'похорон', 'մահ', 'մեռ', 'կորցր', 'լաց', 'միայնակ', 'ցավում եմ'],
      1: ['грустн', 'жаль', 'сожалени', 'печал', 'боюсь', 'страшн', 'тяжел', 'устал', 'плохо', 'больно', 'тревог', 'տխուր', 'վախ', 'դժվար', 'հոգնած', 'վատ', 'ցավ'],
    },
    surprise: {
      2: ['вау', 'ого', 'офигеть', 'ничего себе', 'վայ', 'վաու'],
      1: ['неожиданн', 'внезапн', 'странно', 'անսպասելի', 'զարմանալի'],
    },
  };

  // Armenian typed in Latin letters ("txur em", "lacum em", "apres"): whole words, like English.
  const HY_LATIN = {
    pos: {
      2: 'shnorhavor* hianali hrashali sirum apres aprem aprees',
      1: 'lav lavn shnorhakal* urax* urakh* gexecik* sirun*',
    },
    neg: {
      2: 'txur* tkhur* lacum laceci lacel lac mahacel mahacav miaynak* korcrel korcreci cavum',
      1: 'txrum txrel vax* vakh* djvar dzhvar hognac* hognats* vat cav cavuma nexvac* nervayn*',
    },
    surprise: {
      2: 'vay vau vaaay',
      1: 'anspaseli ansbaseli zarmanali',
    },
  };

  const EMOJI = {
    pos: /[🎉🥳😍🤩😄😁😊❤💖✨🔥👏🙌]/gu,
    neg: /[😢😭😞😔💔😿🥺😟]/gu,
    surprise: /[😮😲🤯😱]/gu,
  };

  function compileEnglish(spec) {
    const out = [];
    for (const [weight, words] of Object.entries(spec)) {
      for (const word of words.split(/\s+/)) {
        const body = word.endsWith('*') ? `${word.slice(0, -1)}\\w*` : word;
        out.push({ re: new RegExp(`\\b${body}\\b`, 'gi'), weight: Number(weight) });
      }
    }
    return out;
  }

  const EN_RULES = {
    pos: [...compileEnglish(EN.pos), ...compileEnglish(HY_LATIN.pos)],
    neg: [...compileEnglish(EN.neg), ...compileEnglish(HY_LATIN.neg)],
    surprise: [...compileEnglish(EN.surprise), ...compileEnglish(HY_LATIN.surprise)],
  };

  function countStems(text, spec) {
    let score = 0;
    for (const [weight, stems] of Object.entries(spec)) {
      for (const stem of stems) {
        let at = text.indexOf(stem);
        while (at !== -1) {
          score += Number(weight);
          at = text.indexOf(stem, at + stem.length);
        }
      }
    }
    return score;
  }

  function scoreKind(text, kind) {
    let score = 0;
    for (const { re, weight } of EN_RULES[kind]) {
      const hits = text.match(re);
      if (hits) score += hits.length * weight;
    }
    score += countStems(text, STEMS[kind]);
    const emoji = text.match(EMOJI[kind]);
    if (emoji) score += emoji.length * 1.5;
    return score;
  }

  /** Scores one text. Long texts are sampled (start and end), and scores are per ~120 words. */
  function analyze(raw) {
    if (!raw) return { pos: 0, neg: 0, surprise: 0 };
    let text = String(raw).toLowerCase();
    if (text.length > 2400) text = `${text.slice(0, 1600)} ${text.slice(-800)}`;

    let pos = scoreKind(text, 'pos');
    const neg = scoreKind(text, 'neg');
    let surprise = scoreKind(text, 'surprise');

    // Negations soften positives ("not good", "не хорошо").
    const negations = (text.match(/\b(not|never|no longer|isn't|wasn't|don't)\s+\w+/g) || []).length;
    pos = Math.max(0, pos - negations * 0.75);

    const bangs = (text.match(/!/g) || []).length;
    if (bangs) pos += Math.min(bangs, 4) * 0.5;
    if (/[!?]{2,}|\?!|!\?/.test(text)) surprise += 1.5;

    const words = Math.max(1, text.split(/\s+/).length);
    const scale = words > 120 ? 120 / words : 1; // keep long answers from piling up points
    return { pos: pos * Math.max(scale, 0.35), neg: neg * Math.max(scale, 0.35), surprise: surprise * Math.max(scale, 0.35) };
  }

  /**
   * Picks Mochi's reaction once Claude has answered, from what the person
   * wrote (weighted more: it is their mood) and what Claude answered.
   * Returns one of: 'happy' | 'excited' | 'sad' | 'surprised'.
   */
  function reactionFor(userText, answerText) {
    const u = analyze(userText);
    const a = analyze(answerText);
    const pos = u.pos + a.pos * 0.6;
    const neg = u.neg * 1.2 + a.neg * 0.7;
    const surprise = u.surprise + a.surprise * 0.5;

    if (neg >= 2 && neg >= pos) return 'sad';
    if (surprise >= 2 && surprise >= pos * 0.8) return 'surprised';
    if (pos >= 4) return 'excited';
    return 'happy';
  }

  /** A quick read of the person's own message, for the first glance. */
  function moodOfMessage(text) {
    const s = analyze(text);
    if (s.neg >= 2 && s.neg >= s.pos) return 'sad';
    if (s.surprise >= 2) return 'surprised';
    if (s.pos >= 4) return 'excited';
    return 'curious';
  }

  Mochi.sentiment = { analyze, reactionFor, moodOfMessage };
})();
