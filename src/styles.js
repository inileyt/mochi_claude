/*
 * Mochi — styles and pixel animations (injected into Mochi's own shadow root,
 * so nothing here can leak into claude.ai and nothing from claude.ai leaks in).
 *
 * Pixel rules: Mochi's SVG is a 40 × 40 grid where 1px in a transform is one
 * art pixel. Every animation moves parts by whole pixels and runs with
 * steps(1, end), so each keyframe is a held sprite frame, as in a retro game.
 * Sizes are multiples of 40 (120px = 3 screen px per art pixel; 80px = 2).
 *
 * Layers that animate independently, so they combine:
 *   .mood-wrap   — the looping animation of the current mood (bounce, sway…)
 *   .upper       — body, face, arms and antenna over the legs (pixel squash)
 *   .action-wrap — one-shot actions (wave, stretch, hop, spin…)
 *   .face        — where Mochi looks (--lx/--ly, whole pixels)
 *   .fx          — pixel sparkles, Zzz, thought bubble…
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  Mochi.styles = String.raw`
:host {
  all: initial;
  position: fixed;
  z-index: 2147483000;
  right: 0;
  bottom: 0;
  width: 0;
  height: 0;
  pointer-events: none;
  --mochi-size: 120px;
  --ui-bg: #fff6e6;
  --ui-ink: #3a1a0a;
  --ui-line: #4a1f0c;
  --ui-shadow: rgba(74, 31, 12, .28);
  --accent: #e2733a;
  --soft-bg: #ffe9cf;
  --ring: #f7b23b;
  font-family: ui-monospace, "SFMono-Regular", "Cascadia Mono", Menlo, Consolas, "Liberation Mono", monospace;
}
:host([data-theme="dark"]) {
  --ui-bg: #2c1b12;
  --ui-ink: #ffe3c4;
  --ui-line: #f29a55;
  --ui-shadow: rgba(0, 0, 0, .45);
  --accent: #f7b23b;
  --soft-bg: #3d2619;
}
@media (max-width: 860px) { :host { --mochi-size: 80px; } }

* { box-sizing: border-box; }

.root {
  position: fixed;
  right: var(--right, 28px);
  bottom: var(--bottom, 120px);
  width: var(--mochi-size);
  height: var(--mochi-size);
  pointer-events: none;
  transition: opacity .2s steps(2, end), right .3s steps(4, end), bottom .3s steps(4, end);
  animation: arrive .6s steps(1, end) both;
  z-index: 5; /* Mochi and its bubble stay above the panel */
}
.root.dragging { transition: none; }
@keyframes arrive {
  0% { opacity: 0; transform: translateY(24px); }
  20% { opacity: 1; transform: translateY(12px); }
  40% { transform: translateY(-9px); }
  60% { transform: translateY(-3px); }
  80% { transform: translateY(3px); }
  100% { opacity: 1; transform: none; }
}

/* ——— character ——— */
.character {
  position: absolute;
  inset: 0;
  pointer-events: auto;
  cursor: grab;
  outline: none;
  -webkit-tap-highlight-color: transparent;
  touch-action: none;
}
.character:active { cursor: grabbing; }
.character:hover { transform: translateY(calc(var(--mochi-size) / -40)); }
.character:focus-visible { outline: 3px solid var(--ring); outline-offset: 2px; }
.mochi-svg { width: 100%; height: 100%; display: block; overflow: visible; image-rendering: pixelated; }
.mochi-svg * { transform-box: view-box; }

.face { transform: translate(var(--lx, 0px), var(--ly, 0px)); }
.pupils { transform: translate(var(--px, 0px), var(--py, 0px)); }
.ground-shadow { transform-origin: 20px 35px; }
.action-wrap { transform-origin: 20px 26px; }

