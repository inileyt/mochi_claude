# Mochi Tools — progress

Three small helpers Mochi holds in his paws: **site notes**, a **color picker** (EyeDropper) and a
**hover font inspector**. Cute, light, local.

Branch: `feature/tools` (from `main` @ 5e1bf4e, v1.28.0). Protocol: implement → verify → tick here
with notes → commit → push → next. Verification: `./dev/verify.sh` + `node tests/smoke.mjs base tools`
(+ every group at the end). No `dev/perf-baseline.json` exists: the core grows only by small stubs
(menu items, the notes badge check, the lazy loader); everything else is lazy-loaded.

## Design (decided up front)

- **No feature registry with unlocks exists** (only the menu registry; levels unlock characters and
  outfits), so per the task the tools live in the existing **Tools** menu section, not gated by level.
- **Lazy loading:** `src/tools/tools.js` (core, tiny) has the menu items, settings, the notes badge
  check and `Mochi.tools.load(id)`. It asks the background to `chrome.scripting.executeScript` the
  tool's files into this tab (host access: claude.ai by its content-script match, other sites by the
  toolbar click's activeTab). On local test pages (no extension API) it adds `<script>` tags.
- **Nothing runs when a tool is off:** tools add listeners and timers only through a tracked scope
  (`Mochi.tools.scope(id)`), disposed on exit; tests check the count is 0 and the code isn't loaded
  before first use.
- **Notes storage:** each note under its own `chrome.storage.local` key (`notes.item.<id>`) + a local
  index `notes.index` (url/site, title, length, updated). A tiny **synced** index `notes.sync`
  (key, host, title, updated; ≤ 8 KB, newest kept, deletions as tombstones) lets "All notes" list
  notes from other computers (titles only); contents never sync and never leave the browser.
  Quota errors → Mochi says the notebook is full, nothing is lost.
- **Revisit reminder:** `chrome.permissions` isn't available to content scripts, so the setting
  opens a small Mochi page (`pages/notes-remind.html`) that explains it and asks for the optional
  `<all_urls>` host permission from the click. Then the background registers a tiny content script
  (`src/tools/note-url.js` + `src/tools/notes-peek.js`) that only reads the index and shows a little
  peek. Turning it off unregisters the script and gives the permission back; a permission removed
  in Chrome's settings unregisters it too.
- **Alt+F:** a `commands` entry (no permission; the shortcut grants activeTab like the toolbar).
- **Props:** notepad and pipette sprites in `src/art.js` (fx parts), focus glasses reused for the
  inspector (`Mochi.outfits.overrides`).

## Tasks

- [x] **0. Plan** — this file, branch.
- [x] **1a. Core** — `src/tools/tools.js` (Tools menu items, lazy loader + background op, tracked
      scopes), `src/tools/note-url.js` (URL normalization, unit tests), notepad + pipette sprites.
- [x] **1b. Notes storage** — notes CRUD, local index, synced index (merger), quota; unit tests.
- [x] **1c. Notepad** — Mochi holds it: page / site toggle, paper colors, `[ ]`/`[x]` checkboxes,
      debounced autosave + timestamp, movable, closable, Esc; the "notes for this page" paper badge.
- [x] **1d. All notes** — grouped by site, search, open, delete, export/import JSON + Markdown,
      Send to Claude (pocket; paste offer on claude.ai, never sends).
- [x] **1e. Revisit reminder** — explanation page, optional `<all_urls>`, registered peek script,
      click → full Mochi + notes, turning off removes script and permission.
- [ ] **2a. Color picker** — color math (HEX/RGB/HSL/OKLCH, unit tests), EyeDropper tool (pipette,
      leaning), result card, auto-copy HEX, name; hidden without EyeDropper.
- [ ] **2b. Palette + contrast** — history strip (24, synced, click copy, drag reorder, clear),
      contrast (two colors or page background, AA/AAA normal/large, thumbs up / worried), export
      CSS / Tailwind / JSON, save to pocket.
