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
- [ ] **L1. Live Edit core** — CSS sanitizer + code-block extraction (unit tests), the request builder,
      `src/tools/live-edit.js` (pick / whole page, the request card, chips), paintbrush sprite.
- [ ] **L2. The round trip** — pocket "ask" entry → claude.ai paste offer; watching the answer; result to the
      original tab (background focuses it); apply + card (before/after, edit, tweak, undo, copy).
- [ ] **L3. Keep it** — kept edits per site/page, applied when Mochi is there; optional permission page +
      registered `document_start` applier; manage/delete list.
- [ ] **G1. Guide parsing** — steps + targets + start URL from an answer (unit tests); the offer on claude.ai,
      the "ask Claude for a guide" prompt.
- [ ] **G2. Playing a guide** — target finder (text / accessible name, scoring), Mochi walks + points,
      outline, step card, auto-advance (click / navigation / next target), state across page loads.
- [ ] **G3. Record + share** — recording clicks/fields (no values), export/import `.mochi-guide.json`.
- [ ] **T1. Taste** — events from the existing tools, profile math (unit tests), the panel + brief + TASTE.md,
      beret, settings (collect on/off, forget).
- [ ] **F. Finish 1.30** — fixtures (`test/next/`), smoke group `next`, README (+ GIFs), 11 languages,
      version 1.30.0, full verification, PR.

## Tasks — 1.31.0 (after)

- [ ] **B1. Bug Reporter** — recording, console + network errors via the debugger proxy, screenshots, report.
- [ ] **S1. Element → SVG for Figma** — SVG builder, clipboard, fixtures + tests.
- [ ] **F2. Finish 1.31** — README, version, full verification, PR.

## Notes for the next session

## Questions for Inna

(none yet)
