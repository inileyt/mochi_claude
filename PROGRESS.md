# PROGRESS — 4 new Mochi features (branch `feature/four-features`)

Work protocol: one subtask at a time → verify → tick here with notes → commit → push.
A new session: read this file, `git status`, `git log --oneline -15`, continue at the first unchecked box.

## Current state

- Branch `feature/four-features` started from `main` @ b214d55 (Mochi 1.25.0: everything up to online friends).
- Setup done: `dev/` (verify.sh, build-zip.sh, release-notes.sh, package.json), `tests/smoke.mjs` (group `base`: 12 checks, all pass). Task 1 (sync) done: `src/store.js` rewritten (same API), unit test `test/store.test.js` 9/9, smoke group `sync` 7/7. 2.1 done (site adapters, claude.ai unchanged: base+sync 19/19). 2.2 done (ChatGPT + Gemini adapters and fixtures). Next: 2.3.

## Questions for Inna

1. **Version number.** The task says set `manifest.json` to `1.2.0`, but the extension is already at `1.25.0` (GitHub releases v1.25.0 exist and the release workflow publishes whatever version `main` has). Going down to 1.2.0 would make Chrome and the release page treat it as an *older* version. I'm using **1.26.0** instead. Tell me if you really want 1.2.0.

2. **ChatGPT / Gemini selectors — please check them on the real sites.** I can't log in to chatgpt.com or gemini.google.com from here, so the adapters use selectors I believe those pages use (listed under "Notes per subtask → 2.2"). The offline fixtures `test/sites/chatgpt.html` / `gemini.html` copy that structure. When you try it: open a chat, send a message, and tell me if Mochi (a) sits beside the message box, (b) gets excited while the answer is written and (c) reacts when it finishes. If not, right-click the message box / an answer → Inspect and send me a screenshot; fixing it is a one-line change in `src/sites/chatgpt.js` or `gemini.js`.

## Conventions (for whoever continues)

- Plain JS, no build step, global `Mochi`, UI inside Mochi's shadow DOM, pixel art in `src/art.js`, texts in `src/locales/*.js` (11 languages; `node test/locales.test.js` must pass), test hooks via `document.dispatchEvent(new CustomEvent('mochi:debug', { detail }))` → `Mochi.debugHooks[key]`.
- A new content-script file must be listed in `manifest.json`, `src/background.js` (`FILES`) and the three test pages, same order (`node test/files.test.js`).
- Unit tests: `for t in test/*.test.js; do node "$t"; done`. Smoke test: `node tests/smoke.mjs` (Playwright, uses the preinstalled Chromium; dev setup in `dev/`).
- Online friends (Firebase) exist since 1.25.0 and stay as they are: off by default, the only network code, `src/online-api.js` in the background worker.

## Checklist

