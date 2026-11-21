/*
 * Mochi — English texts. The key is what the code asks for; the value is
 * what people see. A value can be a list: Mochi picks one line at random.
 * {name} is filled in by the code. To add a language, copy this file
 * (see CONTRIBUTING.md).
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  Mochi.locales = Mochi.locales || {};
  Mochi.locales.en = {
    'language.name': 'English',

    // menu sections
    'section.mochi': 'Mochi',
    'section.wardrobe': 'Wardrobe',
    'section.friends': 'Friends',
    'section.tools': 'Tools',
    'section.settings': 'Settings',
    'section.empty': 'Nothing here yet. Mochi is working on it!',

    // Mochi section
    'menu.scan': 'Scan this UI',
    'menu.pick': 'Pick an element',
    'menu.pocket': 'Pocket',
    'menu.play': 'Play',

    // Settings
    'settings.language': 'Language',
    'settings.language.auto': 'Auto (browser)',
    'settings.idleAntics': 'Idle antics',
    'settings.resetPosition': 'Back to my spot',
    'settings.close': 'Close',
  };
})();
