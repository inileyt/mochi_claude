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
- [ ] **1c. Notepad** — Mochi holds it: page / site toggle, paper colors, `[ ]`/`[x]` checkboxes,
      debounced autosave + timestamp, movable, closable, Esc; the "notes for this page" paper badge.
- [ ] **1d. All notes** — grouped by site, search, open, delete, export/import JSON + Markdown,
      Send to Claude (pocket; paste offer on claude.ai, never sends).
- [ ] **1e. Revisit reminder** — explanation page, optional `<all_urls>`, registered peek script,
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

## Questions for Inna

(none yet)
