# PROGRESS — 4 new Mochi features (branch `feature/four-features`)

Work protocol: one subtask at a time → verify → tick here with notes → commit → push.
A new session: read this file, `git status`, `git log --oneline -15`, continue at the first unchecked box.

## Current state

- Branch `feature/four-features` started from `main` @ b214d55 (Mochi 1.25.0: everything up to online friends).
- Setup done: `dev/` (verify.sh, build-zip.sh, release-notes.sh, package.json), `tests/smoke.mjs` (group `base`: 12 checks, all pass). Next: 1.1.

## Questions for Inna

1. **Version number.** The task says set `manifest.json` to `1.2.0`, but the extension is already at `1.25.0` (GitHub releases v1.25.0 exist and the release workflow publishes whatever version `main` has). Going down to 1.2.0 would make Chrome and the release page treat it as an *older* version. I'm using **1.26.0** instead. Tell me if you really want 1.2.0.

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
- [ ] 1.1 `src/store.js`: per-key area (sync vs local), local cache + debounced/batched sync writes, 8 KB/item + ~100 KB checks, QUOTA errors → fall back to local without crashing; works in the background worker and on extension pages too.
- [ ] 1.2 Lazy keys (XP/progress flushed every few minutes and on `visibilitychange`/`pagehide`); `updatedAt` per setting.
- [ ] 1.3 Merging from other computers (`onChanged` area `sync`): max XP/level/streak, union of unlocked items, newest value per setting.
- [ ] 1.4 Migration: schema `version`, copy existing local values into the new structure once (local kept); `installDate` from the migration date (marked as migrated).
- [ ] 1.5 Smoke tests for sync: merge from "another computer", quota fallback, migration, flush.

### 2. ChatGPT and Gemini
- [ ] 2.1 Site adapter interface + `src/sites/claude.js`; `chat-watcher.js` and the mood engine only use the adapter; claude.ai behaviour unchanged (all old checks pass).
- [ ] 2.2 `src/sites/chatgpt.js`, `src/sites/gemini.js` + offline fixtures `test/sites/chatgpt.html`, `test/sites/gemini.html`; selectors documented here.
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
