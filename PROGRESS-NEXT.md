# Mochi 1.30 / 1.31 — Live Edit, Guides, Design taste, Bug Reporter, SVG for Figma — progress

Inna's choice (chat, 2026-11-23): **Live Edit** first, then **Mochi Guides** and **your design taste**
(1.30.0, one PR); then **Bug Reporter** and **element → SVG for Figma** (1.31.0, a second PR).

Protocol (as before): branch per release, implement → verify → tick here with notes → commit → push → next;
questions under "Questions for Inna", keep going. Verification: `./dev/verify.sh` + the smoke groups touched
+ `base`; everything at the end of each release. Each feature is lazy-loaded like the tools (src/tools/tools.js
FILES + web_accessible_resources); a feature that isn't in use runs nothing.

## Design (decided up front)

### Live Edit — Claude changes any page in front of you
- Tools → **Live Edit**: pick an element (the picker) or the whole page → "What should change?" (+ chips:
  bigger text, dark mode, hide this, easier to read…). Mochi holds a paintbrush.
- The request (element HTML trimmed to ~6 KB, its key computed styles, a stable selector, page title/URL,
  and, where screenshots are allowed, a picture) goes into the pocket as an "ask" entry; claude.ai is opened /
  focused and Mochi offers to paste it (never Enter). The question asks for **one CSS code block** only.
- On claude.ai Mochi remembers the pending edit; when Claude's answer ends (`responseEnd`), it takes the CSS
  from the answer's code blocks (DOM `pre code`, else ``` fences), stores it (`liveEdit.result`) and the
  background brings the original tab back. There the CSS is applied (one `<style>` Mochi owns), with a card:
  before/after, edit the CSS by hand, ask for a tweak (iterate), undo, copy/export, **keep on this site**.
- **CSS only, never scripts.** A sanitizer drops `@import`, `url()` that isn't `data:`, `expression()`,
  `javascript:`, `-moz-binding`, `behavior`; 50 KB max. Nothing Mochi applies can load anything from the web.
- Kept edits (`liveEdit.kept`, per site or page) apply whenever Mochi is on the page; with the optional
  `<all_urls>` (the same permission as note reminders, asked from a click on a Mochi page) a tiny registered
  script applies them on every visit at `document_start`.

### Mochi Guides — Claude's steps become a guide on the real site
- When an answer has steps (an ordered list of ≥ 3 items, or numbered lines), Mochi offers **Make it a guide**
  (also Menu → "Guide from the last answer"). Steps are parsed locally: the text, and the things to look for
  ("quoted", **bold**, `code`, `Settings → Security → …` paths), plus the first link as the start page.
