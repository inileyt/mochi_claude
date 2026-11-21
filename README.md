# Mochi – a tiny companion for claude.ai

Mochi is a tiny square, orange pixel-art companion (a retro 8-bit style game character) that sits beside your claude.ai chat and reacts to the conversation. Click it to **scan the UI of any page** into a ready-to-paste AI prompt, a DESIGN.md, CSS variables, a Tailwind theme or JSON tokens. It is a personal Chrome extension that does all its work inside your browser and never sends anything anywhere.

![Mochi](icons/icon-128.png)

## Install in Chrome (about 1 minute)

1. **Get the folder onto your computer.** Download and unzip the extension. You now have a folder containing `manifest.json`.
   Keep the folder somewhere permanent, such as your Documents folder: Chrome loads Mochi from it every time it starts.
2. Open Chrome and go to **`chrome://extensions`** (type it in the address bar).
3. Turn on **Developer mode** (the switch in the top-right corner).
4. Click **Load unpacked** (top-left) and select the folder that contains `manifest.json`.
5. Mochi appears in the list as **"Mochi – a tiny companion for Claude"**. Optional: click the puzzle-piece icon in the toolbar and pin it.
6. Open or reload **https://claude.ai**. Mochi pops in at the bottom right and waves hello.

Works the same in Edge (`edge://extensions`, then "Developer mode" and "Load unpacked"), Brave and other Chromium browsers.

**Update after changing the files:** on `chrome://extensions`, click the circular arrow on Mochi's card, then reload claude.ai.
**Turn it off:** use the switch on Mochi's card. **Remove it:** click "Remove".

## The menu

Click Mochi to open its little pixel app. It has five sections, switched with the tabs (or ← → keys):

- **☻ Mochi:** Scan this UI, Pick an element, Pocket, Play (the old click-to-play reactions)
- **♛ Wardrobe**, **♥ Friends**, **✦ Tools:** fill up as features arrive
- **⚙ Settings:** language, idle antics, "Back to my spot", and an on/off switch for every feature

Double-click Mochi to send it back to its spot; Esc or a click elsewhere closes the menu.

## Wardrobe (v1.6)

Mochi can dress up. Open the menu → **♛ Wardrobe** and click an item to put it on or take it off (one per slot: head, face, neck): Santa hat, scarf, bow, sunglasses, headphones, wizard hat. Locked items show as silhouettes with the level that unlocks them. Accessories are drawn inside Mochi's own sprite, so they follow every hop, spin, nap and face.

**Winter:** from Dec 15 to Jan 7 (your local date) Mochi wears the Santa hat and scarf by itself, with pixel snow falling around it. Your own picks win, and **Settings → Seasonal outfit & snow** turns it off.

All accessories live in `src/outfits.js` in one simple format (see the top of that file).

## Levels, XP and streak (v1.7)

Mochi grows with you, counted only in your browser:

- **XP** for a claude.ai conversation turn (10), a scan (8), a pick (5), petting/playing (2), the first visit of a day (15) and each streak day (+5 per day in a row, up to 50). Turns, scans, picks, pets and mini-game stars share a cap of 120 XP per hour, so it can't be spammed. The numbers live in one table at the top of `src/progress.js`.
- **Level-ups** get a celebration (a jump, waving arms, sparkles, "Level 5!") and unlock things: outfits, friends, and new idle antics (yawning at 4, juggling a star at 5, reading a tiny book at 7).
- **Daily streak:** the first visit of the day says "Day 7 together!". Skip a day and Mochi is a little sad for a moment, then starts again happily.
- The **stat card** (menu → ☻ Mochi) shows the level, an XP bar, the streak and the next unlock. **Share card** downloads a PNG (Mochi in the current outfit, level, streak and `github.com/inileyt/mochi_claude`) for social media.

**Settings → Levels, XP & streak** turns all of it off.

## Friends (v1.8)

Menu → **♥ Friends**. Choose **who you are** (Mochi, the cat, the robot or the ghost) and a **friend beside you**. Friends unlock with levels: cat at 3, robot at 6, ghost at 10.

- **Cat:** lazy (never more than "happy"), naps while Claude writes, falls asleep after a minute of quiet, and now and then knocks a cup over.
- **Robot:** beeps, and gets very excited when Claude's answer has code in it ("BEEP BOOP! CODE!").
- **Ghost:** shy (fades when your pointer comes close), drifts in and out, and gets spooky with a purple glow at night (9 pm – 6 am).

