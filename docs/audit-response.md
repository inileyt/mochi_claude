# Mochi — audit response & change report

Work done in response to the external audit. Mochi was **grown, not rewritten**: every
existing feature still works, nothing was removed, Firebase was kept, and no servers,
paid services or creator API keys were added. Each change is its own pull request with
its own tests; the owner deploys the Firestore rules.

---

## 1. Preserved (unchanged, still working)

- The whole companion: characters, wardrobe, moods, levels/XP/streak, seasonal bits.
- All tools: Live Edit, Guides, design taste, notes, colour picker, font inspector,
  bug report, Copy-for-Figma, image scan (on-device Chrome AI), the scanners.
- Online friends on Firebase (anonymous auth, codes, REST client, `mustNotExist`).
- Security posture that the audit called out as good: `debugger-proxy.js` allow-list,
  `deep-scan/safety.js`, "Ask Claude" paste flow, `textContent` message rendering.

Nothing was deleted and no feature changed behaviour for the user, except where this
report says "improved".

## 2. Improved

| Area | Before | After |
|---|---|---|
| **Firebase reads** (open chat) | re-read up to 40 message docs every 5 s → ~28,800/h | reads the friendship doc (1) and only *new* messages; backs off 5→15→30 s; **stops while the tab is hidden** → ~120–720/h (**≈40–240× fewer**) |
| **Firebase reads** (friends) | a profile per friend every 45 s | profile cards cached ~10 min |
| **Firestore rules** | timestamps client-set; friendship update loosely checked | `at`/`last.at` must equal `request.time`; `seen`/`bonusDay`/`last` validated; a changed `last` must be from the writer |
| **Deep Scan — canvas** | a yes/no "animated" from two screenshots | 10 frames diffed → *where* it moves, how much, loop period (`evidence: measured`) |
| **Deep Scan — libraries** | guessed from script file names | real versions read from the page's globals (GSAP, Three.js, Lottie, …) |
| **Friend requests** | showed the name/look the sender typed | shows the sender's real card from `users/{from}` |

## 3. Added

- **Deep Scan › source files** (own site): `source.css`, `source.html` and the real
  font files under `fonts/` ship in the zip, so an AI rebuild uses the real code and
  typeface, not a reconstruction. For sites that aren't yours, only metadata ships.
- **Deep Scan › pointer-reactive motion**: a synthetic cursor (a real `mouseMoved`,
  never a click) measures magnetic / follower / tilt / proximity effects — motion that
  lives in JavaScript, not in the CSS.
- **Deep Scan › canvas/WebGL motion** and **library versions** (see above).
- **"New code" button**: mint a fresh Mochi code and drop the old one — escape a
  spammer without losing existing friends.
- **Dev read accounting**: `OnlineApi.reads()` + an off-by-default `ONLINE_DEBUG` log.

## 4. Removed

Nothing. No feature, permission, or dependency was removed. (The `evidence` taxonomy
`measured | inferred | unknown` was *added* to Deep Scan output, replacing a vaguer
"approximate" label in the new paths.)

## 5. Security

- **No new permissions**, no new network dependency — still the same Firebase REST.
- The debugger proxy stays the single CDP gate. It still refuses `Runtime.evaluate`
  (no page code runs); it now also allows `Input.dispatchMouseEvent` **only** with
  `type: 'mouseMoved'` — any press/click is refused, enforced like the Escape-only
  key rule.
- Library versions are read in the page's MAIN world through a **fixed, static reader**
  (`chrome.scripting.executeScript`), reading only known version properties — no
  page-supplied code runs.
- Firestore rules: server-set timestamps (no backdating/forging), friendship-update
  validation, and the UI shows a request's **real** sender (anti-spoofing).
- Raw page source and font files ship **only for the owner's own site**, gated the
  same way as screenshots/placeholders.

## 6. Performance

- The chat read-cost fix is the big one (above). Hidden tabs now do **zero** reads.
- Deep Scan's new phases are bounded: pointer probes ≤ 8 elements; canvas capture is
  10 downscaled frames; the library probe is one MAIN-world call with a 4 s timeout.

## 7. Size

| | Measured |
|---|---|
| **Packed zip** (what the Chrome Web Store receives) | **~16 MB** |
| **Unpacked** (installed on disk) | **~20 MB** |
| of which OCR language data (10 languages, gzipped) | ~12 MB |

The Chrome Web Store package limit is **2 GB**, so Mochi is at ~0.8 % of the limit —
**size is not a blocker** (the audit's "15 MB limit" was incorrect). Trimming the 7
non-default OCR languages to on-demand packs (Phase B) remains an *optional* cleanup,
not a requirement.

## 8. Dependencies

- **No new runtime dependency.** Firebase REST is unchanged; nothing new is fetched at
  runtime.
- **Dev-only:** the Firebase Emulator (via `firebase-tools`, Java) runs the rules tests
  locally and free — not shipped.

## 9. Limitations (honest)

Things that rules or a scan cannot express, documented in `online/firestore.rules` and
Deep Scan output:

- **Write rate** isn't limited (XP is capped at +20 per write, but not the number of
  writes). A budget alert / App Check is the real guard. *(R4)*
- A look's **outfit ids** are size-capped (≤ 4) but not type-checked one by one —
  Firestore rules can't iterate a list. *(R6)*
- Looking up a code still costs a read on a miss, so brute-forcing codes burns quota;
  anonymous-auth sign-up quota + a budget alert bound it. *(R8)*
- Deep Scan still cannot read what's **inside** canvases/videos/iframes, backend logic,
  logged-in content, or the exact curves of minified JS motion (described from samples).

## 10. Estimated operating cost

- **Firebase Spark (free) tier**: 50,000 document reads/day for the whole project.
- Before Phase A, a single chat left open could approach that in a couple of hours.
  After Phase A (incremental chat + hidden-tab stop + profile cache), realistic use —
  a few friends, chat open intermittently — stays comfortably inside the free tier.
- No paid service is required for the current feature set.

---

## Pull requests

| PR | Title | Tests |
|---|---|---|
| #23 | 1.42.0 font files in the Deep Scan zip | deepscan 25/0 |
| #24 | Firebase read-cost (incremental chat + caching) | smoke 23/0 |
| #25 | Firestore rules hardening (R2 + R3) | emulator 14/14 |
| #26 | Deep Scan intelligence: pointer + canvas + libraries | deepscan 27/0 |
| #27 | Real sender card on requests + rotate your code (R5 + R7a) | emulator 14/14 |

Backup tags before each phase: `backup/pre-phase-a`, `backup/pre-phase-e`.

## Deferred (need a decision)

- **Phase F — AI Adapter** (BYOK cloud / local Ollama): adds network hosts and API-key
  handling → needs the owner's explicit go-ahead on the network dependency.
- **R7b — "pause friend requests"**: needs a rules change (`paused` flag), so it belongs
  with the rules PR, not a client-only change.
- **Phase B — on-demand OCR language packs**: optional (size is not a blocker); needs a
  jsDelivr network dependency.
- **Phase A #5 — one shared background poller**: judged low value now that hidden tabs
  already stop polling; held back against the refactor risk.
