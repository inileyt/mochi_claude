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
  /* Mochi's body colors by role (a color theme overrides these). */
  --m-outline: #55230d;
  --m-shade: #c95d24;
  --m-base: #ef8140;
  --m-light: #f9a35c;
  --m-highlight: #ffd8a3;
  --m-accent: #f7b23b;
  --m-accent-light: #ffe08a;
  --m-ink: #2b1208;
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
/* explore mode: Mochi travels with a translate on top of its home spot */
.root { translate: var(--ex-x, 0px) var(--ex-y, 0px); }
.root.ex-hop { transition: opacity .2s steps(2, end), right .3s steps(4, end), bottom .3s steps(4, end), translate .4s steps(4, end); }
.character.walking .leg-l { animation: walk-step .36s steps(1, end) infinite; }
.character.walking .leg-r { animation: walk-step .36s steps(1, end) infinite .18s; }
.character.walking .upper { animation: walk-bob .36s steps(1, end) infinite; }
@keyframes walk-step { 0% { transform: translateY(0); } 50% { transform: translateY(-1px); } }
@keyframes walk-bob { 0% { transform: translateY(0); } 50% { transform: translateY(-1px); } }
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
.character[data-fx~="pocket"] .fx-pocket,
.character[data-fx~="juggle"] .fx-juggle,
.character[data-fx~="book"] .fx-book,
.character[data-fx~="cup"] .fx-cup,
.character[data-fx~="notepad"] .fx-notepad,
.character[data-fx~="pipette"] .fx-pipette,
.character[data-fx~="thumb"] .fx-thumb,
.character[data-fx~="brush"] .fx-brush { opacity: 1; }
.fx-brush .brush { animation: hold-bob 1s steps(1, end) infinite; }
.character.lean .mochi-svg { transform: translate(-3px, 2px) rotate(-6deg); transition: transform .2s steps(2, end); }

/* blinking: swap the eye sprite for a one-pixel lid line */
.lid { visibility: hidden; }
.blink .eye-px { visibility: hidden; }
.blink .lid { visibility: visible; }
/* tired in a long chat: droopy lids, then little bags under the eyes */
.tired-lids, .tired-bags { display: none; }
.character[data-tired] .tired-lids { display: inline; }
.character[data-tired="3"] .tired-bags { display: inline; }
.blink .tired-lids { display: none !important; }

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
.character.act-yawn .action-wrap { animation: stretch 2s steps(1, end) 1; }
.character.act-yawn .arm { animation: stretch-arms 2s steps(1, end) 1 !important; }
.character.act-juggle .arm-l { animation: juggle-l .5s steps(1, end) 4 !important; }
.character.act-juggle .arm-r { animation: juggle-r .5s steps(1, end) 4 !important; }
.character.act-read .face { animation: none; transform: translate(0, 1px); }
.character.act-read .arm-l { transform: translate(2px, 1px); }
.character.act-read .arm-r { transform: translate(-2px, 1px); }
.character.act-celebrate .action-wrap { animation: hop .5s steps(1, end) 3; }
.character.act-celebrate .arm-l { animation: wave-l .25s steps(1, end) 6 !important; }
.character.act-celebrate .arm-r { animation: wave-r .25s steps(1, end) 6 !important; }
.fx-juggle .jstar { animation: juggle-star 1s steps(1, end) infinite; }
.character.act-swipe .arm-r { animation: swipe 1s steps(1, end) 1 !important; }
.fx-cup .cup { animation: cup-fall 1.8s steps(1, end) 1 both; }

/* ——— characters ——— */
.character[data-char="cat"] .tail { animation: tail-wag 1.6s steps(1, end) infinite; }
.character[data-char="cat"][data-mood="sleeping"] .tail { animation: none; }
.character[data-char="ghost"] .mochi-svg { animation: ghost-drift 6s steps(6, end) infinite; }
.character[data-char="ghost"][data-near="1"] .mochi-svg { opacity: .35; animation: none; transition: opacity .3s steps(3, end); }
.character[data-char="ghost"][data-night="1"] .mochi-svg { filter: drop-shadow(0 0 calc(var(--mochi-size) / 20) rgba(150, 120, 255, .75)); }
.fx-book .book { animation: page-flip 1.2s steps(1, end) infinite; }
.fx-notepad .notepad { animation: hold-bob 1.6s steps(1, end) infinite; }
.fx-pipette .pipette { animation: hold-bob 1.2s steps(1, end) infinite; }
@keyframes hold-bob { 0%, 49% { transform: none; } 50%, 100% { transform: translateY(-1px); } }

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

