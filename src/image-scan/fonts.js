/*
 * Mochi — Image Scan: the fonts Mochi compares text against ("looks similar to").
 * 20 popular free Google Fonts (OFL / Apache 2.0), bundled in src/vendor/fonts/
 * (dev/vendor.sh fetches them). Each covers a category so a guess is never far off.
 *   wght: [min, max] for variable fonts, or the static weights shipped.
 *   cyr: true when a Cyrillic file is bundled too.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const F = (family, file, category, wght, { variable = true, cyr = true } = {}) => ({ family, file, category, wght, variable, cyr });
  const FONTS = [
    F('Inter', 'inter', 'sans-serif', [100, 900]),
    F('Roboto', 'roboto', 'sans-serif', [100, 900]),
    F('Montserrat', 'montserrat', 'sans-serif', [100, 900]),
    F('Poppins', 'poppins', 'sans-serif', [400, 700], { variable: false, cyr: false }),
    F('Open Sans', 'open-sans', 'sans-serif', [300, 800]),
    F('Lato', 'lato', 'sans-serif', [400, 700], { variable: false, cyr: false }),
    F('Rubik', 'rubik', 'sans-serif', [300, 900]),
    F('Oswald', 'oswald', 'display', [200, 700]), // condensed sans
    F('Bebas Neue', 'bebas-neue', 'display', [400], { variable: false, cyr: false }),
    F('Anton', 'anton', 'display', [400], { variable: false, cyr: false }),
    F('Playfair Display', 'playfair-display', 'serif', [400, 900]),
    F('Merriweather', 'merriweather', 'serif', [300, 900]),
    F('Lora', 'lora', 'serif', [400, 700]),
    F('DM Serif Display', 'dm-serif-display', 'serif', [400], { variable: false, cyr: false }),
    F('Roboto Slab', 'roboto-slab', 'slab', [100, 900]),
    F('Space Mono', 'space-mono', 'monospace', [400, 700], { variable: false, cyr: false }),
    F('JetBrains Mono', 'jetbrains-mono', 'monospace', [100, 800]),
    F('Pacifico', 'pacifico', 'script', [400], { variable: false }),
    F('Caveat', 'caveat', 'script', [400, 700]),
    F('Lobster', 'lobster', 'script', [400], { variable: false }),
  ];

  /** The woff2 files of a font (paths inside the extension), with the CSS weight range each covers. */
  function files(font) {
    const subsets = font.cyr ? ['latin', 'cyrillic'] : ['latin'];
    const out = [];
    for (const subset of subsets) {
      if (font.variable) out.push({ path: `src/vendor/fonts/${font.file}-${subset}-wght-normal.woff2`, weight: `${font.wght[0]} ${font.wght[1]}`, subset });
      else for (const w of font.wght) out.push({ path: `src/vendor/fonts/${font.file}-${subset}-${w}-normal.woff2`, weight: String(w), subset });
    }
    return out;
  }

  Mochi.imageFonts = { FONTS, files };
  if (typeof module !== 'undefined') module.exports = Mochi.imageFonts;
})();
