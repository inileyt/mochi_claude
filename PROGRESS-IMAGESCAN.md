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
- [x] **1b. Background + offscreen** — `contextMenus` + `offscreen` permissions, the menu item,
      capture op (rate limit, tiles), offscreen lifecycle, crop + stitch, progress relay, cancel.
- [x] **1c. Page side** — `src/image-scan/target.js`: what was right-clicked (img / picture /
      srcset / background-image / svg / canvas), scroll into view, tiles for tall images (max 6,
      else "visible part only"), hide Mochi + UI while capturing, direct-read fallback, the
      "click an image" mode when no image is known.
- [x] **1d. Hover magnifier** — button on images ≥ 120×120 while Mochi is visible; settings toggle
      (off by default on claude.ai).
- [x] **2. Palette** — `colors.js` + `palette.js` (k-means in Lab, 5–8 colors, hex/RGB/HSL/%/name/role,
      light/dark, warm/cool, saturation, gradient direction), unit tests.
- [x] **3. OCR** — Tesseract in the offscreen doc (eng+rus, lines + word boxes, confidence, language,
      "No text found"), cancel = terminate.
- [x] **4. Font style** — category, weight, width, case, spacing, color, size; "looks similar to"
      (render with the bundled fonts, compare masks), top 3 + scores.
