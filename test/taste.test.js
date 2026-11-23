/* Design taste: the profile from taste events.   node test/taste.test.js */
const assert = require('node:assert/strict');
globalThis.Mochi = {};
require('../src/image-scan/colors.js');
const T = require('../src/tools/taste.js');
const day = 24 * 3600 * 1000, now = Date.UTC(2026, 10, 23);
const ev = [
  { kind: 'scan', at: now - day, colors: [{ hex: '#ff6b35', role: 'accent' }, { hex: '#1a1a2e', role: 'background' }, { hex: '#f8f8f8', role: 'text' }], fonts: ['Inter', 'system-ui'], vibe: ['Playful', 'Bold'], radius: 12, spacing: 8, theme: 'dark' },
  { kind: 'scan', at: now - 2 * day, colors: [{ hex: '#ff6a36', role: 'accent' }, { hex: '#16162b', role: 'background' }], fonts: ['Inter'], vibe: ['playful'], radius: 16, spacing: 8, theme: 'dark' },
  { kind: 'color', at: now - 3 * day, colors: ['#ff6b34'] },
  { kind: 'image', at: now - 200 * day, colors: [{ hex: '#7fb069', role: 'dominant' }], fonts: ['Lora'] },
  { kind: 'font', at: now - day, fonts: ['"Space Mono"'] },
];
const p = T.profile(ev, now);
assert.equal(p.colors[0].name.length > 0, true);
assert.ok(Math.abs(parseInt(p.colors[0].hex.slice(1), 16) - 0xff6b35) < 0x030303, `the orange leads: ${p.colors[0].hex}`);
assert.equal(p.colors[0].count, 3, 'three near-identical oranges merged');
assert.ok(p.colors.some(c => c.hex === '#1a1a2e' || c.hex === '#16162b'), 'the dark navy merged too');
const green = p.colors.find(c => c.hex === '#7fb069');
assert.ok(!green || green.share < p.colors[0].share / 5, 'an old color counts little');
assert.deepEqual(p.fonts.map(f => f.name).slice(0, 2), ['Inter', 'Space Mono']);
assert.ok(!p.fonts.some(f => f.name === 'system-ui'), 'generic families are left out');
assert.equal(p.vibes[0].name, 'playful', 'vibes counted case-insensitively');
assert.equal(p.tone, 'dark');
assert.equal(p.radius, 16);
assert.equal(p.spacing, 8);
assert.deepEqual(p.sources, { scan: 2, color: 1, image: 1, font: 1 });
assert.equal(p.total, 5);
const md = T.brief(p);
assert.match(md, /^# My design taste\n\nWhat I tend to like, gathered from 5 things/);
assert.match(md, /## Colors\n- .+ `#ff6b3\d` \(\d+%\)/);
assert.match(md, /## Typefaces\n- Inter\n- Space Mono/);
assert.match(md, /mostly dark interfaces/);
assert.equal(T.profile([], now).total, 0);
console.log(`ok   taste: ${p.colors.slice(0, 3).map(c => `${c.hex} ${c.share}%`).join(', ')}; fonts ${p.fonts.map(f => f.name).join(', ')}; ${p.tone}, ${p.saturation}`);