/* parts: hidden unless the face recipe names them */
.part { opacity: 0; }
.character[data-eyes="open"] .eyes-open,
.character[data-eyes="wide"] .eyes-wide,
.character[data-eyes="happy"] .eyes-happy,
.character[data-eyes="closed"] .eyes-closed,
.character[data-eyes="sad"] .eyes-sad,
.character[data-mouth="cat"] .mouth-cat,
.character[data-mouth="smile"] .mouth-smile,
.character[data-mouth="big"] .mouth-big,
.character[data-mouth="o"] .mouth-o,
.character[data-mouth="small-o"] .mouth-small-o,
.character[data-mouth="frown"] .mouth-frown,
.character[data-mouth="wavy"] .mouth-wavy,
.character[data-brows="up"] .brows-up,
.character[data-brows="sad"] .brows-sad,
.character[data-brows="think"] .brows-think,
.character[data-brows="curious"] .brows-curious,
.character[data-fx~="sparkles"] .fx-sparkles,
.character[data-fx~="sparkles-soft"] .fx-sparkles-soft,
.character[data-fx~="think"] .fx-think,
.character[data-fx~="dots"] .fx-dots,
.character[data-fx~="question"] .fx-question,
.character[data-fx~="exclaim"] .fx-exclaim,
.character[data-fx~="zzz"] .fx-zzz,
.character[data-fx~="heart"] .fx-heart,
.character[data-fx~="love"] .fx-love,
.character[data-fx~="note"] .fx-note,
.character[data-fx~="dizzy"] .fx-dizzy,
.character[data-fx~="magnifier"] .fx-magnifier,
.character[data-fx~="pocket"] .fx-pocket { opacity: 1; }

/* blinking: swap the eye sprite for a one-pixel lid line */
.lid { visibility: hidden; }
.blink .eye-px { visibility: hidden; }
.blink .lid { visibility: visible; }

.eyestar { opacity: 0; }
.character[data-fx~="eyestars"] .eyestar { animation: blink-on 1s steps(1, end) infinite; }
.character[data-fx~="eyestars"] .eyestar + * { animation-delay: .5s; }
.spark-glow { animation: blink-on 1.6s steps(1, end) infinite; }

/* ——— moods (looping) ——— */
.character[data-mood="neutral"] .upper { animation: idle-bob 1.6s steps(1, end) infinite; }

.character[data-mood="happy"] .mood-wrap { animation: bounce .9s steps(1, end) 3; }
.character[data-mood="happy"] .upper { animation: land-squash .9s steps(1, end) 3, idle-bob 1.4s steps(1, end) 2.7s infinite; }
.character[data-mood="happy"] .ground-shadow { animation: shadow-jump .9s steps(1, end) 3; }
.character[data-mood="happy"] .arm { transform: translateY(-2px); }

.character[data-mood="excited"] .mood-wrap { animation: hop .6s steps(1, end) infinite; }
.character[data-mood="excited"] .ground-shadow { animation: shadow-hop .6s steps(1, end) infinite; }
.character[data-mood="excited"] .arm-l { animation: wave-l .3s steps(1, end) infinite; }
.character[data-mood="excited"] .arm-r { animation: wave-r .3s steps(1, end) infinite; }

.character[data-mood="thinking"] .mood-wrap { animation: sway 1.6s steps(1, end) infinite; }
.character[data-mood="thinking"] .arm-r { animation: tap-head .5s steps(1, end) infinite; }

.character[data-mood="focused"] .upper { animation: idle-bob 1.2s steps(1, end) infinite; }

.character[data-mood="curious"] .mood-wrap { animation: curious-lean 1.4s steps(1, end) infinite; }
.character[data-mood="curious"] .arm-l { transform: translateY(-2px); }

.character[data-mood="sad"] .mood-wrap { animation: sad-sway 2.4s steps(1, end) infinite; }
.character[data-mood="sad"] .arm { transform: translateY(1px); }
.character[data-mood="sad"] .sprout { transform: translate(-1px, 1px); }

.character[data-mood="surprised"] .mood-wrap { animation: jolt .8s steps(1, end) 1; }
.character[data-mood="surprised"] .ground-shadow { animation: shadow-jump .8s steps(1, end) 1; }
.character[data-mood="surprised"] .arm { transform: translateY(-6px); }

.character[data-mood="sleeping"] .mood-wrap { transform: translateY(1px); }
.character[data-mood="sleeping"] .upper { animation: idle-bob 2.4s steps(1, end) infinite; }
.character[data-mood="sleeping"] .sprout { transform: translate(-1px, 1px); }
.character[data-mood="sleeping"] .spark-glow { animation: none; opacity: 0; }
.character[data-mood="sleeping"] .arm { transform: translateY(1px); }

