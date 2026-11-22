# PROGRESS — Deep Scan (branch `feature/deep-scan`)

Work protocol: one subtask at a time → verify → tick here with notes → commit → push.
A new session: read this file, `git status`, `git log --oneline -15`, continue at the first unchecked box.

## Current state

- Branch `feature/deep-scan` from `main` @ 4306c5f (Mochi 1.26.0, PR #2 merged) + the Gemini fix 9b79cf5 cherry-picked (it was pushed after PR #2 was merged, so `main` doesn't have it yet; it arrives with this branch's PR).
- Next: 2.2.

## Questions for Inna

(none yet)

## Design (decisions for whoever continues)

- **Quick scan stays as it is** (`src/ui-scan.js`, `src/scan-export.js`, menu "Scan this UI"). Deep Scan is a second item, "Deep scan (rebuild spec)".
- **Where the code runs.** The deep-scan modules are content scripts in `src/deep-scan/` (listed in manifest, background `FILES` and the three test pages, like every other file). They only define functions at load; nothing runs until you start a scan. The content script orchestrates the scan and the UI; Chrome DevTools Protocol calls go through a small proxy in the background worker (`src/debugger-proxy.js`): attach/detach to the sender's own tab only, an allowlist of CDP methods, events forwarded to that tab, and detach on finish, cancel, error, tab close, navigation away and worker idle.
- **Structure is read in the page** (computed styles + boxes of live elements): the same data `DOMSnapshot.captureSnapshot` gives, but with live element references, which the interaction, scroll and motion phases need. In deep mode `DOMSnapshot.captureSnapshot` is still taken once (with paint order) to get the stacking/paint order and the true node count; CDP is used for what a page can't do itself: forced pseudo states, cross-origin stylesheets (`@media`, `@keyframes`, `@font-face`), viewport emulation, screenshots, the Animation domain and navigation blocking.
- **Permission.** `optional_permissions: ["debugger"]`. Content scripts can't call `chrome.permissions.request`, so Mochi's in-page explainer opens a small extension window (`pages/deep-permission.html`) whose "Allow" button asks Chrome. Headless tests use a copy with `debugger` granted (Chrome's prompt can't be answered headlessly), like the ChatGPT/Gemini tests.
- **Placeholders** (default): text → `[text: 42 chars, 2 lines, h2]`-style placeholders keeping font/size/role; images → `[image 640×360, cover, r12]`; logos/brand names → `Brand`. Screenshots are redacted after capture (text lines and images painted over as boxes on a canvas), so the page itself is never changed for it. The "my own site" box keeps everything, off by default and reset for every scan.
- **Safety** (`src/deep-scan/safety.js`): capture-phase `click`/`submit`/`auxclick` blockers on links, forms and denylisted buttons (EN + RU words and attributes), CDP `Fetch` interception that fails main-frame document requests and `Page.frameRequestedNavigation` checks; only "safe" controls are ever clicked; every opened thing is closed again and the state compared; scroll restored.
- **Output**: `rebuild-spec-<site>-<date>.zip` (STORE-only zip writer, `src/deep-scan/zip.js`, CRC32 in JS) with PROMPT.md, SPEC.md, spec.json (+ schema in `docs/rebuild-spec.schema.md`), tokens.css, tailwind.config.js, screenshots/.

## Checklist

### 0. Setup and foundations
- [x] 0.1 Branch, read the codebase, this file.
- [x] 0.2 STORE zip writer + CRC32 (`src/deep-scan/zip.js`) with a unit test that unzips with the system `unzip`.
- [x] 0.3 Debugger proxy in the background (attach/send/detach, allowlist, events to the tab, detach on cancel/error/tab close) + content-side CDP client; `optional_permissions: ["debugger"]`.
- [x] 0.4 Deep scan entry: menu item, the explainer screen, `pages/deep-permission.html`, the progress panel (working Mochi, bar, step, Cancel), the "my own site" checkbox, a `deepScan` debug hook.
- [x] 0.5 Safety guard (navigation/submit blockers, CDP Fetch + Page navigation interception, destructive-control denylist EN/RU) + fixture page skeleton `test/deep-scan/landing.html` + smoke group `deepscan` (permission copy, attach/detach, Cancel detaches, no navigation, form not submitted).

### 1. Structure map
- [x] 1.1 Fixtures with documented values (`test/deep-scan/landing.html` complete: sticky shrinking header, 2-col hero, 3-col cards with hover lift, tabs, dropdown, accordion, modal, burger at 390, @keyframes, rAF, IO reveal + stagger, parallax, snap carousel, canvas, form) + `test/deep-scan/EXPECTED.md`.
- [x] 1.2 Node collector (≤ 5000 nodes, time budget, chunked) + region detection (landmarks, then bands/heuristics) + region tree with layout systems and positioning + repeated patterns + outline in reading order.

### 2. Geometry and responsive
- [x] 2.1 Box model per region/component (absolute + relative sizes, padding/margin/gap, max-width containers, aspect ratio, radius, content column alignment).
- [ ] 2.2 Captures at 1440/1024/768/390 via `Emulation.setDeviceMetricsOverride` (restored after), diffs per width, breakpoints from `@media` via the CSS domain.

### 3. Tokens and components
- [ ] 3.1 Tokens: colors by role, type scale, fonts + `@font-face` sources (names/formats) + free-font suggestion, spacing, radius, shadows, borders, gradients, backdrop-filter, opacity.
- [ ] 3.2 Components: style diffed against browser defaults, tokens used, icons (size, stroke/fill, placement) as placeholders.

### 4. Interaction states
- [ ] 4.1 Hover/focus/active/focus-visible via `CSS.forcePseudoState`: style diffs, transitions, cropped screenshots (default + hover), deduplicated by component.
- [ ] 4.2 Safe click states (aria-expanded/controls/haspopup, tabs, details/summary, accordions, burger, carousel arrows, dialog triggers): before/after, how it appears/animates/closes, restore check; page states list with screenshots (incl. mobile nav at 390).

### 5. Motion
- [ ] 5.1 CSS animations/transitions: Animation domain events + `getAnimations()`, `@keyframes` text, timing.
- [ ] 5.2 JS motion: per-frame sampling after load and during interactions/scroll, fitted descriptions; library detection; reduced-motion support detection.

### 6. Scroll
- [ ] 6.1 Stepped scroll (20 % viewport): entered elements, class/style changes, reveal thresholds + stagger, sticky/fixed changes (header shrink), back to top.
- [ ] 6.2 Parallax ratios, scroll-snap, smooth scroll, `animation-timeline`, lazy/infinite content, progress/counters; full-page + section screenshots; the scroll timeline text.

### 7. Media and approximations
- [ ] 7.1 Images/video (size, fit, radius, overlays, role) as placeholders; canvas/WebGL/Lottie/video bg/iframes/widgets described and marked approximate; the honest "not captured" list.

### 8. Output
- [ ] 8.1 `spec.json` (documented schema) + `SPEC.md`.
- [ ] 8.2 `PROMPT.md` (stack, section by section, states, motion, scroll, responsive, visual compare, placeholders, acceptance criteria) + `tokens.css` + `tailwind.config.js` + screenshot redaction + the zip download + the short "paste" version in the pocket.
- [ ] 8.3 Results panel: outline, tokens preview, components, states gallery, motion/scroll timeline, approximate warnings.

### 9. Tests and finish
- [ ] 9.1 Smoke assertions on the full spec with tolerances (regions, grid columns, breakpoints, hover diff + transition, open/close states, keyframes, rAF description, reveal threshold + stagger, parallax ratio, canvas approximate, form never submitted, no navigation, debugger detached) + the old features.
- [ ] 9.2 README (what, why `debugger` and the bar, nothing leaves the browser, placeholders + "my own site", limits, responsible use), version 1.27.0, release notes, final summary, PR.

## Notes per subtask

- 0.1: Branch from main @ 4306c5f; read `ui-scan.js`, `scan-export.js`, `panel.js`, `pocket.js`, `picker.js`, `content.js`, `menu.js`, `background.js`, the smoke harness. Plan above.
- 0.2: `src/deep-scan/zip.js` (`Mochi.zip.build/read/crc32`): local headers + central directory + end record, UTF-8 names (flag 0x0800), DOS date/time, duplicate names dropped. Not yet in the content-script lists (added with the orchestrator in 0.4). `test/zip.test.js`: CRC32 check value, round trip (UTF-8 text, binary, folder names), and `unzip -t` + extract when the system has `unzip`.
- 0.3: `src/debugger-proxy.js` (background, `importScripts`): `{type:'mochi-cdp', op}` messages, sender's tab only; ops status/attach/send/detach/blocked/askPermission. Allowlist of CDP methods (no Runtime.evaluate, no Network, no cookies); on attach: Page.enable + `Fetch.enable` for Document requests → main-frame document requests are failed (navigation blocked), recorded and reported as `Mochi.navigationBlocked`; JS dialogs dismissed. Detach on done/cancel/error, `tabs.onRemoved`, `tabs.onUpdated` with a new URL, Chrome's own "Cancel" on the bar (`onDetach` → `Mochi.detached` event), and a 4-minute limit. `src/deep-scan/cdp.js`: `Mochi.cdp.status/attach/send/detach/on/askPermission`. `optional_permissions: ["debugger"]`. content.js: local test hooks now also write what they return to `<html data-mochi-result-<key>>` (tests read it). Smoke group `deepscan` (copy with `debugger` + host access; Mochi brought in by the toolbar): attach → allowed command ✓ → Runtime.evaluate refused → detach; closing the tab drops the session; without the permission → `no-permission`. Note: `chrome.debugger.getTargets()` counts Playwright's own connection, so tests ask the proxy's `sessions`.
- 0.4: `src/deep-scan/deep-scan.js` = conductor + panel. `Mochi.deepScan.addPhase({ id, order, label, budget, weight, cdp, run(scan) })`; `run()` attaches only if a phase needs CDP, runs phases in order with a time budget each (over budget → listed in `spec.source.partial` + a note), `scan.check()` throws `Cancelled`, `scan.progress(f)`, `scan.breathe()`; `finally`: cleanup hooks (`Mochi.deepScan.cleanup`), Mochi visible again, blocked navigations read, debugger detached. Panel views: explainer (what it captures, why the permission / the Chrome bar, nothing leaves, the "my own site" checkbox — off, a fresh checkbox every time) → (no permission: `askPermission` opens `pages/deep-permission.html` in a small window; the panel polls `status` and starts when granted) → progress (step, bar, %, Cancel) → results (`src/deep-scan/output.js`: `D.writers` → files, zip download, `D.views` sections). Menu → Mochi → "Deep scan (rebuild spec)". 57 texts × 11 languages. Test hooks `deepScan {ownSite, only, cancelAfter}` (returns the spec), `deepZip` (base64 of the zip), `deepIntro`. `dev/verify.sh` also checks files referenced from `pages/*.html`. Smoke `deepscan` 7/7 (+ explainer/checkbox reset, permission window opens without the permission).
- 0.5: `src/deep-scan/safety.js`: `isSafeToClick(el)` (only controls that open/close/switch: no links except in-page `#` with aria-controls/tab, no form fields, no submit buttons or anything inside a form, no `download`, and a denylist regex over text + aria-label/title/name/value/id/class/href/action/data-* in English and Russian: buy/pay/order/cart/subscribe/delete/remove/send/submit/post/share/confirm/log out/sign up/log in/download… купить/оплат/заказ/корзин/удали/отправ/подтверд/выйти/зарегистр/войти/скачать…). Guard while scanning: capture-phase click/auxclick on links → preventDefault, submit → preventDefault (counted); the proxy's Fetch interception blocks main-frame navigations. Phase `prepare` (order 0, always): guard on, remembers the scroll, waits for fonts, scrolls to top. Cleanup restores the scroll — re-applied at 50/350/800 ms because a sticky header with a height transition makes scroll anchoring nudge the page. `spec.safety` = blocked clicks/submits/navigations. The fixture `test/deep-scan/landing.html` is written in full already (`?navtest` makes the page itself try `requestSubmit()` + `location.assign()` 2 s after load). The smoke server now records every request (`serverHits`). Smoke `deepscan` 10/10: what may be clicked (7 safe controls; links, submit, input and 4 risky EN/RU buttons refused); during a scan the page's own navigation and form submit are blocked, nothing reached the server, debugger detached; Cancel → detached, scroll back to where it was. Base 12/12.
- 1.1: `test/deep-scan/landing.html` (all Task 9 elements, plain CSS/JS, offline) + `test/deep-scan/EXPECTED.md` (every value with its tolerance). Checked in Chromium at 1440 and 390: header 72 → 56px after scrolling, hero columns 644/460px at 1440 (1 column at 390), cards 3 → 1 columns, burger only at 390, no page errors.
- 1.2: `src/deep-scan/structure.js` (phase `structure`, order 10). Collector: document order from `<body>`, skips Mochi and script/style/etc., `display:none` skipped (except dialogs and hidden elements with an id: menus/drawers), ≤ 5000 elements, yields every 12 ms; per node: tag, stable classes (state classes like `is-*`, `active` dropped), role, document-coordinate box, a set of computed properties, own text *length* only. `DOMSnapshot.captureSnapshot` gives the true DOM node count. Regions: body/main children, unwrapping wrappers; landmarks + full-width bands ≥ 32px; closed dialogs/drawers → `overlay`, small fixed things → `floating` (listed after the flow). Layout root = first grid/flex descendant (≤ 4 levels) with ≥ 2 children spanning ≥ half the region; grid columns fitted to fr ratios (644/460 → `7fr 5fr`). Positioning only when it matters (sticky/fixed/absolute, relative with offsets/z-index). Container = centred `max-width` descendant. Repeated patterns: siblings with the same tag + child-tag shape (≥ 3, or 2 buttons), similar widths or in a grid; named from a shared class (Card, Slide), else Logo/Button/Tab/NavItem/Card/Item; variants = differing class sets; page bands excluded. Region names: Header/Footer/Navigation…, Hero (first section with h1), else the developer's id/class word when meaningful (Features, Logos…) with a type (tabs, form, canvas, carousel, band…). `scan.regions`/`scan.components`/`scan.nodes` keep live elements for later phases. Fixture outline: "Header (sticky, 72px, row) → Hero (2-col grid 7/5) → Logos (logos strip, 106px, row of Logo ×5) → Features (3-col grid of Card ×6) → Parallax (band) → Learn (tabs) → Carousel wrap (carousel, row of Slide ×6) → Playground (canvas) → Signup (form, row) → Footer (271px, 4-col grid, Item ×3). Also: Navigation drawer (hidden until opened), Floating button (fixed), Modal dialog (hidden until opened)." Smoke check asserts the order, sticky header (72px, z 50), 7fr/5fr, 3/4 columns, container 1200px, Card ×6 / Logo ×5 / Slide ×6, the 3 extras and the outline.
- 2.1: `src/deep-scan/geometry.js` (phase `geometry`, order 20, no CDP). `boxOf(el)`: w/h px, % of parent, vw/vh, padding/margin (shortened like CSS), gap, max-width, min-height, aspect ratio (CSS value, or simplified for media: 560×420 → 4:3), radius, border, object-fit/position. Regions get `geometry` (+ `layoutGeometry` of their grid/flex root); components get `geometry` + measured `spacingBetween` + their media box. `spec.geometry.contentColumn`: the most used centred max-width container (fixture: 1200px, 24px side padding, 1152px content). Smoke: card 368×180, r12, p24, gap 24, border 1px #e6e6ef; hero padding 96px 0 + gap 48px.
