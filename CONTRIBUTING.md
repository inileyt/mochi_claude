# Contributing to Mochi

Thank you for helping Mochi! Mochi is a small Chrome extension in plain
JavaScript: no build step, no dependencies, no network.

## Run it locally

1. `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick this folder.
2. Open claude.ai, or click the toolbar button on any page.
3. For quick checks without claude.ai, serve the repo and open the test page:

   ```bash
   python3 -m http.server 8765
   ```

   Then open <http://localhost:8765/test/test-page.html>. It looks like a
   claude.ai chat and has buttons for every feature (moods, outfits, levels,
   friends, sounds, prompt tips, focus mode…).
4. Run the tests:

   ```bash
   for t in test/*.test.js; do node "$t"; done
   ```

## House rules

- **No network.** No `fetch`, no remote images, fonts or sounds, no analytics.
  All art and sound is made in code.
- **No new permissions** beyond `storage`, `activeTab` and `scripting`.
- **Read-only on claude.ai.** Mochi never sends or edits your messages. It
  only puts text in the message box when you press a Paste/Insert button.
- **Everything new can be turned off** in Mochi's settings.
- **Light:** no work while idle. Honor `prefers-reduced-motion`. Look right in
  both light and dark themes.
- A new file in `src/` goes in three places, in the same order: `manifest.json`
  (content scripts), `src/background.js` (`FILES`) and the two test pages.
  `node test/files.test.js` checks this.

## Make an outfit

1. Click Mochi → **Wardrobe** → **Outfit editor**.
2. Draw on Mochi's 40×40 grid (the faint Mochi is your guide). The first six
   colors are Mochi's own body colors. Use them for outlines and shading,
   and the outfit will follow Mochi's color theme.
3. Fill in a name and **your name as the author**, pick the slot (head, face
   or neck), and tick "Hides the antenna" for hats.
4. Check it in the six mood previews and with **Try on**.
5. **Save to my wardrobe** to wear it yourself, right away.
6. To share it with everyone, press **Export JSON** and open a pull request
   that adds the object to the `OUTFITS` list in `src/outfits.js`. Add its
   name to `src/locales/en.js` as `'outfit.<id>'` if you like (otherwise the
   name is shown as written). Pick `unlock: { level: N }` so outfits stay
   spread out across levels.

The format (also in the README):

```js
{
  id: 'party-hat',                 // unique, lowercase-with-dashes
  name: 'Party hat',               // or a locale key: 'outfit.party-hat'
  author: 'Your name',
  slot: 'head',                    // 'head' | 'face' | 'neck'
  unlock: { level: 3 },
  hide: ['antenna'],               // optional
  at: [14, 9],                     // top-left on the 40×40 grid
  pixels: ['.....GG', '....RRRR', 'OOOOOOOOOOOO'],
  palette: { G: '#ffe08a', R: '#ff6f8e', O: '@outline' },  // hex, or '@role'
}
```

Please draw original pixel art only (no characters or logos from other
games, films or brands).

## Translate Mochi

Texts live in `src/locales/<language>.js`, one object of keys per language.
English (`en.js`) has every key and is the fallback.

1. Copy `src/locales/en.js` to `src/locales/<code>.js` (for example `de.js`)
   and change `Mochi.locales.en` to `Mochi.locales.de`.
2. Translate the values, not the keys. Keep `{placeholders}` as they are.
   Lists (`[...]`) are phrases Mochi picks from at random, so they can be
   longer or shorter than in English.
3. Set `'language.name'` to the language's own name (for example `'Deutsch'`):
   it appears in Settings → Language.
4. Add the file after `src/locales/en.js` in `manifest.json`,
   `src/background.js` and both test pages, then run
   `node test/files.test.js` and `node test/locales.test.js` (it lists any
   keys you missed; missing keys fall back to English).
5. Mochi follows the browser's language automatically, and anyone can pick a
   language in Settings → Language.

The prompt coach's patterns (`src/prompt-coach.js`) and the mood word lists
(`src/sentiment.js`) can learn your language too: add words to their lists.

## Code style

Plain modern JavaScript in small files, each wrapped in an IIFE that adds to
the global `Mochi` namespace. A feature registers itself with
`Mochi.features.push({ id, init(ctx) })`, adds menu entries with
`Mochi.menu.addItem/addView/addSetting`, keeps its data in `Mochi.store`, and
gets its texts from `Mochi.t('key')`. Add debug buttons to
`test/test-page.html` through `Mochi.debugHooks`.