### 0. Setup
- [x] 0.1 Branch `feature/four-features`, this file.
- [x] 0.2 `dev/` (package.json, build-zip.sh, .gitignore), `tests/smoke.mjs` harness: loads the unpacked extension, routes claude.ai + test pages, checks Mochi mounts, no console errors, old behaviour (moods, chat watcher, themes, drag, toolbar toggle, chrome:// badge).

### 1. Settings sync (`chrome.storage.sync`)
- [x] 1.1 `src/store.js`: per-key area (sync vs local), local cache + debounced/batched sync writes, 8 KB/item + ~100 KB checks, QUOTA errors → fall back to local without crashing; works in the background worker and on extension pages too.
- [x] 1.2 Lazy keys (XP/progress flushed every few minutes and on `visibilitychange`/`pagehide`); `updatedAt` per setting.
- [x] 1.3 Merging from other computers (`onChanged` area `sync`): max XP/level/streak, union of unlocked items, newest value per setting.
- [x] 1.4 Migration: schema `version`, copy existing local values into the new structure once (local kept); `installDate` from the migration date (marked as migrated).
- [x] 1.5 Smoke tests for sync: merge from "another computer", quota fallback, migration, flush.

### 2. ChatGPT and Gemini
- [x] 2.1 Site adapter interface + `src/sites/claude.js`; `chat-watcher.js` and the mood engine only use the adapter; claude.ai behaviour unchanged (all old checks pass).
- [x] 2.2 `src/sites/chatgpt.js`, `src/sites/gemini.js` + offline fixtures `test/sites/chatgpt.html`, `test/sites/gemini.html`; selectors documented here.
- [ ] 2.3 Fallback mode (adapter finds no chat → plain companion, one `console.debug`).
- [ ] 2.4 `optional_host_permissions`; enabling a site = `chrome.permissions.request` (from a user gesture, on an extension page) + `chrome.scripting.registerContentScripts`; disabling unregisters + removes the permission; re-register on browser start and extension update.
- [ ] 2.5 Smoke tests on the fixtures (both sites: mount, reply streaming → reactions, theme, fallback); description text updated.

### 3. Onboarding
- [ ] 3.1 `onInstalled`: install → `installDate` + open `welcome.html`; update → one "What's new" bubble next time Mochi appears (changelog table).
- [ ] 3.2 `welcome.html` (pixel style, light/dark): 4 steps with Back / Next / Skip — wave, color + name, sites (permissions), "Open claude.ai".
- [ ] 3.3 First time in a chat: 3-bubble tour (menu, dragging, play click) with Next / Skip; `onboardingDone` in sync; "Replay tour" in Settings.
- [ ] 3.4 Smoke tests: install opens welcome, steps, sites, tour once, replay, what's new once.

### 4. Mochi's birthday
- [ ] 4.1 Date logic (`src/birthday.js`, pure functions + unit tests): 7 days, 1 month, 100 days, anniversaries, Feb 29 → Feb 28, once per milestone/day across tabs (`lastCelebrated`), no fake anniversary for migrated `installDate`.
- [ ] 4.2 Milestone bubble + confetti.
- [ ] 4.3 Anniversary: party hat, pixel cake with candles = years, click → blow out (animation + confetti); "birthday hat" outfit unlockable only that day, stays unlocked.
- [ ] 4.4 Share card "1 year with Mochi 🎂" (canvas PNG, Mochi, his name, github.com/inileyt/mochi_claude).
- [ ] 4.5 Debug hooks (fake date / installDate) + smoke tests for every milestone.

### 5. Finish
- [ ] 5.1 Full verification, README (features, privacy, optional permissions in plain words, enabling ChatGPT/Gemini), version 1.26.0, `dev/build-zip.sh`, final summary here, push, PR to `main`.

## Notes per subtask

- 0.1: Branch created from main @ b214d55. Plan above.
- 0.2: `dev/verify.sh` (node --check on all JS, manifest valid + files exist, unit tests), `dev/build-zip.sh` (moved from scripts/, workflow updated; zip = manifest.json, src, icons, HOW-TO-INSTALL.md only), `tests/smoke.mjs` with fixtures `tests/fixtures/claude.html` (simulates a message + streaming reply with claude.ai's selectors) and `plain.html`. Group `base` 12/12: test page mounts, moods, chat watcher, dark theme, drag; real extension on routed claude.ai mounts, menu, reacts; chrome:// × badge; toolbar add→hide (a temp copy with `<all_urls>` host access, because headless can't click the toolbar to grant activeTab); no console errors. Playwright: dev/node_modules or the global one (createRequire).
- 1.1–1.4: `src/store.js` rewritten with the same API. SYNC_KEYS = mochi.settings, mochi.progress, mochi.meta (installDate, installMigrated, onboardingDone, tourSkipped, unlocked[], celebrated[], lastCelebrated, whatsNewSeen), game.best. Sync keys are written to local at once + to sync batched (1.5 s) or lazy (3 min; `set(key, v, { lazy: true })`, used by progress.js), flushed on visibilitychange-hidden / pagehide and merged with sync on every start (so a cut-off flush is caught up next time). >8000 bytes or a QUOTA error → key stays local (`Mochi.store.localOnly`), one console.debug. Merge rules in `Mochi.store.mergers`: settings = per-path newest via `settings.__ts[path]` (set by `settings.set`; `__ts.*` paths are not emitted to listeners); progress = max XP, longer streak, max best, hour/pets caps stay per computer; meta = real installDate beats a migrated one else the earliest, onboardingDone/tourSkipped OR, unlocked/celebrated union, latest lastCelebrated, highest whatsNewSeen; game.best = max. Migration: `mochi.schema` {version: 2}; old local values stay; if there was 1.x data, `installDate` = migration day with `installMigrated: true` (no fake anniversary). Store works without chrome.storage (memory) and is safe in a service worker (no document use at load).
- 1.5: `test/store.test.js` (fake chrome.storage with both areas) 9/9; smoke group `sync` 7/7 with the real extension: schema + installDate, values reach sync, higher XP from "another computer" merges in (stat card shows the new level), a newer color recolors Mochi live, lower XP doesn't lower mine (and sync gets corrected back up), XP is lazy and reaches sync after leaving the page. Base group still 12/12, verify OK.
- Bug found and fixed on the way: the menu's **Play** item didn't emit `poke`, so playing gave no XP and the friend/sounds didn't react (since 1.5). `content.js` actions.play now emits it.
- Note: headless Chromium never makes a tab "hidden" when another is brought to front, so the visibilitychange flush can't be tested there; the pagehide + next-start path is tested.
- 2.1: `src/site.js` (`Mochi.sites.register/current/get`, `Mochi.site` getter) gives every adapter the same interface: findComposer, composerBox, userMessages, assistantMessages (outermost), messages (page order), answerAt, isStreaming, theme, isNewChat, hasChat, watchAttributes. `src/sites/claude.js` holds the old selectors (and still sets `Mochi.config.selectors`). `chat-watcher.js` uses only `this.site`; bookmarks, chat export, long-chat, pocket and the theme watcher now ask `Mochi.site` instead of using claude selectors. A local test page picks its adapter with `<html data-mochi-test="claude|chatgpt|gemini">`. Checked: verify OK, smoke base+sync 19/19, bookmarks/export scratch checks unchanged.
- 2.2: `src/sites/chatgpt.js` and `src/sites/gemini.js` (plain data + small functions). Fixtures `test/sites/chatgpt.html` / `gemini.html` copy the structure below; `fixture.send(text, reply)` adds your message and streams an answer word by word, `?theme=dark` for dark, `fixture.breakPage()` removes everything the adapter looks for (for the fallback test). Scratch check on both fixtures (light + dark): composer + box found, messages in order (u a u a), streaming true while writing and false after, theme right, answerAt works, hasChat false after breakPage, no page errors.
  **Assumed selectors (first match wins; please check, see Questions):**
  - ChatGPT (`chatgpt.com`, `chat.openai.com`): your messages `[data-message-author-role="user"]`; answers `[data-message-author-role="assistant"]`; writing = `[data-testid="stop-button"]` / `button[aria-label="Stop streaming"]` / `button[aria-label="Stop generating"]` / `.result-streaming`; message box `#prompt-textarea[contenteditable="true"]` (ProseMirror) → `textarea#prompt-textarea` → `form [contenteditable]` → `form textarea`, Mochi sits beside its `form`; theme = `html.dark` / `html.light`; new chat = path `/`.
  - Gemini (`gemini.google.com`): your messages `user-query` (→ `.user-query-container`); answers `model-response` (→ `.model-response-text`); writing = `button[aria-label="Stop response"]` / `button.send-button.stop` / `.stop-icon`; message box `rich-textarea .ql-editor[contenteditable="true"]` (Quill) → `.ql-editor[contenteditable]` → `rich-textarea [contenteditable]` → `.text-input-field textarea`, Mochi sits beside `input-area-v2` / `.input-area` / `.input-area-container` / `form`; theme = `body.dark-theme` / `body.light-theme`; new chat = path `/app`.