Each character only defines its body, colors, phrases, how it shows moods and its own antics, in `src/characters/<name>.js`; the mood engine, faces, animations and outfits are shared. With a friend beside Mochi, the two wave hello, the friend copies Mochi's jumps, they look at each other, and both react to the chat in their own way. If there's no room beside Mochi (on claude.ai the friend never covers the message box), the friend sits on top.

## Scan this UI (v1.2)

**Scan this UI** makes Mochi sniff around the page with a magnifying glass, then hop and open a results panel:

- **Colors:** the palette weighted by how much of the screen each color covers, merged into up to 8 colors with roles (`background`, `surface`, `text`, `muted`, `primary`, `accent`, `border`), plus whether the page is dark or light. Click a swatch to copy its hex.
- **Typography:** heading and body fonts, the size scale, weights, line-height and heading letter-spacing.
- **Shape:** the common corner radii, shadows and border widths, with previews.
- **Spacing:** the spacing scale and whether it sits on a 4px or 8px grid.
- **Layout:** max content width, grid vs flex, columns, sticky header.
- **Components:** primary/secondary buttons, card, navbar, input, badge, with live previews and their key styles.
- **Effects:** gradients, glass (backdrop blur), transitions/animations, background images, noise.
- **Vibe:** the best one or two of soft modern, minimal, glassmorphism, neo-brutalist, tech lab / cyber, retro / pixel, corporate, playful, editorial, luxury, with the reason. The rules live in one editable table in `src/vibes.js`.

**Export tabs:** *AI prompt* ("Build a UI in this exact style: …", for Claude, Claude Code, Cursor, v0 or Lovable), *DESIGN.md*, *CSS* variables, *Tailwind* `theme.extend`, *JSON* tokens. **Copy** puts the current tab on your clipboard; **DESIGN.md** downloads the file.

**Accurate colors and fonts:** background colors come from what is actually painted on screen (Mochi samples 96 points and takes the first visible background under each, skipping images), so nested boxes don't count twice and a transparent page body isn't mistaken for white. Fonts are reported as the family the page really renders, next to the stack it asks for (for example `NotionInter` → `NotionInter, Inter`), and code blocks don't count toward the body font. Exports keep the page's fallback fonts. A blurred sticky header alone doesn't make a page "glassmorphism".

**Fast and gentle:** Mochi reads only visible elements (and a little below the fold), at most 1500, and works in small slices that never freeze the page. A typical scan takes 5–30 ms of work.

To scan a site other than claude.ai, first bring Mochi there with the toolbar button (below), then click Mochi → Scan this UI.

## Pick an element (v1.4)

Want the style of **one specific thing**, such as a button, a card or a nav bar? Click Mochi → **Pick an element**:

