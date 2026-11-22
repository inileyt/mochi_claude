# Deep Scan fixture — the values a scan must find

`test/deep-scan/landing.html` is an offline landing page ("Fixtura", a learning platform) with known values.
The smoke test (`node tests/smoke.mjs deepscan`) runs Deep Scan on it and checks the spec against this list,
with the tolerances given.

| What | Expected | Tolerance |
| --- | --- | --- |
| Regions in reading order | header (sticky) → hero (Intro) → logos strip → features → parallax band → how it works (tabs + accordion) → carousel → playground (canvas) → newsletter (form) → footer | same order |
| Header | `position: sticky`, top 0, height 72px; z-index 50 | ±1px |
| Header after scrolling past 80px | class `is-scrolled`: background #ffffff, box-shadow `0 2px 12px rgba(0,0,0,.08)`, height 72 → 56px; transition 200ms ease | threshold 80px ± one scroll step; ±1px |
| Container | max-width 1200px, centred, padding 0 24px | exact |
| Hero | grid, columns 7fr / 5fr (at 1440px: 644 / 460 px = (1200 − 48 padding − 48 gap) × 7/12, 5/12), gap 48px, padding 96px 0; one column under 1024px | ±2px |
| Hero image | 4:3, `object-fit: cover`, radius 16px | exact |
| Logos strip | 5 images 120×40 in a flex row (`justify-content: space-between`) | count exact |
| Feature cards | grid of `.card` ×6, 3 columns at ≥1025px, 2 at ≤1024px, 1 at ≤768px, gap 24px; card radius 12px, padding 24px, border 1px #e6e6ef | count/columns exact |
| Card hover | `transform: translateY(-4px)` (matrix …, -4), `box-shadow: 0 12px 24px rgba(22,22,29,.12)`; transition transform 200ms ease, box-shadow 200ms ease | exact |
| Primary button | bg #5b4cf0 → hover #4a3bd9, color #fff, height 48px, padding 0 24px, radius 12px, transition background-color 150ms ease-out | exact |
| Breakpoints (`@media`) | `max-width: 1024px`, `max-width: 768px`; also `prefers-reduced-motion: reduce` (the site handles reduced motion) | exact |
| Burger | hidden above 768px, visible at 390px; opens `#mobile-nav` drawer (300px wide, fixed right) | — |
| Dropdown | "Products" button `aria-haspopup`/`aria-expanded` → `#products-menu` appears below it (absolute), `drop-in` 160ms ease-out; closes on outside click / Esc / the button again | — |
| Tabs | 3 tabs (`role=tab`), each shows its own panel | count exact |
| Accordion | 2 `aria-expanded` triggers + 1 `<details>` | — |
| Dialog | "Watch demo" → `<dialog>` (modal), `dialog-in` 200ms ease-out (opacity 0→1, scale .96→1); closes with Esc / Close / backdrop | — |
| CSS @keyframes | `pulse` (badge, 2s ease-in-out infinite, scale 1 → 1.06 → 1), `drop-in`, `dialog-in` | names exact |
| rAF motion | `.floaty` moves vertically ±12px, sine, period 3000ms, looping | amplitude ±3px, period ±400ms |
| Reveal | `.reveal` cards: opacity 0 → 1 and translateY 24px → 0 over 600ms ease-out when 15% visible (IntersectionObserver), stagger 100ms | threshold 0.1–0.25, stagger ±40ms |
| Parallax | `.parallax-layer` moves at 50% of the scroll speed | ratio 0.4–0.6 |
| Scroll snap | `.carousel`: `scroll-snap-type: x mandatory`, slides 320px, `snap-align: start`; arrow buttons scroll by 336px | exact |
| Smooth scroll | `html { scroll-behavior: smooth }` | — |
| Back to top | fixed bottom-right 24px, appears after 600px of scroll (opacity 0 → 1, 200ms) | threshold ± one step |
| Canvas | `#particles` 600×200, animated 2D canvas → marked approximate | — |
| Form | newsletter form (`action=/submitted`): never submitted, input never typed into | 0 requests to /submitted |
| Fonts | `Fixture Display` (`@font-face`, woff2 + local Arial), body system-ui | names exact |
| Colors (roles) | brand #5b4cf0, ink #16161d, muted #5d5d6b, surface #f6f5ff, line #e6e6ef, footer bg #16161d | ΔE small |
| Type scale | 56/64 (h1), 40/48 (h2), 32/40, 20/28 (h3), 20/32 (lead), 16/24 (body), 15, 14 | exact |
| Safety | no navigation away, no form submit, debugger detached after the scan | exact |

`?navtest` makes the page itself try `form.requestSubmit()` and `location.assign()` 2 s after load (both must be blocked during a scan).
