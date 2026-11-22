/*
 * Mochi — configuration.
 *
 * Everything that is likely to need tuning lives here:
 *  - selectors: how Mochi recognises parts of the claude.ai page. claude.ai
 *    changes its markup from time to time; if Mochi stops reacting, this list
 *    is the only thing that should need an update. Each entry is a list of
 *    fallbacks, tried in order.
 *  - timing: how long each reaction lasts, when Mochi gets idle or sleepy.
 *  - phrases: the tiny speech-bubble lines.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  Mochi.config = {
    selectors: {
      // Messages the person sent.
      userMessage: ['[data-testid="user-message"]', '[data-testid="user-human-turn"]'],
      // Claude's replies (the last one is the reply being written).
      assistantMessage: [
        '[data-is-streaming]',
        '.font-claude-response',
        '.font-claude-message',
        '[data-testid="assistant-message"]',
      ],
      // Any of these on screen means Claude is answering right now.
      streaming: [
        '[data-is-streaming="true"]',
        'button[aria-label="Stop response"]',
        'button[aria-label="Stop Response"]',
        'button[aria-label="Stop"]',
        'button[data-testid="stop-button"]',
      ],
      // The message box.
      input: [
        'div.ProseMirror[contenteditable="true"]',
        '[data-testid="chat-input"] [contenteditable="true"]',
        'div[contenteditable="true"]',
        'fieldset textarea',
        'textarea',
      ],
    },

    timing: {
      curiousBeforeThinking: 1100, // curious glance at your message, then thinking
      streamEndGrace: 1200, // the streaming signal must be gone this long to count as finished
      reactionHold: 7000, // how long the after-answer emotion stays before calming down
      idleAfter: 2 * 60 * 1000, // quiet this long → idle (still awake)
      sleepAfter: 5 * 60 * 1000, // quiet this long → falls asleep
      readingQuiet: 10000, // no idle antics this long after you scroll (you are reading)
      idleActionMin: 22000, // random little idle animations, between min and max ms apart
      idleActionMax: 48000,
      scanEvery: 1000, // safety re-check of the page, in ms
      blinkMin: 2400,
      blinkMax: 6200,
    },

    // Chance (0–1) that Mochi says something in a speech bubble on each event.
    chatter: {
      userMessage: 0.25,
      thinking: 0.2,
      reaction: 0.45,
      idle: 0.35,
    },
    // Mochi's phrases live in the locale files (src/locales/*.js → 'phrase.*').
  };
})();