- [x] **5a. On-device description** — Prompt API (availability, schema JSON, consent + download page).
- [ ] **5b. Ask Claude** — clipboard PNG, pending image, open/focus claude.ai, offer + paste, Ctrl+V fallback.
- [x] **6. Prompts** — `prompt.js`: universal, Midjourney, SD/SDXL (+ negative), DALL·E/GPT-image/Imagen,
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
- **1b** — `src/image-scan/background.js` (importScripts from background.js; `Mochi.imageScanFiles = FILES` for injecting): context menu `mochi-image-scan` for `contexts: ['image']`, title in the 11 languages (follows the language setting); click → ensure Mochi (injects FILES if absent, shows it if hidden) → frame offset if the image is in an iframe → `Mochi.imageScan.fromMenu({ srcUrl, frame })` in the page (waits up to 6 s for `Mochi.imageScan.ready`). Ops (`{type:'mochi-image', op}` from a tab): begin → job id (warms up the offscreen doc), shot {job, crop, dest, viewport} (captureVisibleTab PNG, ≥ 560 ms apart, one retry on the quota error), analyze {job, size, direct?, options} → offscreen, describe, aiStatus, cancel, end. Offscreen `pages/image-scan.html` + `.js`: stitch (scale = screenshot px / viewport CSS px, max side 2400), returns image (PNG ≤ 1600) + thumb (JPEG 240) + steps palette / text / font (each guarded, errors per step in `result.errors`), progress messages relayed by the background to the tab, cancel set, closes itself after 3 idle min (asks the background). Race fixed: right after createDocument the listener may not be there yet → toOffscreen retries 'Receiving end does not exist' for 3 s. Checked with a scratch script (extension copy with <all_urls>): begin → shot → analyze of a 300×200 gradient box gives 300×200 + thumb; menu item exists. verify ok, smoke base 12/12. `Mochi.imageScanBg.ops` is exposed for tests.
- **1c** — `src/image-scan/target.js` (resolve: img / picture / svg (any child → its svg) / canvas / video poster / CSS background, else the biggest image inside a wrapper under the pointer, up to 5 parents; fromSrc: the right-clicked element first (recorded on `contextmenu`), else document.images by currentSrc/src/srcset; capture: scrollIntoView, tiles by window scrolling for up to 6 viewport-sized parts (else the visible part + `partial`), hides Mochi (host visibility) for each shot, restores the scroll; direct: same-origin/blob img, clean canvas, inline SVG → PNG in the page; tainted → null). `src/image-scan/scan.js` = the feature: progress panel (capture/crop/palette/text/font) + Cancel, errors explained (no-access → 'right-click → Scan image with Mochi'), Tools menu item 'Scan an image' (picker → click an image), `fromMenu`, images in iframes (frame offset by matching the iframe src), result → `Mochi.imageCard.show` (7a) or a plain thumbnail for now. Debug hooks: `imageScan {selector | src, menu}` (summary without the big images), `imageScanImage` (the PNG), `imageScanCancel`. Checked (scratch page `tests/.out/img1.html`, not committed): canvas, img, background, svg each ~2.2 s; a 300×1800 image in 3 tiles stitched without seams (scale fix: screenshot px / innerWidth, not clientWidth). Without screenshot access (simulated): canvas + data: image read directly, CSS background → the no-access message. **Note:** without host access the toolbar can't inject Mochi in tests either, so the claude.ai direct path must be tested through the UI (debug hooks are localhost-only).
- **1d** — `src/image-scan/hover.js`: settings `imageScan.claude` (false) / `imageScan.web` (true), one label 'settings.imgHover' shown per site (like explore). pointerover (capture, passive; no touch) → resolve → ≥ 120×120 → a 32 px accent button ⌕ in Mochi's shadow root at the image's top-right; hides 250 ms after the pointer leaves the image (the button counts as inside); follows scroll; not while a scan runs (`Mochi.imageScan.busy`). Click → scan with source 'hover'. CSS in styles.js ('Image Scan: the magnifier'). Hook `imageHover(selector)` → the button's position or null. Checked with a real mouse: button at the expected corner, click → scan done (PNG). Smoke base 12/12.
- **2** — `colors.js` (`Mochi.imageColor`: sRGB↔Lab with a cache, CIEDE2000, HSL, LCh, WCAG contrast, 130 color names, nearest by ΔE) and `palette.js` (`Mochi.palette.extract(imageData)`: ≤ 16 000 samples, k-means++ in Lab with a fixed seed (deterministic), k = 8, clusters merged under ΔE 7, < 0.8 % dropped → **up to 8 colors, fewer when the image has fewer** (a 4-color poster gives 4, not 5 invented ones); a cluster that is ≥ 30 % one exact color reports that exact color (flat art is exact); roles background (owns ≥ 45 % of a 4 % border) / dominant / text (≤ 25 %, contrast ≥ 3 with bg) / accent (most chroma ≥ 25) / secondary; overall tone / temperature (LCh hue, chroma-weighted) / saturation; gradient = 16×16 grid, per-channel plane fit, R² ≥ 0.9 and ΔE ≥ 15 between ends → CSS angle, nearest 'to …' direction, from/to hex, css. `asCss` / `asTailwind` for the copy buttons). Works in Node too (module.exports). `test/palette.test.js`: ΔE2000 reference pair, Lab round trips, names (navy, dusty rose, deep navy), a 4-color poster with anti-aliasing (each color ΔE < 2, roles), 3 gradient directions, warm/cool/low saturation, determinism. In the browser: canvas → exact #ff0000 + #ffffff, svg → #3355ff + #ffcc00.
- **3** — `src/image-scan/ocr.js` (offscreen only; `Mochi.imageOcr.read(canvas)`): one Tesseract worker (eng+rus, OEM 1 LSTM, files from chrome.runtime.getURL, workerBlobURL false, cacheMethod 'none'), started lazily, 20 s start timeout, 40 s per pass; images upscaled so the long side is ≥ 900 px (and ×2 when < 220 px tall); PSM 3, then PSM 11 (sparse) when nothing was found; words kept when conf ≥ 55 and mostly letters/digits, lines when mean ≥ 60 and ≥ 2 chars → { found, text, confidence, language en/ru/en+ru, lines[words + bbox], blocks }, bboxes in the analysed image's pixels. cancel() terminates the worker. **Needed `content_security_policy.extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"`** (MV3 blocks WebAssembly otherwise; no install warning) — README must mention it. **Perf fix:** in the hidden offscreen page, convertToBlob + FileReader are throttled to ~1 s each → encode with a DOM canvas + toDataURL (crop step 2015 ms → 8 ms). Results (scratch page): 'HELLO' 96 %, 'Привет, мир!\\nЛетняя распродажа' 96 % ru, light-on-dark 'SALE 50%' 96 %, red box / svg / gradient → found false. A scan with text ≈ 1.4–2.3 s in total.
- **4** — `src/image-scan/fontstyle.js` (offscreen; `Mochi.fontStyle.analyze(imageData, ocr, { scale })`): the 3 biggest blocks; per block its clearest word (≥ 2 letters, conf ≥ 75 first, tallest) **rendered exactly as OCR read it** (its box holds its punctuation); ink/background by 2-means in Lab (bg seeds from the box border) → soft mask + text color (pixels ≥ 85 % ink); 20 fonts loaded once as FontFace (latin/cyrillic unicode ranges), Cyrillic words skip Latin-only fonts; each font at up to 4 weights, letter spacing fitted so the render's aspect = the word's, masks compared at 32 px high (area resample, soft IoU Σmin/Σmax). Weight: stroke ratio (2·area/perimeter/height) vs renders of the best font (Inter for one-weight fonts); width: matched font's natural aspect vs Inter 400 (< 0.84 condensed, > 1.2 wide); spacing em from the fit (< −0.015 tight, > 0.07 wide); case from the text; size = cap height % of the image + ≈ CSS px. Results (scratch canvases): Oswald 700 'SUMMER SALE' → Oswald 97 % bold condensed all caps; Lora 'Летняя распродажа' → Lora 84 % regular; Pacifico → 94 %; Space Mono 'console.log' → Space Mono 81 % (after the punctuation fix; was 26 %); DejaVu bold (not bundled) → Rubik/Montserrat 75–77 %. Font step 70–170 ms.
- **5a** — `src/image-scan/ai.js` (offscreen; `Mochi.imageAi`): status() = LanguageModel.availability({ expectedInputs: text en + image, expectedOutputs: text en }), no API → 'unavailable' quietly; describe(canvas) only when 'available' (never starts a download), ImageBitmap ≤ 1024 px as an image part, responseConstraint = JSON schema (subject, objects, setting, style, lighting, mood, composition, camera, caption), 90 s timeout, answer normalized (code fences, lengths, ≤ 12 objects), session destroyed. Background ops: `describe` (by job: the offscreen page keeps the last 4 canvases), `aiStatus`, `openAiModel` (popup window `pages/ai-model.html`; remembers which tabs asked). `pages/ai-model.html/js`: explains the model (from Chrome, not Mochi; a few GB once), **Download** → LanguageModel.create with a downloadprogress bar (needs that click); when ready → `mochi-image-ai-ready` relayed to the tabs that asked. `test/image-ai.test.js` (fake LanguageModel: unavailable / available + schema + image part / downloadable never auto-downloads / bad answer). In Chromium: real status 'unavailable' (headless); a fake planted in the offscreen page through CDP (`Target.attachToTarget` + `sendMessageToTarget` on a page session: no debugging port needed) → describe returns its JSON. **Locale keys `ai.*` / `img.*` are added in 7a.**
- **6** — `src/image-scan/prompt.js` (content script + Node; `Mochi.imagePrompt.build(result)` → aspect (snaps to 15 common ratios within 3.5 %, else the closest fraction ≤ 32), universal paragraph, midjourney (`--ar`, `--style raw` for photos, `--stylize` 50 flat / 100 photo / 250 else, `--no` watermark…, + 'text, letters' when the image has none), sd { prompt tags, negative, size ≈ 1 MP in multiples of 64 }, dalle sentences ('Do not add any text.' when none), alt (the caption, else the page's alt, else style + text + 2 color names). Without a description: style guessed (gradient / flat graphic design (with text) / flat vector illustration / photographic image), subject = page alt or none ('built around a headline'). Every prompt has the palette hex codes and the text in quotes with the font phrase ('bold condensed all-caps display sans-serif type, similar to Oswald'). `question(result, lang)` = the Ask-Claude question (describe + the 4 prompt formats + alt + what Mochi measured; 'Please answer in <language>' when the UI isn't English). Prompts stay English. `test/image-prompt.test.js`.

## Questions for Inna

(none yet)