/* ——— one-shot actions ——— */
.character.act-wave .arm-r { animation: wave-hello .3s steps(1, end) 5 !important; }
.character.act-wave .action-wrap { animation: lean 1.5s steps(1, end) 1; }
.character.act-stretch .action-wrap { animation: stretch 1.6s steps(1, end) 1; }
.character.act-stretch .arm { animation: stretch-arms 1.6s steps(1, end) 1 !important; }
.character.act-hop .action-wrap { animation: bounce .6s steps(1, end) 2; }
.character.act-hop .ground-shadow { animation: shadow-jump .6s steps(1, end) 2 !important; }
.character.act-spin .action-wrap { animation: spin .84s steps(1, end) 1; }
.character.act-wiggle .action-wrap { animation: wiggle .6s steps(1, end) 1; }
.character.act-look .face { animation: look-around 2.6s steps(1, end) 1; }
.character.act-squish .upper { animation: land-squash-quick .3s steps(1, end) 1 !important; }
.character.act-dizzy .action-wrap { animation: wiggle .4s steps(1, end) 4; }
.character.act-sniff .mood-wrap { animation: sniff-bob .4s steps(1, end) infinite !important; }
.character.act-sniff .arm-l { transform: translate(1px, -2px); }
.character.act-pocket .action-wrap { animation: bounce .6s steps(1, end) .9s 1; }

/* ——— effects ——— */
.fx-sparkles .sparkle, .fx-sparkles-soft .sparkle { animation: blink-on 1.2s steps(1, end) infinite; }
.sparkle.s2 { animation-delay: .3s !important; }
.sparkle.s3 { animation-delay: .6s !important; }
.sparkle.s4 { animation-delay: .9s !important; }
.sparkle.s5 { animation-delay: .45s !important; }
.fx-think .tb1 { animation: think-1 2.4s steps(1, end) infinite; }
.fx-think .tb2 { animation: think-2 2.4s steps(1, end) infinite; }
.fx-think .tb3 { animation: think-3 2.4s steps(1, end) infinite; }
.fx-dots .d1 { animation: dot 1.2s steps(1, end) infinite; }
.fx-dots .d2 { animation: dot 1.2s steps(1, end) .2s infinite; }
.fx-dots .d3 { animation: dot 1.2s steps(1, end) .4s infinite; }
.fx-question > g { animation: bob 1s steps(1, end) infinite; }
.character[data-fx~="exclaim"] .fx-exclaim { animation: pop .5s steps(1, end) 1; }
.fx-zzz > g { animation: zzz 3s steps(1, end) infinite; opacity: 0; }
.fx-zzz .z2 { animation-delay: 1s; }
.fx-zzz .z3 { animation-delay: 2s; }
.fx-heart .heart-shape { animation: float 2s steps(1, end) infinite; }
.fx-love > g { animation: love-rise 1.6s steps(1, end) 1 both; }
.fx-love .h2 { animation-delay: .15s; }
.fx-love .h3 { animation-delay: .3s; }
.fx-note > g { animation: bob 0.8s steps(1, end) infinite; }
.fx-dizzy .dz1 { animation: orbit 0.8s steps(1, end) infinite; }
.fx-dizzy .dz2 { animation: orbit 0.8s steps(1, end) -.4s infinite; }
.fx-magnifier .mag { animation: sweep 1.6s steps(1, end) infinite; }
.fx-magnifier .sniff { animation: blink-on .4s steps(1, end) infinite; }
.fx-magnifier .s2 { animation-delay: .2s; }
.fx-pocket .drop { animation: card-drop 1.4s steps(1, end) 1 both; }
.fx-pocket .tick { animation: tick-pop 1.4s steps(1, end) 1 both; }
.tear { animation: tear 2.4s steps(1, end) infinite; opacity: 0; }

