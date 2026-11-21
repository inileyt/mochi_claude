/*
 * Mochi — translations.
 *
 *   Mochi.t('menu.scan')                    → "Scan this UI"
 *   Mochi.t('streak.day', { n: 7 })         → "Day 7 together!"
 *   Mochi.tPick('phrases.hello')            → one random line from a list
 *
 * Texts live in src/locales/<lang>.js (Mochi.locales.en = { … }). A missing
 * key falls back to English, then to the key itself. The language follows
 * the browser unless the user picks one in Settings.
 * How to add a language: CONTRIBUTING.md.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  Mochi.locales = Mochi.locales || {};

  function lang() {
    const chosen = Mochi.settings?.get('lang') || 'auto';
    const want = chosen === 'auto' ? (navigator.language || 'en') : chosen;
    const base = want.toLowerCase().split('-')[0];
    return Mochi.locales[want] ? want : Mochi.locales[base] ? base : 'en';
  }

  function lookup(key) {
    const here = Mochi.locales[lang()] || {};
    return here[key] ?? Mochi.locales.en?.[key];
  }

  function fill(text, vars) {
    return String(text).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? vars[k] : m));
  }

  function t(key, vars) {
    const value = lookup(key);
    if (value === undefined) return key;
    return fill(Array.isArray(value) ? value[0] : value, vars);
  }

  function tPick(key, vars) {
    const value = lookup(key);
    if (value === undefined) return key;
    const list = Array.isArray(value) ? value : [value];
    return fill(list[Math.floor(Math.random() * list.length)], vars);
  }

  /** A whole list (for phrase lists): always an array, localized. */
  function tList(key, vars) {
    const value = lookup(key);
    if (value === undefined) return [key];
    return (Array.isArray(value) ? value : [value]).map(v => fill(v, vars));
  }

  /** The languages there are files for, as [code, name in that language]. */
  const languages = () => Object.entries(Mochi.locales).map(([code, l]) => [code, l['language.name'] || code]);

  Mochi.t = t;
  Mochi.tPick = tPick;
  Mochi.tList = tList;
  Mochi.lang = lang;
  Mochi.languages = languages;
})();
