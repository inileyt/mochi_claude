/*
 * Mochi — what's new, per version. After an update Mochi says the newest
 * entry once (src/onboarding.js). Add a line here and a `whatsNew.<version>`
 * text (dots → underscores) to every file in src/locales/.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  Mochi.changelog = [
    { version: '1.26.0', key: 'whatsNew.1_26_0' },
    { version: '1.28.0', key: 'whatsNew.1_28_0' },
    { version: '1.29.0', key: 'whatsNew.1_29_0' },
    { version: '1.30.0', key: 'whatsNew.1_30_0' },
  ];
})();