/* ——— retro speech bubble ——— */
.bubble {
  position: absolute;
  bottom: calc(100% - var(--mochi-size) / 10);
  right: 42%;
  width: max-content;
  padding: 6px 10px 7px;
  background: var(--ui-bg);
  color: var(--ui-ink);
  border: 3px solid var(--ui-line);
  box-shadow: 3px 3px 0 var(--ui-shadow);
  clip-path: polygon(0 3px, 3px 3px, 3px 0, calc(100% - 3px) 0, calc(100% - 3px) 3px, 100% 3px, 100% calc(100% - 3px), calc(100% - 3px) calc(100% - 3px), calc(100% - 3px) 100%, 3px 100%, 3px calc(100% - 3px), 0 calc(100% - 3px));
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: .02em;
  opacity: 0;
  transform: translateY(6px);
  transition: opacity .15s steps(2, end), transform .15s steps(2, end);
  pointer-events: none;
  white-space: normal;
  max-width: 210px;
  text-align: left;
}
.bubble.show { opacity: 1; transform: none; }
.bubble { z-index: 6; }

/* ——— name tag (on hover) and tuck button ——— */
.tag {
  position: absolute;
  top: 100%;
  left: 50%;
  margin-top: 2px;
  transform: translate(-50%, -3px);
  padding: 2px 7px;
  background: var(--ui-bg);
  color: var(--ui-ink);
  border: 2px solid var(--ui-line);
  box-shadow: 2px 2px 0 var(--ui-shadow);
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
  opacity: 0;
  transition: opacity .12s steps(2, end);
  pointer-events: none;
}
.tag b { color: var(--accent); font-weight: 800; }
.root:hover .tag, .root:focus-within .tag { opacity: 1; transform: translate(-50%, 0); }

.tuck {
  position: absolute;
  top: 0;
  right: 0;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 2px solid var(--ui-line);
  background: var(--ui-bg);
  color: var(--ui-ink);
  box-shadow: 2px 2px 0 var(--ui-shadow);
  font: 800 13px/1 ui-monospace, Menlo, Consolas, monospace;
  display: grid;
  place-items: center;
  cursor: pointer;
  pointer-events: auto;
  opacity: 0;
  transition: opacity .12s steps(2, end);
}
.tuck:focus-visible { outline: 3px solid var(--ring); outline-offset: 1px; }
.root:hover .tuck, .root:focus-within .tuck { opacity: 1; }

/* tucked: only a peeking slice at the right edge of the window */
.root.tucked { right: calc(var(--mochi-size) * -0.55) !important; }
.root.tucked .tuck, .root.tucked .tag, .root.tucked .bubble { display: none; }
.root.tucked .character:hover { transform: translateX(calc(var(--mochi-size) / -10)); }

/* ——— menu (click Mochi) ——— */
.menu {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 30%;
  display: none;
  flex-direction: column;
  min-width: 156px;
  padding: 4px;
  background: var(--ui-bg);
  border: 3px solid var(--ui-line);
  box-shadow: 3px 3px 0 var(--ui-shadow);
  pointer-events: auto;
  z-index: 3;
}
.menu.open { display: flex; animation: pop-in .18s steps(3, end) both; }
.root.tucked .menu, .root.hidden .menu { display: none; }
.menu-item {
  all: unset;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  font: 700 12px/1.2 ui-monospace, Menlo, Consolas, monospace;
  color: var(--ui-ink);
  cursor: pointer;
  white-space: nowrap;
}
.menu-item:hover, .menu-item:focus-visible { background: var(--accent); color: #2b1208; }
.menu-icon { width: 14px; text-align: center; }

/* ——— sheet: scan results and pocket ——— */
.panel {
  position: fixed;
  display: flex;
  flex-direction: column;
  max-height: 72vh;
  background: var(--ui-bg);
  color: var(--ui-ink);
  border: 3px solid var(--ui-line);
  box-shadow: 4px 4px 0 var(--ui-shadow);
  font: 12px/1.45 ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  pointer-events: auto;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity .15s steps(2, end), transform .15s steps(2, end);
  z-index: 4;
}
.panel[hidden] { display: none; }
.panel.show { opacity: 1; transform: none; }
.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 8px 8px 12px;
  border-bottom: 3px solid var(--ui-line);
  background: var(--soft-bg);
}
.sheet-title { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.sheet-title b { font-size: 13px; letter-spacing: .04em; text-transform: uppercase; }
.sheet-sub { opacity: .75; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sheet-body { overflow-y: auto; padding: 4px 12px 12px; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--ui-line) transparent; }
.sheet-foot { padding: 6px 12px; border-top: 2px solid var(--ui-line); font-size: 11px; opacity: .8; }
.blk { margin-top: 10px; }
.blk h4 { margin: 0 0 6px; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; opacity: .7; }
.note { margin: 6px 0 0; font-size: 11px; opacity: .75; }
.reason { margin: 6px 0 0; }
.row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }

