/*
 * Outfits and characters as data: every outfit's rows are the same width, every pixel letter has a
 * color, everything stays on Mochi's 40×40 grid, ids are unique, the slots exist, glasses keep
 * to the face; every character registers, unlocks at a level that the level list announces, and
 * draws inside the grid. Also checks a cape's back part goes behind the body in pictures.
 *   node test/outfits.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

const Mochi = { features: [], t: k => k, tPick: k => k, debugHooks: {}, settings: { define() {}, get: () => ({}), onChange() {} }, menu: { addView() {}, addSetting() {}, addItem() {} }, store: { today: () => '2026-06-01' } };
const ctx = vm.createContext({ globalThis: null, Mochi, console, setTimeout, clearTimeout });
ctx.globalThis = ctx;
const order = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).content_scripts[0].js;
for (const f of ['src/art.js', 'src/outfits.js', ...order.filter(f => f.startsWith('src/characters/'))]) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });

const { OUTFITS, SLOTS, markup } = Mochi.outfits;
assert.equal(JSON.stringify(SLOTS), JSON.stringify(['head', 'face', 'neck', 'body']));
const ids = new Set();
for (const o of OUTFITS) {
  assert.ok(/^[a-z0-9-]+$/.test(o.id) && !ids.has(o.id), `bad or repeated id ${o.id}`);
  ids.add(o.id);
  assert.ok(SLOTS.includes(o.slot), `${o.id}: unknown slot ${o.slot}`);
  assert.ok(o.name && o.author, `${o.id}: name and author`);
  for (const part of [o, o.back].filter(Boolean)) {
    const w = part.pixels[0].length;
    part.pixels.forEach((row, i) => assert.equal(row.length, w, `${o.id}: row ${i} is ${row.length} wide, not ${w}`));
    for (const ch of new Set(part.pixels.join('').replace(/\./g, ''))) assert.ok(o.palette[ch], `${o.id}: no color for "${ch}"`);
    const [x, y] = part.at;
    assert.ok(x >= 0 && y >= 0 && x + w <= 40 && y + part.pixels.length <= 40, `${o.id}: off the 40×40 grid`);
  }
  if (o.slot === 'face') assert.ok(o.at[1] >= 19 && o.at[1] + o.pixels.length <= 31, `${o.id}: glasses should stay on the face`);
  assert.ok(markup(o).includes(`outfit-${o.id}`));
}
assert.ok(OUTFITS.length >= 23, `${OUTFITS.length} outfits`);
for (const slot of SLOTS) assert.ok(OUTFITS.filter(o => o.slot === slot).length >= 2, `few ${slot} items`);

// Characters: registered in unlock order, each one announced by the level list (progress.js).
const chars = Mochi.characters.all();
assert.equal(chars.map(c => c.id).join(), ['mochi', 'bunny', 'cat', 'penguin', 'fox', 'robot', 'bear', 'ghost', 'cloud'].join());
const levels = chars.map(c => c.unlock.level);
assert.equal(levels.join(), [...levels].sort((a, b) => a - b).join(), 'characters load in unlock order');
const progress = fs.readFileSync(path.join(root, 'src/progress.js'), 'utf8');
for (const c of chars.slice(1)) assert.ok(new RegExp(`${c.unlock.level}: \\[[^\\]]*kind: 'friend', id: '${c.id}'`).test(progress), `${c.id}: not announced at level ${c.unlock.level}`);
for (const c of chars) {
  const svg = Mochi.art.svg(c.parts);
  for (const m of svg.matchAll(/M(-?\d+) (-?\d+)h1v1h-1z/g)) {
    const [x, y] = [Number(m[1]), Number(m[2])];
    assert.ok(x >= 0 && x < 40 && y >= 0 && y < 40, `${c.id}: pixel ${x},${y} off the grid`);
  }
  for (const role of ['outline', 'shade', 'base', 'light', 'highlight', 'accent', 'accentLight']) assert.ok(/^#[0-9a-f]{6}$/i.test(c.colors[role]), `${c.id}: color ${role}`);
}

// A cape: the back part goes behind the body in a still picture.
const cape = OUTFITS.find(o => o.id === 'cape');
const still = Mochi.art.staticSvg({ outfits: [{ slot: 'body', markup: markup(cape), hide: [] }] });
const backAt = still.indexOf('<g class="outfit-layer-back"><g class="outfit-back">');
assert.ok(backAt > 0 && backAt < still.indexOf('<g class="body">'), 'the cape is not behind the body');
assert.ok(!/data-slot="body">[^]*?outfit-back/.test(still.slice(still.indexOf('data-slot="body"'), still.indexOf('data-slot="body"') + 400)), 'the back part stayed in front');

console.log(`ok   ${OUTFITS.length} outfits (${SLOTS.map(s => `${OUTFITS.filter(o => o.slot === s).length} ${s}`).join(', ')}) and ${chars.length} characters are valid`);