- [ ] **3a. Font inspector** — used-font detection (document.fonts + canvas width test, "probably"),
      tooltip, hover outline overlay, rAF throttle, glasses + magnifier cursor, Esc, no page clicks.
- [ ] **3b. Inspector extras** — click to pin, Copy CSS / Copy for AI, Alt+F command, open shadow
      roots and same-origin iframes.
- [ ] **4a. Fixtures + smoke group `tools`** — `test/tools/` pages; all the checks of Task 4.
- [ ] **4b. Finish** — README (GIFs), version 1.29.0 + release notes, full verification, summary, PR.

## Notes for the next session
- **1a** — Core `src/tools/tools.js` (content script): Tools menu items (Notes ✎, All notes ▤, Color picker ◉ only when `EyeDropper` exists, Font inspector Aa), setting action 'notes-remind' (opens the reminder page via the background), `Mochi.tools.load/open/toggle/scope/activeCount/isLoaded`, tool files register `Mochi.toolImpl[id]`; notes badge (reads `notes.index` once at start + on the 5 s tick when the URL changed + store.watch). **Lazy loading:** `executeScript` from the background does NOT work on claude.ai (content-script matches don't give the background host access: 'Cannot access contents of the page', and tabs.query doesn't even show the claude.ai URL) → the loader uses `import(chrome.runtime.getURL(file))` from the content script (runs in Mochi's isolated world); the 6 tool files are `web_accessible_resources` with `use_dynamic_url: true` (no fingerprinting, no permission). On local test pages: <script> tags next to tools.js (document.currentScript). `src/tools/note-url.js` (core + peek + Node): normalize → { page (no hash, no tracking params, sorted query, no trailing slash, no www), site }, keyOf; `test/note-url.test.js`. `src/tools/background.js`: Alt+F `commands.font-inspector` → inject Mochi if needed (activeTab) → toggle('fonts'); reminder ops (remindStatus/On/Off from Mochi's own pages only, openRemind, peekOpen), permissions.onRemoved → unregister. Manifest: `optional_host_permissions` + '<all_urls>', `commands`, `web_accessible_resources`. Sprites `notepad`, `pipette` (fx parts + hold-bob), `.notes-badge` CSS. Stub tool files (replaced by their subtasks). Smoke `tools`: nothing loaded/running before use; test page loads via script tags; extension copy loads via import(). Base 12/12. Test helper `inMochi` (executeScript in Mochi's world from the SW) only works where the background has host access (deepContext copies).
- **1b** — `src/tools/notes-store.js` (lazy; Node-testable): each note `notes.item.<fnv1a id>` via chrome.storage.local directly (so a quota error surfaces as Error code 'quota'; the item is written before the index, so a failed save leaves the old note intact), local `notes.index` via Mochi.store (the badge and the peek read it), synced `notes.sync` (host, title ≤ 60, updated; tombstones 30 days; newest 60) — added to store.js SYNC_KEYS with a merger (newer entry per key), plus `colors.history` (merger: local order first, ≤ 24) for 2b. API get/save (empty text → removed)/remove/list/all/elsewhere/toJson/toMarkdown (grouped by site)/importJson (keys must be page:/site:, newer wins, returns added/updated/skipped). `test/notes-store.test.js` (store.js in memory): page + site notes, tracking-param URL = same note, empty removes, Markdown, export → wipe → import round trip, re-import skipped, bad files, sync index without text, merger, quota (fake chrome.storage refusing big writes).
- **1c** — `src/tools/notes.js` (lazy): notepad `section.notes-pad` in Mochi's shadow root (**not** `.notepad`: that class is the sprite inside Mochi's SVG — tests must use `.notes-pad`): header (drag to move, position saved in `notes.pos`; This page / Whole site toggle; ×), ruled paper in 5 pastel colors (butter, mint, pink, sky, lilac), textarea; a click on a `[ ]`/`[x]` box ticks it (Mochi squishes happily on a tick), Ctrl+Enter ticks the line's box or adds one, ☐+ adds a box line; autosave 600 ms after typing (tracked timeout), on switching scope, on close and on pagehide; timestamp + 'saving…' + quota → 'notebook full' (Mochi sad, the text stays); Esc (document capture) or × closes; every listener/timer through `Mochi.tools.scope('notes')` → 0 left after closing. New `companion.hold(prop)` (src/companion.js): a prop that survives mood changes (`withHeld` in setMood/flashFx/clearFx) — Mochi holds the notepad while it's open. Default scope: the page note, or the site note when only that exists. Hooks: notesType, notesRead, notesAll. Smoke (extension copy): opens with tracking params in the URL, page + site keys, color saved; click on [ ] ticks; Esc closes with 0 listeners; reload with another tracking param → badge '2' → click → note back; another page of the site → badge '1', site note. Screenshot checked. **Locale keys (notes.*) come in 1d.**
- **1d** — In notes.js: `showAll` (panel view 'notes'): search (title, address, site and the note's text), groups by site with counts, each note: paper-color chip, title / 'Whole site', date + first line; Edit (when it's this page's or site's note) or Open (new tab, noopener; a site note opens the site's root), Claude, Delete (second click confirms: 'Sure?'); 'On your other computers' (titles from `notes.sync`); privacy note; footer ⤓ JSON, ⤓ Markdown, ⤒ Import (file input; merges, newer wins; quota/bad file → Mochi says so). `sendToClaude`: on claude.ai straight into the message box (insertIntoComposer, never sent); elsewhere a pocket entry kind 'note' (`Mochi.promptFor` wrapper → entry.paste = 'My note about …:' + text), offered on claude.ai ('offer.note': 'I brought a note from {host}! Paste it?'); pocket 'Formats' on a note opens All notes (content.js). 45 locale keys × 11 languages (notes.*, menu.notes/allNotes/picker/fonts, settings.notesRemind, tools.loadFailed, offer.note). Smoke: All notes groups + search filters (1 of 2), JSON + Markdown downloads (Playwright download event), delete both with confirm, import the JSON back through the closed shadow root (CDP DOM.setFileInputFiles) → 2 notes; Send to Claude → pocket → the claude.ai fixture tab offers it → paste → in the box, `sent` empty. 11/11 tools checks.
- **1e** — Menu → Settings → 'Note reminders on revisit…' opens `pages/notes-remind.html` (a popup window; plain-words explanation incl. Chrome's 'read and change all your data' wording; 11 languages `remind.*`): **Allow and turn on** → `chrome.permissions.request({ origins: ['<all_urls>'] })` straight from the click → background `remindOn` registers `mochi-notes-peek` (`src/tools/note-url.js` + `src/tools/notes-peek.js`, <all_urls> minus claude.ai, top frame, document_idle, persists) and sets `notes.remind`; **Turn off** → unregister + `permissions.remove` (fails harmlessly when the permission is built in, as in the test copy). permissions.onRemoved and onStartup without the permission → unregister. remindOn/Off only from Mochi's own pages. The peek: 1.2 s after load, skipped when Mochi is already there, reads only `notes.index` + the language; a tiny pixel Mochi head peeking up from the bottom right + 'You have a note here!' (11 languages built in), × closes, gone after 15 s; a click → background `peekOpen` injects Mochi (now allowed) and opens the notes (waits for `Mochi.tools.ready`, set in the tools feature init). Fixes on the way: the peek host needs display:block (an inline custom element had no clickable box); tests wait for the slide-in. Smoke: off by default → no peek; on → revisit with tracking params → peek count 1, full Mochi not loaded → click → notepad; off → unregistered → no peek. 14/14.

## Questions for Inna

(none yet)
