# Mochi Image Scan — progress

Right-click any image → **Scan image with Mochi** → a card with the palette, the text in the
image (OCR), its font style, what the image shows, and AI image prompts. Everything local.

Branch: `feature/image-scan` (from `main` @ 3ea785d, v1.27.2). Work protocol: implement → verify →
tick here with notes → commit → push → next. Verification each time: `./dev/verify.sh`
(syntax, manifest, unit tests) + `node tests/smoke.mjs base imagescan` (+ the other groups at the end).

## Design (decided up front)

- **Where the work runs.** The page (content script) only finds the image, scrolls it into view,
  hides Mochi and asks the background for screenshots. The background (`src/background.js`)
  calls `chrome.tabs.captureVisibleTab` (PNG, ≤ 2 per second: Chrome's limit) and hands the tiles to
  an **offscreen document** (`pages/image-scan.html`), which crops + stitches, computes the palette,
  runs Tesseract (its own Web Worker), matches fonts and asks the on-device model. The page never
  freezes. Progress goes offscreen → background → tab (`chrome.tabs.sendMessage`).
- **Access.** `activeTab` is granted by the right-click menu and by the toolbar button. The hover
  magnifier on a page where Mochi came by the toolbar has it too. On claude.ai (Mochi there on its
  own, no activeTab) the magnifier first tries to read the image directly (same-origin / blob images,
  which is what claude.ai shows), and else says "right-click the image → Scan image with Mochi".
- **Shared code** (`src/image-scan/*.js`, plain scripts that work in the page, the offscreen doc and
  Node unit tests): `colors.js` (Lab, ΔE, color names), `palette.js` (k-means in Lab, roles, stats,
  gradient), `fontstyle.js` (glyph features, matching), `prompt.js` (universal / Midjourney / SD /
  DALL·E prompts, alt text, the "Ask Claude" question).
- **Vendored** (no CDN): `src/vendor/tesseract/` (tesseract.js 7.0.0 worker + core 6.1.2
  SIMD-LSTM build, `eng` + `rus` tessdata_fast, gzipped), `src/vendor/fonts/` (20 OFL/Apache
  Google Fonts as woff2, Latin + Cyrillic). `dev/vendor.sh` fetches them again.
- **Prompt API** (option A) runs in the offscreen document. If the model must be downloaded,
  that needs a click on an extension page: Mochi opens `pages/ai-model.html` (a small window) where
  the user agrees and sees the download. Tests replace `LanguageModel` in the offscreen document
  through DevTools (no test-only path in the product).
- **Ask Claude** (option B): the click copies the PNG to the clipboard, keeps the image (one,
  `mochi.imageScan.pending`) + the question in the pocket, focuses / opens claude.ai; Mochi there
  offers "Paste the image and question?" and pastes both (synthetic paste with a DataTransfer).
  Never Enter. Fails → "press Ctrl+V".

## Tasks

- [x] **0. Plan** — this file, branch.
- [x] **1a. Vendor** — Tesseract worker/core/traineddata + 20 fonts into `src/vendor/`, licenses,
      `dev/vendor.sh`, size noted; build-zip + smoke copy include them.
- [ ] **1b. Background + offscreen** — `contextMenus` + `offscreen` permissions, the menu item,
      capture op (rate limit, tiles), offscreen lifecycle, crop + stitch, progress relay, cancel.
- [ ] **1c. Page side** — `src/image-scan/target.js`: what was right-clicked (img / picture /
      srcset / background-image / svg / canvas), scroll into view, tiles for tall images (max 6,
      else "visible part only"), hide Mochi + UI while capturing, direct-read fallback, the
      "click an image" mode when no image is known.
- [ ] **1d. Hover magnifier** — button on images ≥ 120×120 while Mochi is visible; settings toggle
      (off by default on claude.ai).
- [ ] **2. Palette** — `colors.js` + `palette.js` (k-means in Lab, 5–8 colors, hex/RGB/HSL/%/name/role,
      light/dark, warm/cool, saturation, gradient direction), unit tests.
- [ ] **3. OCR** — Tesseract in the offscreen doc (eng+rus, lines + word boxes, confidence, language,
      "No text found"), cancel = terminate.
- [ ] **4. Font style** — category, weight, width, case, spacing, color, size; "looks similar to"
      (render with the bundled fonts, compare masks), top 3 + scores.
- [ ] **5a. On-device description** — Prompt API (availability, schema JSON, consent + download page).
- [ ] **5b. Ask Claude** — clipboard PNG, pending image, open/focus claude.ai, offer + paste, Ctrl+V fallback.
- [ ] **6. Prompts** — `prompt.js`: universal, Midjourney, SD/SDXL (+ negative), DALL·E/GPT-image/Imagen,
      alt text; unit tests.
- [ ] **7a. Result card** — panel view, light/dark, Mochi reactions ("I can read it!"), copy buttons,
      CSS variables / Tailwind, OCR boxes on the preview, font disclaimer, prompt tabs, save to pocket
      with thumbnail; locales (11 languages).
- [ ] **7b. Fixtures** — `test/image-scan/` generated images (poster SUMMER SALE in Oswald, Russian
      text in Lora, flat illustration, gradient, cross-origin from a 2nd port, tall image, CSS
      background) + the generator script.
- [ ] **7c. Smoke group `imagescan`** — palette ΔE, OCR text, fonts top-3, aspect ratio, prompts carry
      hex + text, no Mochi in the pixels, no network requests, mocked LanguageModel.
- [ ] **8. Finish** — full verification (all smoke groups), README, version 1.28.0 + release notes,
      zip size, summary here, PR.

## Notes for the next session

- **1a** — `dev/vendor.sh` fetched tesseract.js 7.0.0 (worker + API), core 6.1.2 (only the SIMD-LSTM build: every Chrome with MV3 has WASM SIMD), tessdata_fast eng/rus gzipped (2.0 + 1.6 MB), 20 fonts (37 woff2, 1.2 MB). `src/image-scan/fonts.js` = the catalog (category, weight range, Cyrillic or not). `src/vendor/README.md` lists the licenses. `test/vendor.test.js` checks every file exists, no CDN URLs in src/, size < 15 MB. Checked in Chromium from a local server: `createWorker(['eng','rus'], 1, { workerPath, corePath: '…/tesseract-core-simd-lstm.js', langPath: '…/lang', workerBlobURL: false, cacheMethod: 'none' })` reads 'SUMMER SALE' + 'Привет мир' in 0.4 s with 95 % confidence and no outside requests. **Size: unpacked 9.2 MB, zip 6.4 MB** (was 0.4 MB). vendor/ lives under src/, so build-zip and the smoke test's extension copy include it already.

## Questions for Inna

(none yet)
