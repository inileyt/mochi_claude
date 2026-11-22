# dev/ — tools for working on Mochi (not part of the extension)

- `./build-zip.sh` → `dist/mochi-extension.zip` (only the extension files + the install guide).
- `./release-notes.sh` → release notes (used by `.github/workflows/release.yml`).
- `npm install` here (once), then `npm run smoke` → `tests/smoke.mjs` (Playwright + Chromium).
  If Playwright is already installed globally, the smoke test uses that and `npm install` is not needed.
- `npm test` → the fast unit tests in `test/*.test.js`.
