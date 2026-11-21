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

    // Wardrobe
    'outfit.santa-hat': 'Santa hat',
    'outfit.scarf': 'Scarf',
    'outfit.bow': 'Bow',
    'outfit.sunglasses': 'Sunglasses',
    'outfit.headphones': 'Headphones',
    'outfit.wizard-hat': 'Wizard hat',
    'wardrobe.level': 'Lv {level}',
    'wardrobe.locked': 'Unlocks at level {level}',
    'wardrobe.lockedSay': 'Not yet! Level {level}',
    'wardrobe.wearSay': ['Looking good!', 'Ooh, fancy!', 'Do I look cute?', 'Stylish!'],
    'wardrobe.takeOff': 'Take everything off',
    'wardrobe.seasonOn': '❄ Winter outfit is on (Dec 15 – Jan 7)',

    // Settings
    'settings.language': 'Language',
    'settings.language.auto': 'Auto (browser)',
    'settings.idleAntics': 'Idle antics',
    'settings.seasonal': 'Seasonal outfit & snow',
    'settings.resetPosition': 'Back to my spot',
    'settings.close': 'Close',
  };
})();
