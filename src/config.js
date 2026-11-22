/*
 * Mochi — configuration.
 *
 * Everything that is likely to need tuning lives here:
 *  - (how Mochi recognises a chat page now lives in src/sites/: claude.js,
 *    chatgpt.js, gemini.js. If Mochi stops reacting on a site, that site's
 *    file is the only thing that should need an update.)
 *  - timing: how long each reaction lasts, when Mochi gets idle or sleepy.
 *  - phrases: the tiny speech-bubble lines.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  Mochi.config = {
    selectors: {}, // filled in by src/sites/claude.js

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