- A clear glass covers the page, and whatever is under your pointer gets an orange dashed outline with its name and size (`button · div.actions > a.btn · 125×48`). The page never sees your pointer, so Mochi reads the element's **resting** style, not its hover look, and clicks never open links or press buttons.
- **Click** to take it. **↑** picks the parent (the whole card instead of its title), **↓** goes back, **Enter** takes the highlighted one, **Esc** or a right-click cancels.
- The panel shows a **live preview**, its **style** (background, text color, font, size and weight, line-height, padding, radius, border, shadow, backdrop blur, transition, size; click any value to copy it), its **hover** state and the **colors inside**.
- **Export tabs:** *CSS* (the element's rule and its `:hover`), *HTML + CSS* (clean markup with the CSS of the whole piece, up to 120 elements), *Tailwind* (exact arbitrary-value classes, hover included), *AI prompt* ("Recreate this button exactly…"), *JSON*. **.html** downloads a self-contained file.
- Picks go into the pocket like scans, so on claude.ai Mochi offers them too ("I brought a button from stripe.com!").

Hover is read from the page's own stylesheets. Some sites load their CSS from another domain, which the browser doesn't let extensions read; then the panel says no hover rule was found.

## Mochi's Pocket (v1.3)

Every scan goes into Mochi's pocket: Mochi drops it into a little pixel pouch and says **"Saved!"**. The pocket keeps your last 20 scans (site, title, date, tokens, vibe and the ready-made AI prompt) in `chrome.storage.local`, only in your browser.

- **On claude.ai,** when the pocket holds a scan Mochi hasn't shown you yet, Mochi gets excited: *"I brought a style from dribbble.com! Paste it?"* with **Paste**, **Not now** and **Open pocket**. Each scan is offered once.
- **Paste** puts the AI prompt into Claude's message box the way a normal paste does, so the editor updates properly. **Mochi never sends anything:** you read it, edit it, and press Enter yourself. (Claude may turn a very long paste into an attachment card; that's Claude's normal behavior.)
- **Open pocket** (or click Mochi → **Pocket**) lists your saved scans. Each one can be pasted (on claude.ai), copied as a prompt (elsewhere), opened in every export format (**Formats**), or deleted.
- A scan you make on claude.ai itself isn't offered back to you; its results panel has a **Paste to Claude** button instead.

## Mochi on other websites (toolbar button)

On claude.ai Mochi appears by itself. On **any other website**, click Mochi's icon in Chrome's toolbar (pin it first: puzzle-piece icon → pin next to Mochi):

- **First click** on a page: Mochi pops in and waves.
- **Next click:** Mochi hides. **Click again:** it comes back.
- On claude.ai the same button hides Mochi or brings it back.
- Mochi stays on that page until you reload it or go to another page. Click again there to bring it along.
- Chrome doesn't let extensions onto its own pages (`chrome://…`, the Chrome Web Store, the new-tab page). There the icon shows a small **×** for a moment.

On other websites Mochi doesn't follow a chat. It glances at the box when you type, stays calm while you scroll and read, and falls asleep after 5 quiet minutes. The menu, scanning, dragging and tucking away all work as on claude.ai. **It reads no text on those pages:** the mood reading runs only on claude.ai, and a scan reads styles (colors, sizes, fonts), never what the page says.

## How Mochi looks

A 16 × 15 pixel square body with stepped corners, small square arms and legs, a little amber spark on top, and a flat orange and amber palette with no gradients. It's drawn with crisp edges, and every animation moves by whole pixels in held frames, like an 8-bit or 16-bit game sprite. At 120 px (80 px on small windows), each art pixel is exactly 3 (or 2) screen pixels.

## What Mochi does

| In the chat | Mochi |
| --- | --- |
| You send a message | **Curious**: leans toward your message and looks at it, with a pixel "?" |
| Claude starts answering | **Thinking**: looks up, taps its head with one arm, shows a pixel thought bubble |
| Claude is writing | **Focused**: watches the reply, nods gently, blinks |
| Claude finishes | **Happy** (bounces, sparkly eyes), **Excited** (jumps, waves both arms, sparkles), **Surprised** (wide eyes, a little jump) or **Sad / empathetic** (worried brows, a pixel tear and a small heart), depending on the mood of the conversation |
| You're quiet for 2 minutes | **Neutral** idle: blinks, breathes, and now and then looks around, stretches, hums ♪, waves or gets excited about nothing |
| You're quiet for 5 minutes | **Sleeping**: eyes closed, slow breathing, floating pixel Zzz |
| You start typing | Glances at the message box; if asleep, wakes up with a stretch and a yawn |
| You start a new chat | Waves hello |

**Playing with Mochi**
- **Click** (or Tab to it and press Enter): a random reaction, such as a hop, a spin, a wave, hearts or a surprised jump. Click very fast and Mochi gets dizzy.
- **Drag** to move it anywhere; it remembers the spot. **Double-click** sends it back to its automatic spot beside the message box.
- **Hover** to see its name tag and mood, and a small **–** button that **tucks Mochi away** to the edge of the window. Click the peeking Mochi to bring it back.
- When your pointer comes close, Mochi's eyes follow it.

**Fitting in**
- Mochi sits in the empty space to the right of the message box. On narrow windows it shrinks and perches just above the box, so it never covers messages, the input or its buttons.
- It matches claude.ai's light or dark theme.
- It stays calm while you're reading (no idle antics for 10 seconds after you scroll), and pauses its animations when the tab is in the background.
- If your system has **Reduce motion** turned on, Mochi keeps its expressions but stops bouncing, jumping and floating.

## Privacy

- **Scans happen only when you ask, and nothing leaves your browser.** A scan or a pick reads computed styles of visible elements (and, for hover, the page's own stylesheets) in the page you're on, keeps the result in memory and in your pocket in `chrome.storage.local`, and copies or downloads only when you press a button.

- **Permissions:** `storage` (Mochi's position, whether it's tucked away, and the pocket), plus `activeTab` and `scripting` for the toolbar button. With `activeTab`, Chrome lets the extension touch a page only after you click its icon on that page, and only that tab. It runs by itself only on claude.ai, and has no access to cookies, history, other tabs or sites you didn't click it on.
- **No network:** the code makes no network requests at all (no `fetch`, XHR, WebSocket or beacons).
- **Your messages:** Mochi reads the newest message on the screen once, in memory, to choose a face with a small built-in word list (English, Russian, Armenian). It never stores, logs or sends message text.
- **Read-only:** it never clicks, types or changes anything in the chat. It lives in a closed Shadow DOM, so its styles can't affect claude.ai and claude.ai's can't affect it.

## If Mochi stops reacting

claude.ai changes its page from time to time. Mochi recognises the chat by a few markers (your messages, the "Stop response" button, the reply being written), all listed in **`src/config.js` → `selectors`**. If Mochi still appears but no longer reacts to messages, that list is the only thing that needs updating. The chat itself is never affected either way.

## Files

| File | What it does |
| --- | --- |
| `manifest.json` | Chrome extension manifest (Manifest V3): runs by itself on claude.ai, elsewhere only when you click its icon |
| `src/config.js` | Page selectors, timings, chattiness and speech-bubble phrases: the settings worth tweaking |
| `src/sentiment.js` | Local mood reading of the conversation (word lists, punctuation, emoji) |
| `src/art.js` | Mochi's pixel-art sprites (a 40 × 40 grid: body, arms, legs, every eye, mouth and effect), the palette, and the face recipe for each mood |
| `src/styles.js` | All animations as stepped, whole-pixel sprite frames (moods, actions, effects), plus retro bubble and tag, responsive sizes, dark theme and reduced motion |
| `src/companion.js` | Draws Mochi, blinking, speech bubble, eye-follow, drag, tuck, click |
| `src/mood-engine.js` | Turns chat events into moods, plus idle life and sleep |
| `src/chat-watcher.js` | Watches the claude.ai page (read-only) and reports chat events |
| `src/content.js` | Starts everything and keeps Mochi out of the way of the message box |
| `src/background.js` | The toolbar button: brings Mochi to the current page, hides it or shows it |
| `src/ui-scan.js` | "Scan this UI": reads colors, type, shape, spacing, layout, components and effects from visible elements |
| `src/vibes.js` | The vibe rules: one editable table of 10 styles, each with scoring rules and do/don't notes |
| `src/scan-export.js` | Exporters for scans (AI prompt, DESIGN.md, CSS variables, Tailwind config, JSON) and picked elements (CSS, HTML + CSS, Tailwind classes, prompt, JSON); pure, testable in Node |
| `src/store.js` | Saved state (`chrome.storage.local`) and settings, with defaults each feature adds |
| `src/i18n.js`, `src/locales/*.js` | Translations: `Mochi.t('key')` |
| `src/menu.js` | The menu app: five sections, and the registry features add their items and settings to |
| `src/outfits.js` | The wardrobe: accessory sprites in one data format, the seasonal outfit and snow |
| `src/progress.js` | Levels, XP (one config table, hourly cap), unlocks, daily streak, stat card and share card |
| `src/characters/*.js` | The characters (Mochi, cat, robot, ghost): body parts, colors, phrases, mood map, personality |
| `src/friends.js` | Who you are and the friend beside you: a second character with its own mood engine |
| `src/panel.js` | The sheet beside Mochi: scan results, picked elements, the pocket list and the offer card |
| `src/picker.js` | "Pick an element": the pick overlay, and the picked element's style, hover, clean HTML and CSS |
| `src/pocket.js` | The pocket (last 20 scans in `chrome.storage.local`) and the paste into claude.ai's message box (never sends) |
| `icons/` | Extension icons |
| `test/test-page.html` | A local stand-in for the claude.ai chat with buttons for every mood and action |
| `test/scan-fixtures.html` | Offline fixture pages, one per vibe (`?v=soft`, `cyber`, `brutal`, `glass`, `editorial`, `minimal`, `retro`, `corporate`, `playful`, `luxury`) to try the scan |
| `test/export.test.js` | Tests for the vibe rules and exporters: `node test/export.test.js` |
| `test/files.test.js` | Checks that manifest, toolbar button and test pages load the same files: `node test/files.test.js` |

### Try the test page

```bash
cd mochi-extension
python3 -m http.server 8765
```

Then open http://localhost:8765/test/test-page.html (it stands in for claude.ai, so Mochi follows its chat). The left panel switches moods, plays actions, sends simulated happy, sad, surprising and code messages, starts a new chat, puts Mochi to sleep, toggles dark mode, and has buttons for every feature: the date, outfits, level/XP, characters and friends. These test controls work only on `localhost` and local files, never on claude.ai.