/* ——— the menu app (click Mochi) ——— */
.app {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  display: flex;
  flex-direction: column;
  width: 272px;
  max-height: min(72vh, 470px);
  background: var(--ui-bg);
  color: var(--ui-ink);
  border: 3px solid var(--ui-line);
  box-shadow: 3px 3px 0 var(--ui-shadow);
  font: 12px/1.4 ui-monospace, Menlo, Consolas, monospace;
  pointer-events: auto;
  z-index: 3;
  animation: pop-in .18s steps(3, end) both;
}
.app[hidden], .root.tucked .app, .root.hidden .app { display: none; }
.app.below { bottom: auto; top: calc(100% + 8px); }
.app.from-left { right: auto; left: 0; }
.app-head { display: flex; align-items: center; justify-content: space-between; padding: 6px 6px 6px 10px; background: var(--soft-bg); border-bottom: 2px solid var(--ui-line); }
.app-head b { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; }
.app-tabs { display: grid; grid-template-columns: repeat(5, 1fr); border-bottom: 2px solid var(--ui-line); }
.app-tab {
  all: unset;
  display: grid;
  place-items: center;
  height: 30px;
  font: 15px/1 system-ui, sans-serif;
  color: var(--ui-ink);
  cursor: pointer;
  border-right: 2px solid var(--ui-line);
}
.app-tab:last-child { border-right: 0; }
.app-tab:hover { background: var(--soft-bg); }
.app-tab[aria-selected="true"] { background: var(--accent); color: #2b1208; }
.app-tab:focus-visible { outline: 2px solid var(--ring); outline-offset: -4px; }
.app-body { overflow-y: auto; padding: 6px; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--ui-line) transparent; }
.app-items { display: flex; flex-direction: column; }
.app-empty { margin: 10px 6px; opacity: .75; }
.settings { display: flex; flex-direction: column; gap: 2px; }
.set-row {
  all: unset;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  cursor: pointer;
  font: 12px/1.3 ui-monospace, Menlo, Consolas, monospace;
  color: var(--ui-ink);
}
.set-row:hover, .set-row:focus-within, .set-row:focus-visible { background: var(--soft-bg); }
.set-row:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px; }
.set-row select, .set-row input[type="range"] { font: inherit; max-width: 130px; accent-color: var(--accent); }
.set-row select { background: var(--ui-bg); color: var(--ui-ink); border: 2px solid var(--ui-line); padding: 1px 4px; }
.switch { position: relative; width: 28px; height: 14px; flex-shrink: 0; border: 2px solid var(--ui-line); background: var(--soft-bg); }
.switch::after { content: ''; position: absolute; top: 1px; left: 1px; width: 8px; height: 8px; background: var(--ui-line); transition: left .12s steps(2, end); }
.toggle[aria-checked="true"] .switch { background: var(--accent); }
.toggle[aria-checked="true"] .switch::after { left: 15px; background: #2b1208; }
.menu-item {
  all: unset;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  font: 700 12px/1.2 ui-monospace, Menlo, Consolas, monospace;
  color: var(--ui-ink);
  cursor: pointer;
  white-space: normal; /* long labels in some languages wrap instead of spilling out */
}
.menu-item:hover, .menu-item:focus-visible { background: var(--accent); color: #2b1208; }
.menu-icon { flex: none; width: 14px; text-align: center; }

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
button.chip { cursor: pointer; font-family: inherit; color: inherit; }
button.chip:hover { background: var(--accent); color: #2b1208; }

/* answer bookmarks: the hover pin and the "here it is" glow */
.bm-pin {
  position: fixed; width: 28px; height: 28px; padding: 0;
  display: grid; place-items: center;
  color: var(--ui-ink); background: var(--ui-bg);
  border: 2px solid var(--ui-line); box-shadow: 2px 2px 0 var(--ui-shadow);
  cursor: pointer; pointer-events: auto; z-index: 5;
}
.bm-pin[hidden] { display: none; }
.bm-pin:hover { background: var(--accent); color: #2b1208; }
.bm-pin.on { background: var(--accent); color: #2b1208; }
.bm-pin:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
.bm-glow { position: fixed; border: 3px solid var(--accent); box-shadow: 0 0 0 3px var(--ui-bg); pointer-events: none; z-index: 1; animation: bm-blink 1s steps(2, end) 3; }
@keyframes bm-blink { 50% { border-color: transparent; } }
@media (prefers-reduced-motion: reduce) { .bm-glow { animation: none; } }
.bm-excerpt { margin: 4px 0 6px; font-size: 11px; opacity: .85; }

/* focus mode: the timer badge beside Mochi */
.focus-badge {
  position: absolute; right: calc(100% + 2px); top: 34%;
  display: flex; align-items: center; gap: 4px; padding: 2px 3px 2px 6px;
  background: var(--ui-bg); color: var(--ui-ink);
  border: 2px solid var(--ui-line); box-shadow: 2px 2px 0 var(--ui-shadow);
  font: 700 10px/1.2 ui-monospace, Menlo, Consolas, monospace; white-space: nowrap;
  pointer-events: auto;
}
.focus-badge[hidden] { display: none; }
.focus-badge[data-phase="break"] { background: var(--soft-bg); }
.focus-label { letter-spacing: .08em; opacity: .8; }
.focus-time { font-size: 12px; font-variant-numeric: tabular-nums; }
.focus-x { all: unset; cursor: pointer; padding: 0 4px; font-size: 12px; line-height: 1; }
.focus-x:hover { background: var(--accent); color: #2b1208; }
.focus-x:focus-visible { outline: 2px solid var(--ring); }
.root.has-friend .focus-badge { right: auto; left: 50%; top: 100%; transform: translateX(-50%); }
.root.has-friend.focusing .tag, .root.has-friend.on-break .tag { display: none; }
.root.tucked .focus-badge, .root.hidden .focus-badge { display: none; }

/* the outfit editor */
.editor { display: flex; flex-direction: column; gap: 6px; padding-top: 6px; }
.ed-row { display: flex; gap: 8px; align-items: flex-end; }
.ed-row > * { flex: 1; min-width: 0; }
.ed-check { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; font-size: 11px; font-weight: 700; }
.ed-check input { accent-color: var(--accent); width: 14px; height: 14px; margin: 0; }
.ed-palette { display: grid; grid-template-columns: repeat(17, 1fr); gap: 3px; }
.ed-swatch { all: unset; box-sizing: border-box; aspect-ratio: 1; min-width: 16px; border: 2px solid var(--ui-line); cursor: pointer; display: grid; place-items: center; font-size: 10px; color: var(--ui-ink); }
.ed-swatch.eraser { background: var(--ui-bg); }
.ed-swatch.on { outline: 2px solid var(--ring); outline-offset: 1px; box-shadow: inset 0 0 0 2px var(--ui-bg); }
.ed-swatch:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
.ed-stage { display: flex; gap: 8px; align-items: flex-start; flex-wrap: wrap; }
.ed-canvas { width: 280px; height: 280px; max-width: 100%; aspect-ratio: 1; border: 2px solid var(--ui-line); image-rendering: pixelated; cursor: crosshair; touch-action: none; }
.ed-canvas:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
.ed-side { display: flex; flex-direction: column; gap: 6px; min-width: 84px; }
.ed-side .px-btn { justify-content: flex-start; }
.ed-coord { font-size: 10px; opacity: .7; font-variant-numeric: tabular-nums; min-height: 1.2em; }
.ed-previews { display: flex; gap: 4px; flex-wrap: wrap; padding: 4px; border: 2px solid var(--ui-line); background: var(--soft-bg); }
.ed-previews img { width: 48px; height: 48px; image-rendering: pixelated; }
.ed-mine { margin-top: 4px; }
.ed-item .ward-art svg { display: block; }

/* online friends */
.online { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; padding-top: 6px; border-top: 2px dashed var(--ui-line); }
.ol-pitch, .ol-consent { margin: 0; }
.ol-code-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ol-label { font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; opacity: .75; }
.ol-code { font: 700 13px/1.2 ui-monospace, Menlo, Consolas, monospace; letter-spacing: .04em; padding: 3px 6px; border: 2px solid var(--ui-line); background: var(--soft-bg); user-select: all; }
.ol-add { flex-wrap: nowrap; }
.ol-add .lib-input { flex: 1; min-width: 0; text-transform: uppercase; }
.ol-person { display: flex; align-items: center; gap: 8px; padding: 6px; border: 2px solid var(--ui-line); background: var(--soft-bg); box-shadow: 2px 2px 0 var(--ui-shadow); }
.ol-thumb { flex: none; width: 40px; height: 40px; image-rendering: pixelated; display: grid; place-items: center; }
.ol-who { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.ol-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ol-hearts { font-size: 10px; color: #e0245e; }
.ol-actions { display: flex; gap: 4px; margin-left: auto; }
.ol-request .ol-name { flex: 1; }
.ol-dot { flex: none; width: 10px; height: 10px; background: #e0245e; border: 2px solid var(--ui-line); }
.ol-error { color: #c0392b; }
.ol-foot { margin-top: 4px; flex-wrap: wrap; }
.ol-chatbox { display: flex; flex-direction: column; gap: 8px; padding-top: 6px; }
.ol-chat { display: flex; flex-direction: column; gap: 6px; max-height: 300px; min-height: 120px; overflow-y: auto; padding: 6px; border: 2px solid var(--ui-line); background: var(--soft-bg); overscroll-behavior: contain; }
.ol-msg { max-width: 80%; padding: 5px 8px; border: 2px solid var(--ui-line); background: var(--ui-bg); overflow-wrap: anywhere; white-space: pre-wrap; }
.ol-msg.me { align-self: flex-end; background: var(--accent); color: #2b1208; }
.ol-msg.them { align-self: flex-start; }
.ol-msg.sticker { font-size: 26px; line-height: 1.1; padding: 2px 6px; }
.ol-stickers { display: flex; gap: 4px; flex-wrap: wrap; }
.ol-sticker { font-size: 18px; padding: 2px 6px; }
.ol-form { flex-wrap: nowrap; }
.ol-form .lib-input { flex: 1; min-width: 0; }

/* the prompt library */
.library { display: flex; flex-direction: column; gap: 8px; padding-top: 6px; }
.lib-top { flex-wrap: wrap; }
.lib-input, .lib-text {
  box-sizing: border-box; width: 100%; padding: 6px 8px;
  font: 12px/1.4 ui-monospace, Menlo, Consolas, monospace;
  color: var(--ui-ink); background: var(--ui-bg);
  border: 2px solid var(--ui-line); border-radius: 0;
}
.lib-text { resize: vertical; min-height: 90px; }
.lib-input:focus-visible, .lib-text:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
.lib-input::placeholder, .lib-text::placeholder { color: var(--ui-ink); opacity: .5; }
.lib-label { display: flex; flex-direction: column; gap: 3px; margin-bottom: 6px; font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.lib-form .lib-label:last-of-type { margin-bottom: 4px; }
.lib-item .pk-title { margin-bottom: 4px; }
.lib-preview { white-space: normal !important; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.lib-foot { align-items: center; }
.lib-foot span { margin-right: auto; }
.library [hidden] { display: none !important; }

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
/* Deep Scan: the explainer, the progress bar and the results */
.deep p { margin: 0 0 8px; }
.deep .deep-list { margin: 0 0 8px; padding-left: 18px; }
.deep .deep-list li { margin: 2px 0; }
.deep .deep-why { padding: 6px 8px; border: 2px dashed var(--ui-line); background: var(--soft-bg); }
.deep .deep-own { display: flex; gap: 8px; align-items: flex-start; font-weight: 700; margin: 6px 0; cursor: pointer; }
.deep .deep-own input { accent-color: var(--accent); width: 16px; height: 16px; margin: 1px 0 0; flex-shrink: 0; }
.deep .deep-step { font-weight: 700; min-height: 1.4em; }
.deep .deep-bar { height: 16px; border: 2px solid var(--ui-line); background: var(--soft-bg); margin: 6px 0 4px; }
.deep .deep-bar-fill { display: block; height: 100%; width: 0; background: var(--accent); transition: width .3s steps(4, end); }
.deep .deep-pct { font-size: 11px; opacity: .8; }
.deep-results h4 { margin: 12px 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
.deep-results .deep-outline { margin: 0; padding-left: 18px; font-size: 11px; }
.deep-results .deep-warn { border-left: 4px solid var(--accent); padding: 4px 8px; background: var(--soft-bg); font-size: 11px; }
.deep-results .deep-shots { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }
.deep-results .deep-shots figure { margin: 0; font-size: 9px; }
.deep-results .deep-shots img { width: 100%; height: 64px; object-fit: cover; object-position: top; border: 2px solid var(--ui-line); display: block; }
.deep-results .deep-swatches { display: flex; flex-wrap: wrap; gap: 4px; }
.deep-results .deep-swatches i { width: 22px; height: 22px; border: 2px solid var(--ui-line); display: inline-block; }
.deep-results pre { white-space: pre-wrap; font-size: 10px; max-height: 160px; overflow: auto; background: var(--soft-bg); padding: 6px; margin: 0; }
@media (prefers-reduced-motion: reduce) { .deep .deep-bar-fill { transition: none; } }
/* Mochi's birthday: the cake beside Mochi, the thank-you card */
.bday-cake { all: unset; position: absolute; right: calc(100% + 2px); bottom: 0; display: flex; flex-direction: column; align-items: center; cursor: pointer; pointer-events: auto; z-index: 2; animation: pop-in .2s steps(3, end) both; }
.bday-cake svg { display: block; filter: drop-shadow(2px 2px 0 var(--ui-shadow)); }
.bday-cake:focus-visible { outline: 3px solid var(--ring); outline-offset: 2px; }
.bday-cake .cake-tip { order: -1; margin-bottom: 4px; padding: 2px 6px; background: var(--ui-bg); color: var(--ui-ink); border: 2px solid var(--ui-line); font: 700 10px/1.3 ui-monospace, Menlo, Consolas, monospace; white-space: nowrap; }
.bday-cake .cake-n { font: 800 11px ui-monospace, Menlo, Consolas, monospace; color: var(--ui-ink); background: var(--ui-bg); padding: 0 3px; }
.bday-cake .flame { animation: flicker .5s steps(2, end) infinite; }
.bday-cake .smoke { display: none; }
.bday-cake.out { cursor: default; }
.bday-cake.out .flame { display: none; }
.bday-cake.out .smoke { display: inline; animation: smoke-up 1.4s steps(4, end) forwards; }
@keyframes flicker { 50% { transform: translateY(-1px); } }
@keyframes smoke-up { to { transform: translateY(-4px); opacity: 0; } }
.offer.bday-card .bday-note { font-weight: 400; margin-top: 4px; }
@media (prefers-reduced-motion: reduce) { .bday-cake .flame, .bday-cake.out .smoke { animation: none; } }
.offer.tour { width: 250px; }
.offer.tour .tour-step { display: block; font-size: 10px; opacity: .7; margin-bottom: 2px; }
.offer.tour .row { margin-top: 8px; }

/* "Catch the stars": the little game window above Mochi */
.game {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  width: 258px;
  padding: 6px 6px 8px;
  background: var(--ui-bg);
  color: var(--ui-ink);
  border: 3px solid var(--ui-line);
  box-shadow: 3px 3px 0 var(--ui-shadow);
  font: 700 11px/1.35 ui-monospace, Menlo, Consolas, monospace;
  pointer-events: auto;
  z-index: 4;
}
.game-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.game-head b { flex: 1; text-transform: uppercase; letter-spacing: .08em; white-space: nowrap; }
.game-score { display: block; margin: 0 2px 4px; font-variant-numeric: tabular-nums; opacity: .85; }
.game-head .px-btn.icon { padding: 0 6px; }
.game-canvas { display: block; width: 240px; height: 180px; margin: 0 auto; image-rendering: pixelated; border: 2px solid var(--ui-line); cursor: none; touch-action: none; }
.game-canvas:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
.game-note { margin: 5px 2px 0; min-height: 1.35em; }
.game .row { margin-top: 4px; }
.game [hidden] { display: none !important; }
.root.tucked .game, .root.hidden .game { display: none; }

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

/* ——— level, XP, streak ——— */
.stat-card { display: flex; flex-direction: column; gap: 5px; margin: 2px 2px 8px; padding: 8px; border: 2px solid var(--ui-line); background: var(--soft-bg); box-shadow: 2px 2px 0 var(--ui-shadow); }
.stat-top { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; }
.stat-level { font-size: 14px; letter-spacing: .04em; white-space: nowrap; }
.stat-streak { font-size: 11px; font-weight: 700; text-align: right; }
.xp-bar { height: 10px; border: 2px solid var(--ui-line); background: var(--ui-bg); }
.xp-bar i { display: block; height: 100%; background: repeating-linear-gradient(90deg, var(--accent) 0 6px, var(--m-accent-light) 6px 8px); }
.stat-sub { display: flex; justify-content: space-between; gap: 6px; font-size: 10px; opacity: .8; }
.stat-sub span:first-child { white-space: nowrap; }
.stat-sub span:last-child { text-align: right; }
.stat-card .px-btn { align-self: flex-start; }

/* ——— friends ——— */
.buddy { position: absolute; bottom: 0; right: calc(100% - var(--mochi-size) / 20); width: calc(var(--mochi-size) * 2 / 3); height: calc(var(--mochi-size) * 2 / 3); pointer-events: none; }
.buddy .character { position: absolute; inset: 0; pointer-events: auto; cursor: pointer; }
.buddy .character:active { cursor: pointer; }
.root.friend-above .buddy { bottom: calc(100% + 2px); right: auto; left: 0; }
.root.friend-above .buddy-bubble { right: auto; left: 70%; }
.buddy-bubble { right: 20%; bottom: calc(100% - 4px); }
.root.tucked .buddy { display: none; }
.app-sub { margin: 6px 2px 4px; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; opacity: .7; }
.ward-grid.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.colors { margin-top: 10px; }
.color-art img { width: 32px; height: 32px; }
.color-tile .ward-name { font-size: 9px; }
.char-art svg, .char-art img { display: block; width: 44px; height: 44px; image-rendering: pixelated; }
.char-art.none { display: grid; place-items: center; width: 44px; height: 44px; font-size: 22px; opacity: .6; }
.char-tile.locked .char-art img { filter: brightness(0) opacity(.3); }
:host([data-theme="dark"]) .char-tile.locked .char-art img { filter: brightness(0) invert(1) opacity(.28); }
.friends .note { margin: 6px 2px 2px; }

/* ——— outfits ——— */
.character[data-hide~="antenna"] .sprout { display: none; }
.snow { position: absolute; left: -24%; right: -24%; top: -28%; bottom: 8%; pointer-events: none; overflow: hidden; z-index: -1; }
.snow i {
  position: absolute;
  top: 0;
  width: calc(var(--mochi-size) / 40 * 2);
  height: calc(var(--mochi-size) / 40 * 2);
  background: #e8f2ff;
  box-shadow: 0 0 0 calc(var(--mochi-size) / 40) #8fb2e6;
  animation: snow-fall 3.6s steps(12, end) infinite;
}
:host([data-theme="dark"]) .snow i { background: #ffffff; box-shadow: 0 0 0 calc(var(--mochi-size) / 40) #5c7fb8; }
@keyframes snow-fall {
  0% { transform: translate(0, 0); opacity: 0; }
  10% { opacity: 1; }
  50% { transform: translate(calc(var(--mochi-size) / 40 * 3), calc(var(--mochi-size) * .6)); }
  90% { opacity: 1; }
  100% { transform: translate(0, calc(var(--mochi-size) * 1.2)); opacity: 0; }
}
/* secrets: blushing, party confetti, golden sparkle */
.blush-big { display: none; }
.character.blushing .blush-big { display: inline; }
.confetti { position: absolute; left: -30%; right: -30%; top: -40%; bottom: 10%; pointer-events: none; overflow: hidden; z-index: -1; }
.confetti i {
  position: absolute; top: 0;
  width: calc(var(--mochi-size) / 40 * 2); height: calc(var(--mochi-size) / 40 * 3);
  animation: confetti-fall 1.8s steps(9, end) infinite;
}
@keyframes confetti-fall {
  0% { transform: translate(0, 0) rotate(0deg); opacity: 0; }
  10% { opacity: 1; }
  50% { transform: translate(calc(var(--mochi-size) / 40 * -3), calc(var(--mochi-size) * .7)) rotate(90deg); }
  100% { transform: translate(calc(var(--mochi-size) / 40 * 2), calc(var(--mochi-size) * 1.4)) rotate(180deg); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) { .confetti i { animation: none; top: auto; bottom: 20%; } }
.root.golden .spark-glow { animation-duration: .8s; }
.wardrobe { display: flex; flex-direction: column; gap: 6px; }
.ward-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.ward-tile {
  all: unset;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 2px 5px;
  border: 2px solid var(--ui-line);
  background: var(--soft-bg);
  cursor: pointer;
  font: 700 10px/1.2 ui-monospace, Menlo, Consolas, monospace;
  color: var(--ui-ink);
  text-align: center;
}
.ward-tile:hover { transform: translate(-1px, -1px); box-shadow: 2px 2px 0 var(--ui-shadow); }
.ward-tile:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
.ward-tile.on { background: var(--accent); color: #2b1208; box-shadow: inset 0 0 0 2px var(--ui-bg); }
.ward-tile.locked { cursor: not-allowed; opacity: .75; }
.ward-tile.locked:hover { transform: none; box-shadow: none; }
.ward-art svg { display: block; width: 48px; height: 48px; }
.ward-name { max-width: 100%; min-width: 0; overflow: hidden; text-align: center; line-height: 1.15; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.ward-note { margin: 0; }

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

@keyframes juggle-l { 0% { transform: translate(0, -3px); } 50% { transform: translate(0, -1px); } }
@keyframes juggle-r { 0% { transform: translate(0, -1px); } 50% { transform: translate(0, -3px); } }
@keyframes juggle-star {
  0% { transform: translate(-8px, 6px); } 12% { transform: translate(-6px, 0); } 25% { transform: translate(-3px, -3px); }
  37% { transform: translate(0, -4px); } 50% { transform: translate(3px, -3px); } 62% { transform: translate(6px, 0); }
  75% { transform: translate(8px, 6px); } 87% { transform: translate(0, 2px); }
}
@keyframes page-flip { 0%, 60% { transform: none; } 70% { transform: translateY(-1px); } 80% { transform: none; } }
@keyframes swipe { 0% { transform: translate(0, 0); } 20% { transform: translate(1px, -2px); } 40% { transform: translate(3px, -1px); } 60% { transform: translate(1px, 0); } }
@keyframes cup-fall { 0%, 30% { transform: none; opacity: 1; } 40% { transform: translate(1px, 0); } 50% { transform: translate(2px, 2px); } 62% { transform: translate(3px, 5px); } 75% { transform: translate(3px, 8px); opacity: 1; } 100% { transform: translate(3px, 8px); opacity: 0; } }
@keyframes tail-wag { 0% { transform: translateX(0); } 50% { transform: translateX(1px); } }
@keyframes ghost-drift { 0%, 100% { opacity: 1; } 50% { opacity: .62; } }
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
/* ——— Image Scan: the magnifier on images ——— */
.img-hover {
  position: fixed;
  z-index: 6;
  width: 32px;
  height: 32px;
  padding: 0;
  justify-content: center;
  font-size: 18px;
  line-height: 1;
  background: var(--accent);
  color: #2b1208;
  pointer-events: auto;
}
.img-hover[hidden] { display: none; }
.img-hover:hover, .img-hover:focus-visible { background: var(--ui-bg); color: var(--ui-ink); }
/* ——— Image Scan: the result card ——— */
.img-top { display: flex; gap: 10px; align-items: flex-start; margin-top: 8px; }
.img-thumb { margin: 0; flex: none; width: 132px; }
.img-frame { position: relative; line-height: 0; border: 2px solid var(--ui-line); background: repeating-conic-gradient(var(--soft-bg) 0 25%, transparent 0 50%) 0 0 / 12px 12px; }
.img-frame img { display: block; width: 100%; height: auto; max-height: 180px; object-fit: contain; image-rendering: auto; }
.img-box { position: absolute; display: block; outline: 2px solid var(--accent); background: color-mix(in srgb, var(--accent) 18%, transparent); pointer-events: none; }
.img-meta { min-width: 0; flex: 1; }
.img-swatches .swatch { position: relative; }
.img-swatches .sw-name { display: block; font-size: 10px; opacity: .8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.img-grad { margin-top: 6px; }
.img-grad-bar { display: inline-block; width: 64px; height: 14px; border: 2px solid var(--ui-line); margin-right: 6px; vertical-align: middle; }
.img-text { margin: 0; padding: 6px 8px; max-height: 140px; overflow: auto; white-space: pre-wrap; word-break: break-word; background: var(--soft-bg); border: 2px solid var(--ui-line); font: 12px/1.4 ui-monospace, Menlo, Consolas, monospace; }
.img-font { border: 2px solid var(--ui-line); padding: 6px 8px; margin-bottom: 6px; }
.img-font-text { margin: 0 0 4px; font-weight: 700; word-break: break-word; }
.img-font .dot, .img-sec .dot { display: inline-block; width: 10px; height: 10px; border: 1px solid var(--ui-line); vertical-align: -1px; }
.img-like { margin: 4px 0 0; }
.img-caption { margin: 0 0 6px; font-weight: 700; }
.img-desc .kv.static { cursor: default; grid-template-columns: 92px 1fr; }
.img-prompt { min-height: 140px; white-space: pre-wrap; overflow-wrap: anywhere; }
.img-alt-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }
.img-alt { flex: 1 1 180px; margin: 0; font-style: italic; }
.img-foot .note { margin-top: 4px; }
.img-foot .row { margin-top: 0; }
.pk-thumb { width: 40px; height: 40px; object-fit: cover; border: 2px solid var(--ui-line); flex: none; }
/* ——— Tools: the "notes for this page" paper Mochi holds up ——— */
.notes-badge {
  all: unset;
  position: absolute;
  left: -14px;
  top: 6px;
  min-width: 18px;
  height: 22px;
  padding: 0 4px;
  box-sizing: border-box;
  display: grid;
  place-items: end center;
  background: repeating-linear-gradient(180deg, #fff3b0 0 5px, #e8d28a 5px 6px);
  border: 2px solid var(--ui-line);
  box-shadow: 2px 2px 0 var(--ui-shadow);
  color: #2b1208;
  font: 700 10px/1 ui-monospace, Menlo, Consolas, monospace;
  cursor: pointer;
  pointer-events: auto;
  transform: rotate(-8deg);
  animation: hold-bob 1.6s steps(1, end) infinite;
  z-index: 3;
}
.notes-badge:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.root.hidden .notes-badge { display: none; }
/* ——— Tools: the notepad ——— */
.notes-pad {
  --paper: #fff3b0;
  position: fixed;
  z-index: 7;
  width: 280px;
  display: flex;
  flex-direction: column;
  background: var(--ui-bg);
  color: var(--ui-ink);
  border: 3px solid var(--ui-line);
  box-shadow: 4px 4px 0 var(--ui-shadow);
  font: 12px/1.45 ui-monospace, Menlo, Consolas, monospace;
  pointer-events: auto;
}
.np-head { display: flex; align-items: center; gap: 6px; padding: 4px 4px 4px 8px; border-bottom: 3px solid var(--ui-line); background: var(--soft-bg); cursor: grab; touch-action: none; user-select: none; }
.np-head:active { cursor: grabbing; }
.np-title { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; flex: 1; }
.np-tabs { display: flex; }
.np-tab { all: unset; cursor: pointer; padding: 2px 6px; border: 2px solid var(--ui-line); font: 700 10px/1.2 ui-monospace, Menlo, Consolas, monospace; background: var(--ui-bg); color: var(--ui-ink); }
.np-tab + .np-tab { border-left: 0; }
.np-tab[aria-pressed="true"] { background: var(--accent); color: #2b1208; }
.np-tab:focus-visible, .np-dot:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
.np-paper { padding: 0; background: var(--paper); border-bottom: 3px solid var(--ui-line); }
.np-text {
  all: unset; box-sizing: border-box; display: block; width: 100%; min-height: 170px; max-height: 50vh; resize: vertical; overflow: auto;
  padding: 6px 10px; color: #2b1d12; white-space: pre-wrap; overflow-wrap: anywhere;
  font: 13px/20px ui-monospace, Menlo, Consolas, monospace;
  background: repeating-linear-gradient(180deg, transparent 0 19px, rgba(120, 90, 40, .22) 19px 20px) 0 6px / 100% 20px local;
}
.np-text::placeholder { color: rgba(43, 29, 18, .55); }
.np-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 8px; }
.np-dots { display: flex; gap: 3px; }
.np-dot { all: unset; cursor: pointer; width: 14px; height: 14px; border: 2px solid var(--ui-line); }
.np-dot[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--accent); }
.np-foot .px-btn { padding: 2px 6px; }
.np-status { flex: 1 1 100%; font-size: 10px; opacity: .75; }
.notes-search { width: 100%; box-sizing: border-box; }
.note-chip { flex: none; width: 14px; height: 18px; border: 2px solid var(--ui-line); }
/* ——— Tools: the color picker card ——— */
.pc-big { height: 64px; margin-top: 8px; border: 3px solid var(--ui-line); display: flex; align-items: flex-end; padding: 4px 6px; box-sizing: border-box; }
.pc-big span { background: var(--ui-bg); color: var(--ui-ink); padding: 0 4px; font-size: 11px; border: 2px solid var(--ui-line); }
.pc-row { display: grid; grid-template-columns: 52px 1fr auto; align-items: center; gap: 6px; padding: 2px 0; }
.pc-row .k { opacity: .7; font-size: 11px; }
.pc-row .v { font: 12px ui-monospace, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
.pc-row .px-btn { padding: 2px 6px; }
.pc-strip { display: grid; grid-template-columns: repeat(12, 1fr); gap: 3px; }
.pc-cell { all: unset; box-sizing: border-box; aspect-ratio: 1; min-width: 14px; border: 2px solid var(--ui-line); cursor: grab; }
.pc-cell[aria-current="true"] { box-shadow: 0 0 0 2px var(--accent); }
.pc-cell:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
.pc-contrast { display: flex; gap: 10px; align-items: center; }
.pc-sample { flex: none; width: 84px; height: 64px; display: grid; place-items: center; border: 3px solid var(--ui-line); font: 700 26px/1 system-ui, sans-serif; }
.pc-sample small { font: 9px ui-monospace, Menlo, monospace; }
.pc-ratio { margin: 0 0 4px; font-size: 18px; font-weight: 700; }
.pc-table { border-collapse: collapse; font-size: 11px; }
.pc-table th, .pc-table td { padding: 1px 6px; text-align: center; }
.pc-table th:first-child { text-align: left; }
.pc-pass[data-ok="false"] { opacity: .8; text-decoration: none; }
/* ——— Tools: the font inspector (a clear glass, an outline and a tooltip, all on Mochi's layer) ——— */
.ins-catcher { position: fixed; inset: 0; z-index: 8; pointer-events: auto; background: transparent; }
.ins-box { position: fixed; z-index: 9; pointer-events: none; outline: 2px dashed var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }
.ins-box[hidden], .ins-tip[hidden] { display: none; }
.ins-tip {
  position: fixed; z-index: 10; max-width: 300px; padding: 8px 10px; pointer-events: none;
  background: var(--ui-bg); color: var(--ui-ink); border: 3px solid var(--ui-line); box-shadow: 4px 4px 0 var(--ui-shadow);
  font: 11px/1.4 ui-monospace, Menlo, Consolas, monospace;
}
.ins-tip.pinned { pointer-events: auto; border-color: var(--accent); }
.ins-top { display: flex; gap: 8px; align-items: flex-start; }
.ins-aa { flex: none; display: grid; place-items: center; width: 44px; height: 40px; border: 2px solid var(--ui-line); font-size: 24px; line-height: 1; }
.ins-font { font-size: 12px; }
.ins-prob { opacity: .7; font-style: italic; }
.ins-stack { margin: 2px 0 0; opacity: .75; overflow-wrap: anywhere; }
.ins-stack b { opacity: 1; color: var(--ui-ink); text-decoration: underline; text-decoration-color: var(--accent); text-decoration-thickness: 2px; }
.ins-kv { display: grid; grid-template-columns: auto 1fr; gap: 1px 8px; margin: 6px 0 0; }
.ins-kv dt { opacity: .7; }
.ins-kv dd { margin: 0; }
.ins-kv .dot { display: inline-block; width: 10px; height: 10px; border: 1px solid var(--ui-line); vertical-align: -1px; }
.ins-kv .chip { padding: 0 4px; font-size: 10px; }
.ins-tip .row { margin-top: 6px; }
.ins-hint { z-index: 11; }
/* ——— Live Edit + Guides ——— */
.live-wish { width: 100%; box-sizing: border-box; }
.live-css { min-height: 120px; white-space: pre; }
.gd-card {
  position: fixed; left: 16px; bottom: 16px; z-index: 7; width: min(340px, calc(100vw - 32px));
  background: var(--ui-bg); color: var(--ui-ink); border: 3px solid var(--ui-line); box-shadow: 4px 4px 0 var(--ui-shadow);
  font: 12px/1.45 ui-monospace, Menlo, Consolas, monospace; padding: 8px 10px; pointer-events: auto;
}
.gd-head { display: flex; align-items: center; gap: 6px; }
.gd-head b { white-space: nowrap; }
.gd-title { flex: 1; min-width: 0; opacity: .7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gd-text { margin: 6px 0; font-size: 13px; }
.gd-status.warn { color: var(--warn, #b45309); opacity: 1; }
.gd-box { position: fixed; z-index: 6; pointer-events: none; outline: 3px solid var(--accent); outline-offset: 2px; box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 25%, transparent); animation: gd-pulse 1.2s steps(2, end) infinite; }
.gd-box[hidden] { display: none; }
@keyframes gd-pulse { 50% { box-shadow: 0 0 0 10px color-mix(in srgb, var(--accent) 12%, transparent); } }
.gd-card.rec { border-color: #dc2626; }
.gd-dot { width: 10px; height: 10px; background: #dc2626; animation: blink-on 1s steps(1, end) infinite; }
.gd-list .lib-input { width: 100%; box-sizing: border-box; }
@media (prefers-reduced-motion: reduce) {
  .character[data-char="ghost"] .mochi-svg { opacity: .85; }
  .snow { display: none; }
  .notes-badge { animation: none; }
  .gd-box, .gd-dot { animation: none; }
  .root { animation: none; transition: opacity .2s; }
  .mochi-svg *, .mochi-svg { animation: none !important; }
  .character:hover { transform: none; }
  .fx-zzz > g, .eyestar { opacity: 1; }
}
`;
})();
