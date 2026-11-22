# dev/ — tools for working on Mochi (not part of the extension)

- `./build-zip.sh` → `dist/mochi-extension.zip` (only the extension files + the install guide).
- `./release-notes.sh` → release notes (used by `.github/workflows/release.yml`).
- `npm install` here (once), then `npm run smoke` → `tests/smoke.mjs` (Playwright + Chromium).
  If Playwright is already installed globally, the smoke test uses that and `npm install` is not needed.
- `npm test` → the fast unit tests in `test/*.test.js`.
- `./verify.sh` → syntax of every JS file, manifest.json (and every file it, the HTML pages and the worker load), unit tests.

## Smoke test groups (`node tests/smoke.mjs [group …]`)

`base` (moods, chat watcher, themes, drag, toolbar, chrome:// badge) · `sync` · `fallback` · `onboarding` · `birthday` · `sites`.
Results also go to `tests/.out/last-run.json`.

## Test hooks (only on local test pages: `file:`, `localhost`, `127.0.0.1`)

```js
document.dispatchEvent(new CustomEvent('mochi:debug', { detail: { birthday: { today: '2026-11-22', installDate: '2025-11-22' } } }));
```

On `test/test-page.html` the same functions are on `Mochi.debugHooks` and return a promise.

- `birthday: { today, installDate, migrated, reset }` — pretend another day (`today: null` = the real date) and/or install day, then run the birthday check. `reset: true` forgets the celebrations and the hat. Returns `{ today, birthday, celebrate, mark }`.
- `birthdayCard: years` — save the birthday share card.
- `tour: 'start' | 'next' | 'skip' | 'reset'` — the first-time tour.
- `whatsNew: { seen, version }` — pretend an update from `seen` to `version`.
- `chatSize`, `bookmarks`, `exportChat`, `shareCard`, … — see each feature's file.