- "Ask Claude for a guide" pastes a prompt that asks for steps in a format Mochi reads exactly.
- On the target site Mochi shows the step card, **walks to the matching button and points at it** (found by
  its visible text / accessible name; outlined on Mochi's layer), notices when it's done (a click on it, a
  page change, the next target appearing) and moves on; ✓ / back / skip; "can't find it" → tips + ask Claude.
  Mochi never clicks for you.
- The guide survives page loads (state in storage, tied to the tab). With the optional permission, Mochi
  rejoins the tab by himself after a navigation; without it, a click on Mochi's toolbar icon resumes.
- **Record a guide:** Mochi watches your clicks (and which fields you type in, never the values) and writes
  the steps; export/import as a `.mochi-guide.json` file to share.

### Your design taste
- Mochi keeps small local "taste events" from what you already do: UI scans, picked elements, image scans,
  picked colors, pinned fonts in the inspector, kept Live Edits (colors, fonts, vibe, radius, spacing; host,
  date). ≤ 300 events; setting to turn collecting off; "Forget everything".
- Menu → **My design taste**: favorite colors (merged in Lab, weighted by recency) with names, favorite fonts,
  vibes, light/dark and saturation tendency, typical radius/spacing, what it's based on. Copy / paste to
  Claude as a "design taste brief" or download `TASTE.md`. Mochi wears an artist's beret there.

### 1.31 — Bug Reporter, SVG for Figma (planned after the 1.30 PR)
- Bug Reporter: record steps (fields masked), console errors and failed requests (through the existing
  debugger connection, own tab only), screenshots per step → a report (Markdown + zip) for Claude or GitHub.
- Element → SVG: rects with fills/borders/radius/shadows, text as `<text>`, images as `<image>` → clipboard
  as `image/svg+xml` + text so Figma pastes editable layers.

## Tasks — 1.30.0 (branch `feature/live-edit-guides-taste`)

- [x] **0. Plan** — this file.
- [x] **L1. Live Edit core** — CSS sanitizer + code-block extraction (unit tests), the request builder,
      `src/tools/live-edit.js` (pick / whole page, the request card, chips), paintbrush sprite.
- [x] **L2. The round trip** — pocket "ask" entry → claude.ai paste offer; watching the answer; result to the
      original tab (background focuses it); apply + card (before/after, edit, tweak, undo, copy).
- [x] **L3. Keep it** — kept edits per site/page, applied when Mochi is there; optional permission page +
      registered `document_start` applier; manage/delete list.
- [x] **G1. Guide parsing** — steps + targets + start URL from an answer (unit tests); the offer on claude.ai,
      the "ask Claude for a guide" prompt.
- [x] **G2. Playing a guide** — target finder (text / accessible name, scoring), Mochi walks + points,
      outline, step card, auto-advance (click / navigation / next target), state across page loads.
- [x] **G3. Record + share** — recording clicks/fields (no values), export/import `.mochi-guide.json`.
- [x] **T1. Taste** — events from the existing tools, profile math (unit tests), the panel + brief + TASTE.md,
      beret, settings (collect on/off, forget).
- [x] **F. Finish 1.30** — fixtures (`test/next/`), smoke group `next`, README (+ GIFs), 11 languages,
      version 1.30.0, full verification, PR.

## Tasks — 1.31.0 (after)

- [x] **B1. Bug Reporter** — recording, console + network errors via the debugger proxy, screenshots, report.
- [x] **S1. Element → SVG for Figma** — SVG builder, clipboard, fixtures + tests.
- [ ] **F2. Finish 1.31** — README, version, full verification, PR.

## Notes for the next session
- **L1** — `src/tools/live-css.js` (lazy, Node-tested in `test/live-css.test.js`): sanitize (drops @import, remote @font-face, url()/image-set() that aren't data: → none, expression(), javascript:, -moz-binding/behavior (lookbehind, so two in a row both go), 50 KB max; reports what it removed), fromText/fromBlocks (css/scss/less fenced blocks, else unlabelled CSS-looking ones), question (wish, page, selector, tag, size, key computed styles, trimmed HTML or the page outline, the current CSS for a tweak, 'answer with ONE css code block', the answer-language note, the marker `[Mochi Live Edit #id]`). `src/tools/live-edit.js` (lazy): start panel (Pick a part / Whole page; kept edits for this site with on/off/delete), the picker, the wish card (textarea + 6 chips, Ask Claude, Write CSS myself), stable selector (id, stable classes, nth-of-type, ≤ 6 levels, unique), describe (styles + HTML stripped of scripts/handlers/long attributes, ≤ 6 KB). Brush sprite (Mochi holds it). Menu Tools → ✨ Live Edit. **Shell lesson:** never put triple backticks in a double-quoted shell argument (they run as commands).
- **L2** — Round trip: background `liveEditAsk` stores `liveEdit.pending` with the origin tab/window; pocket entry kind 'edit' (ask, promptFor wrapper) + `openClaudeTab`; claude.ai offers it ('offer.edit'); editing claude.ai itself pastes directly. On claude.ai the core (tools.js) arms when the sent message contains `#<pending id>]`, and on responseEnd loads live-edit.js → `onAnswer` reads `pre > code.language-*` blocks (else fenced blocks in the text) → `liveEdit.result` → background `liveEditReturn` focuses the origin tab. The origin page (store.watch, or the core at start if the page reloaded) sanitizes, applies (`<style data-mochi-live=id>`), Mochi spins + sparkles, and shows the card: before/after, CSS editable live (debounced, re-sanitized), copy, undo, 'Ask for a tweak' (new question with the current CSS; the new edit replaces the old), keep. Fixture `tests/fixtures/claude.html` gained `fixture.reply(md)` (renders fenced lang blocks as pre > code.language-x) and `fixture.sendBox(md)`; `test/next/edit.html`. Tests must mark the claude.ai tour as seen, or the tour card sits where the offer goes.
- **L3** — Kept edits `liveEdit.kept` (site or page, on/off, ≤ 200): the core applies them whenever Mochi starts on a page; with the optional `<all_urls>` the background keeps a `document_start` script registered (`src/tools/note-url.js` + `src/tools/live-apply.js`, id mochi-live-apply) exactly while the permission exists and an edit is on (storage + permission change listeners → `liveEditSync`). Without the permission, keeping explains it and offers **Apply it every time…** → `pages/everywhere.html?why=edits` (shared with Guides later; Allow → permissions.request from the click; Turn off → unregisters both scripts and gives the permission back). Note reminders' 'off' now keeps the permission while kept edits use it. Bug fixed: `ev.currentTarget` is null after an await (toggle/delete in the kept list). 53 keys × 11 languages (live.*, every.*, menu.liveEdit, offer.edit). Smoke group `next` (7): pick → question in the pocket with the selector and marker; claude.ai offer → paste (no Enter) → you send → the fixture answers CSS with a remote url → applied on the origin tab (red 40px title, 16px radius), the url dropped and reported; before/after, hand edit; keep on site → registered → a fresh tab **without Mochi** has the CSS; off + delete → unregistered; nothing left the browser; no console errors. base 12/12.
- **G1** — `src/tools/guide-parse.js` (lazy, `test/guide-parse.test.js`): parse({ text, items, links }) → title, startUrl (first non-claude.ai link), host, steps { text, targets, action click/type/navigate/read, url }; items = the answer's top-level `ol > li` (+ their bold, code and links), else numbered lines; targets: “quoted” / bold / code are exact (then no guessing), else menu paths (A → B → C) and verb phrases ('Click Save changes'); prompt(task, lang) asks Claude for a start address + numbered steps with exact button texts in quotes and → paths; toFile/fromFile (`.mochi-guide.json`, only http(s) urls survive an import). On claude.ai the core (tools.js) looks at each finished answer cheaply (≥ 3 `ol > li` or numbered lines) and only then loads the guide code → offer card 'These look like N steps! Walk you through them?' (setting `guides.offer`, default on). Menu: Tools → 🧭 Guides, ▶ Guide from the last answer (claude.ai).
- **G2** — `src/tools/guides.js`: start → background `guideStart` opens the start page in a new tab (or plays here) and stores `guides.active` with that tab; with the optional permission the background re-injects Mochi after every page load in that tab (tabs.onUpdated), otherwise a toolbar click brings him; the core asks `guideHere` at start and resumes. Playing: step card (bottom left; ← ✓ skip, can't find it, ×), target finder (clickable things incl. open shadow roots, accessible names: aria-label, label, placeholder, text; exact 100 / starts 80 / contains 62, buttons +5, on screen +3, ≥ 50; **a label stands for its field**), scroll into view, pulsing outline, Mochi **walks** there (explore's --ex-x/--ex-y offset, walking legs, `.root.guiding` so explore mode stays out) and looks at it; auto-advance on a click on it or a change in it (capture, passive: the page's own handlers run, Mochi never clicks), re-search every 0.9 s and on URL changes (single-page sites); finish → celebrate + 'guideDone' event. Can't find it → a question for Claude (the step, the page, the visible button names) copied + pocket.
- **G3** — Recording: `guides.recording` tied to the tab (survives page loads like a guide); clicks → 'Click “name”', field changes → 'Fill in “label”' (password fields named as such), **never values**; stop → saved in `guides.saved` (≤ 50) → list: play, ⤓ export, ✕, ⤒ import, 'Ask Claude for a guide'. 41 keys × 11 (guide.*, menu.guides/guideLast, settings.guideOffer). Fixture `test/next/site.html` (settings site with pushState sections, a label + field, a page click counter); claude.html fixture renders numbered lines as `ol > li` and addresses as links (like claude.ai). Smoke (+4 → 11/11 in `next`): offer → new tab → Mochi there with step 1; step 2 found, outlined, Mochi walked; your click → step 3; typing in the field (label → field) → finished 🎉; record 4 steps (no typed value), export file, play here. **Test lesson:** `inMochi` (eval in Mochi's world) never worked — the extension CSP blocks eval there; use debug hooks on local pages (removed the helper).
- **T1** — Core (tools.js) collects `taste.events` (local, ≤ 300; setting `taste.collect`, default on): UI scans (colors + roles, heading/body fonts, vibe, radius, spacing grid, theme), picked elements, image scans (palette, matched fonts, on-device style), picked colors (`colorPicked` emitted by picker.js), pinned fonts in the inspector (`fontPinned`), kept Live Edits (`liveKept`: hex colors in the CSS). Pills (radius ≥ 200) don't count as corners. `src/tools/taste.js` (lazy, `test/taste.test.js`): profile → colors merged under ΔE 10, weighted by recency (a month = half) and role (accent 1.3 … text 0.6), top 8 with names and shares; fonts and vibes tallied the same way (generic families left out, vibes case-insensitive); tone (from themes, else lightness), saturation, median radius and spacing, sources; brief → Markdown 'My design taste' (colors with hex, typefaces, vibe, shapes and feel, 'please design in this direction'). Panel (Menu → Mochi → 🎨 My design taste): swatches (copy), fonts with Aa, vibe chips, feel chips, Copy for Claude (or Paste on claude.ai), TASTE.md, Forget (confirm); Mochi wears a painter's beret (`Mochi.outfits.overrides.head`, off when the panel closes). 24 keys × 11 (taste.*, menu.taste, settings.tasteCollect, outfit.beret). Smoke (+2 → 13/13): a UI scan + the kept Live Edit → events → panel with colors, beret, brief copied; forget → empty; collecting off → nothing collected. base 12/12.
- **F** — Fixtures `test/next/` (edit.html, site.html); smoke group `next` 13 checks; README section 'Live Edit, Guides and your design taste (v1.30)' with 3 new GIFs (`dev/record-gifs.mjs live guide taste` — scenes are now selectable), Privacy (every-site permission, what Live Edit sends only when you send it, guides, taste notes), Files table; version **1.30.0**, `release-notes/1.30.0.md`, What's new `whatsNew.1_30_0` × 11. Zip 6.55 MB. **Full verification: `node tests/smoke.mjs` (10 groups) 147 passed, 0 failed**; verify.sh ok.
- **B1** — Branch `feature/bug-reporter-svg` (from the 1.30 branch; PR #8 not merged yet). `src/debugger-proxy.js` got a **report mode** (`attach({ mode: 'report' })`, cdp.js `attach('report')`): no Fetch navigation blocking, dialogs untouched, stays attached across page loads in that tab (onUpdated only detaches scan sessions), 15 min limit, allowlist only Page.enable/captureScreenshot/getLayoutMetrics, Runtime.enable, Log.enable, Network.enable; events are reduced in the background to what went wrong (exceptions with text/url/line, console error/assert/warning, Log error/warning, HTTP ≥ 400 with method + address **without the query**, loading failures; never bodies/headers/cookies), kept there (≤ 200, op `events`, returned by detach) and forwarded as `Mochi.report`. `cdp.detachAny` (a new page's client doesn't know an earlier page attached). `src/tools/bug-report.js` (Node-tested `test/bug-report.test.js`): markdown (title, where/browser/window/lang/time, steps with screenshot refs, expected, actual, console block, failed-requests table, screenshots list, the privacy line), forClaude, summary. `src/tools/bugs.js`: intro (what's recorded, 'catch errors' checkbox → report-mode attach; without it, steps only), recording card (live counts; Mochi holds the magnifier and reacts 'Caught one! 🐞'), steps (clicks; field changes named, **never values**; 'Opened <url>' after a page load), a JPEG screenshot via CDP after each step (Mochi hidden, ≥ 1.2 s apart, ≤ 15, `bug.shots`), recording tied to the tab and resumed after page loads (core asks `bugHere`; with the permission the background re-injects Mochi); report panel (title, expected, actual, thumbnails, live report.md preview; For Claude (copy + pocket; paste on claude.ai), For GitHub (copy), ⤓ .zip with report.md + screenshots via Mochi.zip). 30 keys × 11. Fixture `test/next/buggy.html` (uncaught TypeError, console warning + error, a 404 with a secret query). Smoke group `reporter` (4): 3 steps · 2 errors · 1 failed; the report has steps/errors/404 without the typed coupon or the query, zip with JPEGs, debugger closed; recording across a page load, cancel detaches; no Mochi console errors.
- **S1** — Lazy src/tools/svg-export.js (Tools → ◇ Copy for Figma): pick an element (the Picker), Mochi rebuilds it as SVG: boxes → rect (fill, border, radius, first drop shadow as feDropShadow, linear gradients), each text line → text at its real place (font, size, weight, color, letter spacing, text-transform), same-origin pictures → image (data URL; cross-origin ones become a gray placeholder: no fetching), inline SVG icons copied (currentColor resolved), one g per element named tag#id.class (Figma layer names); hidden parts skipped, 600 nodes max. Copied as text (Figma turns pasted SVG code into editable layers), plus .svg download and a preview. Fixture test/next/figma.html; smoke reporter group +1 (valid XML, renders as an image at the right size, clipboard = SVG, download). Checked visually side by side: very close (text ±2px). Locales ×11.

## Summary 1.30 (done)

Live Edit (Claude changes any page through a CSS round trip via claude.ai, sanitized, keepable per site, optional every-visit applier), Mochi Guides (answers with steps → a guide on the real site: Mochi finds, walks to and points at each button, auto-advances, never clicks; record + share files) and your design taste (local notes → colors/fonts/vibe profile → a brief for Claude). Optional `<all_urls>` is shared by note reminders, kept edits and guides, always asked from a click on a page that explains it. Next: 1.31 (Bug Reporter, element → SVG for Figma) on a new branch after this PR.

## Questions for Inna

(none yet)