.px-btn {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 9px;
  border: 2px solid var(--ui-line);
  background: var(--ui-bg);
  color: var(--ui-ink);
  box-shadow: 2px 2px 0 var(--ui-shadow);
  font: 700 11px/1.3 ui-monospace, Menlo, Consolas, monospace;
  cursor: pointer;
  white-space: nowrap;
}
.px-btn:hover { background: var(--soft-bg); }
.px-btn:active { transform: translate(2px, 2px); box-shadow: none; }
.px-btn:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
.px-btn.primary { background: var(--accent); color: #2b1208; }
.px-btn.danger:hover { background: #ff8c7a; color: #2b1208; }
.px-btn.icon { padding: 0; width: 24px; height: 24px; justify-content: center; font-size: 15px; }

.chip { display: inline-block; padding: 2px 7px; margin: 0 4px 4px 0; border: 2px solid var(--ui-line); background: var(--soft-bg); font-weight: 700; font-size: 11px; }
.chip.main { background: var(--accent); color: #2b1208; }
.chip.ghost { background: transparent; font-weight: 400; border-width: 1px; }

.swatches { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.swatch { all: unset; cursor: pointer; display: flex; flex-direction: column; gap: 2px; font-size: 10px; min-width: 0; }
.swatch i { display: block; height: 34px; border: 2px solid var(--ui-line); box-shadow: 2px 2px 0 var(--ui-shadow); }
.swatch:hover i { transform: translate(-1px, -1px); box-shadow: 3px 3px 0 var(--ui-shadow); }
.swatch:focus-visible i { outline: 2px solid var(--ring); outline-offset: 1px; }
.sw-role { opacity: .7; overflow: hidden; text-overflow: ellipsis; }
.sw-hex { font-weight: 700; }

.font-row { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.font-sample { width: 44px; height: 36px; display: grid; place-items: center; border: 2px solid var(--ui-line); background: var(--soft-bg); font-size: 20px; line-height: 1; flex-shrink: 0; overflow: hidden; }
.font-sample.head { font-size: 22px; }
.font-meta b { font-weight: 800; }
.scale { margin-top: 2px; }

.shapes { display: flex; flex-wrap: wrap; gap: 10px; }
.shape { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 10px; }
.shape i { display: block; width: 40px; height: 28px; background: var(--soft-bg); }
.shape .radius { border: 2px solid var(--ui-ink); }
.shape .shadow { background: #fff; margin: 4px; }
:host([data-theme="dark"]) .shape .shadow { background: #4a3324; }

.spacing { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 4px 10px; }
.spacing .sp { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; font-size: 10px; }
.spacing .sp i { display: block; height: 6px; background: var(--accent); }
.spacing .note { flex-basis: 100%; }

.cmps { display: flex; flex-direction: column; gap: 8px; }
.cmp { display: grid; grid-template-columns: 112px 1fr; gap: 8px; align-items: center; }
.cmp-stage { display: grid; place-items: center; min-height: 44px; padding: 6px; background: repeating-conic-gradient(var(--soft-bg) 0 25%, transparent 0 50%) 0 0 / 8px 8px; border: 1px solid var(--ui-line); overflow: hidden; }
.cmp-prev { display: inline-block; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px !important; line-height: 1.2; }
.cmp-desc { display: flex; flex-direction: column; font-size: 10px; min-width: 0; word-break: break-word; }

.tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.tab[aria-selected="true"] { background: var(--accent); color: #2b1208; box-shadow: none; transform: translate(2px, 2px); }
.export {
  box-sizing: border-box;
  width: 100%;
  height: 170px;
  resize: vertical;
  padding: 8px;
  border: 2px solid var(--ui-line);
  background: var(--soft-bg);
  color: var(--ui-ink);
  font: 11px/1.4 ui-monospace, Menlo, Consolas, monospace;
  white-space: pre;
}
.export:focus { outline: 2px solid var(--ring); }

.pocket { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.pk { padding: 8px; border: 2px solid var(--ui-line); background: var(--soft-bg); box-shadow: 2px 2px 0 var(--ui-shadow); }
.pk-head { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; min-width: 0; }
.pk-title { display: flex; flex-direction: column; min-width: 0; }
.pk-title span { font-size: 10px; opacity: .75; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.strip { display: grid; grid-template-columns: repeat(3, 10px); grid-auto-rows: 10px; border: 2px solid var(--ui-line); flex-shrink: 0; }
.strip i { display: block; }
.pk .row { margin-top: 2px; }
.empty { text-align: center; padding: 16px 4px; }
.empty p { margin: 4px 0; }

/* the offer card above Mochi on claude.ai */
.offer {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 10%;
  width: 230px;
  padding: 8px 10px 10px;
  background: var(--ui-bg);
  color: var(--ui-ink);
  border: 3px solid var(--ui-line);
  box-shadow: 3px 3px 0 var(--ui-shadow);
  font: 700 12px/1.35 ui-monospace, Menlo, Consolas, monospace;
  pointer-events: auto;
  z-index: 3;
  animation: pop-in .18s steps(3, end) both;
}
.offer p { margin: 0; }
.offer b { color: var(--accent); }
.root.tucked .offer, .root.hidden .offer { display: none; }

.font-stack { opacity: .65; font-size: 10px; }

/* ——— Pick an element ——— */
.pick-catcher { position: fixed; inset: 0; z-index: 6; cursor: crosshair; pointer-events: auto; background: transparent; }
.pick-catcher[hidden] { display: none; }
.pick-box {
  position: fixed;
  z-index: 7;
  pointer-events: none;
  border: 2px dashed var(--accent);
  background: rgba(239, 129, 64, .12);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, .7);
  transition: left .06s steps(1, end), top .06s steps(1, end), width .06s steps(1, end), height .06s steps(1, end);
}
.pick-box[hidden], .pick-label[hidden], .pick-hint[hidden] { display: none; }
.pick-label {
  position: fixed;
  z-index: 8;
  pointer-events: none;
  max-width: 420px;
  padding: 2px 7px;
  background: var(--ui-line);
  color: var(--ui-bg);
  font: 700 11px/1.5 ui-monospace, Menlo, Consolas, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pick-hint {
  position: fixed;
  z-index: 8;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  pointer-events: none;
  padding: 6px 12px;
  background: var(--ui-bg);
  color: var(--ui-ink);
  border: 3px solid var(--ui-line);
  box-shadow: 3px 3px 0 var(--ui-shadow);
  font: 12px/1.3 ui-monospace, Menlo, Consolas, monospace;
  white-space: nowrap;
  max-width: calc(100vw - 24px);
  overflow: hidden;
  text-overflow: ellipsis;
}
.pick-preview { border: 2px solid var(--ui-line); background: repeating-conic-gradient(var(--soft-bg) 0 25%, transparent 0 50%) 0 0 / 12px 12px; }
.kvs { display: flex; flex-direction: column; gap: 2px; }
.kv { all: unset; display: grid; grid-template-columns: 92px auto 1fr; align-items: center; gap: 6px; padding: 2px 4px; cursor: pointer; font-size: 11px; min-width: 0; }
.kv:hover, .kv:focus-visible { background: var(--soft-bg); }
.kv:focus-visible { outline: 2px solid var(--ring); }
.kv .k { opacity: .7; }
.kv .v { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.kv .dot, .dot { display: inline-block; width: 12px; height: 12px; border: 1px solid var(--ui-line); vertical-align: -2px; }
.kv:not(:has(.dot)) { grid-template-columns: 92px 1fr; }
.color-chip { cursor: pointer; }

@keyframes pop-in { 0% { opacity: 0; transform: translateY(6px); } 50% { opacity: 1; transform: translateY(2px); } 100% { transform: none; } }

@media (max-width: 520px) {
  .swatches { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .cmp { grid-template-columns: 90px 1fr; }
}

/* hidden with the toolbar button */
.root.hidden { opacity: 0; visibility: hidden; transform: translateY(12px); transition: opacity .2s steps(2, end), visibility 0s .2s, transform .2s steps(2, end); }
.root.hidden * { pointer-events: none !important; }

/* page hidden: pause everything */
.root.paused *, .root.paused { animation-play-state: paused !important; }

/* ——— keyframes (every value a whole art pixel; steps(1) holds each frame) ——— */
@keyframes blink-on { 0% { opacity: 0; } 50% { opacity: 1; } }
@keyframes idle-bob { 0% { transform: translateY(0); } 50% { transform: translateY(1px); } }
@keyframes bounce {
  0% { transform: translateY(0); }
  12% { transform: translateY(-2px); }
  25% { transform: translateY(-4px); }
  37% { transform: translateY(-5px); }
  50% { transform: translateY(-4px); }
  62% { transform: translateY(-2px); }
  75%, 100% { transform: translateY(0); }
}
@keyframes land-squash { 0%, 74% { transform: translateY(0); } 75% { transform: translateY(1px); } 90% { transform: translateY(0); } }
@keyframes land-squash-quick { 0% { transform: translateY(1px); } 60% { transform: translateY(0); } }
@keyframes hop {
  0% { transform: translateY(1px); }
  16% { transform: translateY(-3px); }
  33% { transform: translateY(-6px); }
  50% { transform: translateY(-7px); }
  66% { transform: translateY(-5px); }
  83% { transform: translateY(-2px); }
}
@keyframes shadow-jump { 0%, 75%, 100% { transform: scaleX(1); opacity: 1; } 12% { transform: scaleX(.86); } 25%, 62% { transform: scaleX(.72); opacity: .7; } }
@keyframes shadow-hop { 0% { transform: scaleX(1); } 16%, 83% { transform: scaleX(.86); } 33%, 66% { transform: scaleX(.72); opacity: .7; } 50% { transform: scaleX(.58); opacity: .6; } }
@keyframes jolt {
  0% { transform: translateY(1px); }
  12% { transform: translateY(-3px); }
  25% { transform: translateY(-6px); }
  37% { transform: translateY(-8px); }
  50% { transform: translateY(-6px); }
  62% { transform: translateY(-3px); }
  75% { transform: translateY(0); }
  87% { transform: translateY(-1px); }
  100% { transform: translateY(0); }
}
@keyframes sway { 0% { transform: translateX(0); } 25% { transform: translateX(1px); } 50% { transform: translateX(0); } 75% { transform: translateX(-1px); } }
@keyframes curious-lean { 0% { transform: translate(-1px, 0); } 50% { transform: translate(-1px, -1px); } }
@keyframes sad-sway { 0% { transform: translate(0, 1px); } 50% { transform: translate(-1px, 1px); } }
@keyframes wave-l { 0% { transform: translate(0, -5px); } 50% { transform: translate(-1px, -6px); } }
@keyframes wave-r { 0% { transform: translate(1px, -6px); } 50% { transform: translate(0, -5px); } }
@keyframes tap-head { 0% { transform: translate(-1px, -6px); } 50% { transform: translate(-1px, -5px); } }
@keyframes wave-hello { 0% { transform: translate(0, -6px); } 50% { transform: translate(1px, -7px); } }
@keyframes lean { 0%, 100% { transform: translateX(0); } 10%, 90% { transform: translateX(-1px); } }
@keyframes stretch {
  0% { transform: translateY(0); }
  15% { transform: translateY(-1px); }
  30% { transform: translateY(-2px); }
  70% { transform: translateY(-1px); }
  80% { transform: translateY(1px); }
  90%, 100% { transform: translateY(0); }
}
@keyframes stretch-arms { 0% { transform: translateY(0); } 15% { transform: translateY(-3px); } 30% { transform: translateY(-7px); } 70% { transform: translateY(-3px); } 85%, 100% { transform: translateY(0); } }
@keyframes spin {
  0% { transform: scaleX(1) translateY(0); }
  14% { transform: scaleX(.5) translateY(-2px); }
  28% { transform: scaleX(-.5) translateY(-4px); }
  42% { transform: scaleX(-1) translateY(-5px); }
  57% { transform: scaleX(-.5) translateY(-4px); }
  71% { transform: scaleX(.5) translateY(-2px); }
  85%, 100% { transform: scaleX(1) translateY(0); }
}
@keyframes wiggle { 0% { transform: translateX(-1px); } 25% { transform: translateX(1px); } 50% { transform: translateX(-1px); } 75% { transform: translateX(1px); } 100% { transform: translateX(0); } }
@keyframes look-around {
  0% { transform: translate(var(--lx, 0px), var(--ly, 0px)); }
  12%, 40% { transform: translate(-2px, 0); }
  50%, 80% { transform: translate(2px, -1px); }
  92%, 100% { transform: translate(var(--lx, 0px), var(--ly, 0px)); }
}
@keyframes think-1 { 0%, 92% { opacity: 1; } }
@keyframes think-2 { 0% { opacity: 0; } 20%, 92% { opacity: 1; } }
@keyframes think-3 { 0% { opacity: 0; } 40% { opacity: 1; } 70% { opacity: 1; transform: translateY(-1px); } 92% { opacity: 1; transform: none; } }
@keyframes dot { 0% { opacity: .25; } 30% { opacity: 1; transform: translateY(-1px); } 60% { opacity: .25; transform: none; } }
@keyframes bob { 0% { transform: translateY(0); } 50% { transform: translateY(-1px); } }
@keyframes pop { 0% { transform: translateY(2px); opacity: 0; } 20% { transform: translateY(-1px); opacity: 1; } 40% { transform: none; } }
@keyframes zzz {
  0% { opacity: 0; transform: translate(0, 1px); }
  10% { opacity: 1; transform: translate(0, 0); }
  40% { transform: translate(1px, -1px); }
  70% { transform: translate(1px, -2px); }
  90% { opacity: 0; }
}
@keyframes float { 0% { transform: translateY(0); } 25% { transform: translateY(-1px); } 50% { transform: translateY(-2px); } 75% { transform: translateY(-1px); } }
@keyframes love-rise {
  0% { opacity: 0; transform: translateY(3px); }
  15% { opacity: 1; transform: translateY(2px); }
  30% { transform: translateY(1px); }
  50% { transform: translateY(0); }
  70% { transform: translateY(-1px); }
  85% { opacity: 1; transform: translateY(-2px); }
  100% { opacity: 0; transform: translateY(-3px); }
}
@keyframes orbit { 0% { transform: translate(0, 0); } 25% { transform: translate(3px, -2px); } 50% { transform: translate(0, -3px); } 75% { transform: translate(-3px, -2px); } }
@keyframes tear { 0%, 30% { opacity: 0; transform: none; } 31% { opacity: 1; } 55% { transform: translateY(1px); } 75% { transform: translateY(2px); opacity: 1; } 90% { opacity: 0; } }

@keyframes sniff-bob { 0% { transform: translateY(0); } 50% { transform: translate(-1px, 1px); } }
@keyframes sweep { 0% { transform: translateX(0); } 20% { transform: translateX(3px); } 40% { transform: translateX(6px); } 60% { transform: translateX(9px); } 80% { transform: translateX(4px); } }
@keyframes card-drop {
  0% { transform: translateY(0); opacity: 0; }
  10% { opacity: 1; }
  20% { transform: translateY(4px); }
  35% { transform: translateY(10px); }
  50% { transform: translateY(17px); }
  62% { transform: translateY(23px); opacity: 1; }
  70%, 100% { transform: translateY(25px); opacity: 0; }
}
@keyframes tick-pop { 0%, 64% { opacity: 0; transform: translateY(2px); } 70% { opacity: 1; transform: translateY(-1px); } 80%, 100% { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .root { animation: none; transition: opacity .2s; }
  .mochi-svg *, .mochi-svg { animation: none !important; }
  .character:hover { transform: none; }
  .fx-zzz > g, .eyestar { opacity: 1; }
}
`;
})();
