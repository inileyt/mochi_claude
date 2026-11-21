/*
 * Tests for the vibe rules and the exporters. No dependencies:
 *   node test/export.test.js
 */
const assert = require('node:assert/strict');
const path = require('node:path');

require(path.join(__dirname, '../src/vibes.js'));
require(path.join(__dirname, '../src/scan-export.js'));
const { exporters, classifyVibe, EXPORT_FORMATS } = globalThis.Mochi;

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`ok   ${name}`); } catch (err) { console.error(`FAIL ${name}\n     ${err.message}`); process.exitCode = 1; }
};

const base = () => ({
  v: 1, id: 'scan_test', url: 'https://example.com/', host: 'example.com', title: 'Example', at: '2026-11-21T10:00:00.000Z',
  theme: 'light', stats: { elements: 300, walked: 900, capped: false, ms: 40, wallMs: 50 },
  colors: [
    { hex: '#f6f7fb', role: 'background', weight: 0.6, from: ['bg'] },
    { hex: '#ffffff', role: 'surface', weight: 0.2, from: ['bg'] },
    { hex: '#1f2333', role: 'text', weight: 0.1, from: ['text'] },
    { hex: '#5b6075', role: 'muted', weight: 0.05, from: ['text'] },
    { hex: '#6c5ce7', role: 'primary', weight: 0.03, from: ['accent'] },
    { hex: '#e3e5ef', role: 'border', weight: 0.02, from: ['border'] },
  ],
  typography: {
    heading: { family: 'Inter', weights: [600, 700], lineHeight: 1.15, letterSpacing: '-0.02em', maxSize: 48 },
    body: { family: 'Inter', size: 16, weight: 400, lineHeight: 1.6 },
    mono: null, scale: [12, 14, 16, 20, 32, 48], weights: [400, 600, 700],
    kinds: { headingSerif: false, bodySerif: false, mono: false, pixel: false, rounded: false, sans: true },
  },
  shape: { radii: [{ px: 12, count: 8 }, { px: 16, count: 4 }, { px: 9999, count: 3 }], shadows: ['rgba(20, 24, 40, 0.08) 0px 10px 30px 0px'], borderWidths: [1] },
  spacing: { scale: [4, 8, 12, 16, 24, 32, 48, 64], base: 8 },
  layout: { maxWidth: 1080, flex: 12, grid: 2, columns: 3, stickyHeader: true },
  components: {
    buttonPrimary: { bg: '#6c5ce7', color: '#ffffff', radius: '12px', padding: '12px 22px', shadow: 'rgba(108, 92, 231, 0.25) 0px 8px 20px 0px', border: 'none', font: '600 15px Inter', count: 2 },
    buttonSecondary: { bg: '#ffffff', color: '#1f2333', radius: '12px', padding: '12px 22px', shadow: 'none', border: '1px solid #e3e5ef', font: '600 15px Inter', count: 1 },
    card: { bg: '#ffffff', color: '#1f2333', radius: '16px', padding: '24px 24px', shadow: 'rgba(20, 24, 40, 0.08) 0px 10px 30px 0px', border: 'none', font: '400 16px Inter', count: 3 },
    navbar: null, input: null, badge: null,
  },
  effects: { gradients: [], glass: null, translucentSurfaces: 0, transitions: true, animations: false, bgImages: false, noise: false },
  vibe: [],
});

test('vibe: soft modern scan is soft modern', () => {
  const v = classifyVibe(base());
  assert.equal(v[0].id, 'soft-modern');
  assert.ok(v[0].reason.length > 0);
  assert.ok(v[0].do.length && v[0].dont.length);
});

test('vibe: dark + neon + mono is tech lab', () => {
  const s = base();
  s.theme = 'dark';
  s.colors = [{ hex: '#070b10', role: 'background' }, { hex: '#c9f7e7', role: 'text' }, { hex: '#00ffa3', role: 'primary' }, { hex: '#ff2bd6', role: 'accent' }];
  s.typography.kinds = { ...s.typography.kinds, mono: true, sans: false };
  s.shape.radii = [{ px: 2, count: 5 }];
  assert.equal(classifyVibe(s)[0].id, 'tech-lab');
});

test('vibe: hard shadows + thick dark borders is neo-brutalist', () => {
  const s = base();
  s.colors = [{ hex: '#fff7d6', role: 'background' }, { hex: '#111111', role: 'text' }, { hex: '#ff5c8a', role: 'primary' }, { hex: '#7df9c9', role: 'accent' }, { hex: '#111111', role: 'border' }];
  s.shape = { radii: [{ px: 0, count: 6 }], shadows: ['rgb(17, 17, 17) 5px 5px 0px 0px'], borderWidths: [3] };
  s.typography.heading.weights = [900];
  assert.equal(classifyVibe(s)[0].id, 'neo-brutalist');
});

test('vibe: backdrop blur is glassmorphism', () => {
  const s = base();
  s.effects = { ...s.effects, glass: { blur: 16 }, translucentSurfaces: 6, gradients: ['linear-gradient(135deg, rgb(127, 90, 240), rgb(44, 177, 255))'] };
  assert.equal(classifyVibe(s)[0].id, 'glassmorphism');
});

test('vibe: serif + whitespace + muted is luxury or editorial', () => {
  const s = base();
  s.colors = [{ hex: '#0e0e0e', role: 'background' }, { hex: '#efe8dc', role: 'text' }, { hex: '#9a8f7e', role: 'muted' }];
  s.theme = 'dark';
  s.typography.kinds = { ...s.typography.kinds, headingSerif: true, bodySerif: true, sans: false };
  s.typography.heading = { ...s.typography.heading, weights: [300], letterSpacing: '0.08em' };
  s.spacing.scale = [8, 16, 32, 64, 96, 128];
  const ids = classifyVibe(s).map(v => v.id);
  assert.ok(ids[0] === 'luxury' || ids[0] === 'editorial', ids.join(','));
});

test('tokens: colors by role, radius, spacing', () => {
  const tk = exporters.tokens(base());
  assert.equal(tk.colors.primary, '#6c5ce7');
  assert.equal(tk.colors.background, '#f6f7fb');
  assert.equal(tk.radius.sm, '12px');
  assert.equal(tk.radius.full, '9999px');
  assert.equal(tk.spacing[1], '4px');
  assert.equal(tk.fonts.heading, '"Inter", system-ui, sans-serif');
  assert.equal(tk.maxWidth, '1080px');
});

test('css: a :root block with every color', () => {
  const s = base();
  s.vibe = classifyVibe(s);
  const out = exporters.css(s);
  assert.match(out, /^\/\* Example/);
  assert.match(out, /:root \{/);
  for (const c of s.colors) assert.ok(out.includes(`--color-${c.role}: ${c.hex};`), c.role);
  assert.match(out, /--radius-sm: 12px;/);
  assert.match(out, /--space-1: 4px;/);
  assert.match(out, /\}$/);
});

test('tailwind: valid JavaScript with theme.extend', () => {
  const s = base();
  s.vibe = classifyVibe(s);
  const out = exporters.tailwind(s);
  const module = { exports: {} };
  new Function('module', out)(module);
  assert.equal(module.exports.theme.extend.colors.primary, '#6c5ce7');
  assert.deepEqual(module.exports.theme.extend.fontFamily.heading, ['Inter', 'system-ui', 'sans-serif']);
  assert.equal(module.exports.theme.extend.maxWidth.content, '1080px');
});

test('json: parses, and carries tokens and vibe', () => {
  const s = base();
  s.vibe = classifyVibe(s);
  const data = JSON.parse(exporters.json(s));
  assert.equal(data.$schema, 'mochi-ui-scan/v1');
  assert.equal(data.source.host, 'example.com');
  assert.equal(data.tokens.colors.primary, '#6c5ce7');
  assert.equal(data.vibe[0].id, 'soft-modern');
});

test('prompt: starts right and holds tokens, components and rules', () => {
  const s = base();
  s.vibe = classifyVibe(s);
  const out = exporters.prompt(s);
  assert.match(out, /^Build a UI in this exact style: soft modern/);
  assert.ok(out.includes('- primary: #6c5ce7'));
  assert.ok(out.includes('Primary button: background #6c5ce7'));
  assert.ok(out.includes('Do:') && out.includes("Don't:"));
  assert.ok(out.includes(':root {'));
  assert.ok(out.length < 6000, `prompt is ${out.length} chars`);
});

test('DESIGN.md: has every section', () => {
  const s = base();
  s.vibe = classifyVibe(s);
  const out = exporters.designMd(s);
  for (const h of ['# DESIGN.md — Example', '## Vibe', '## Colors', '## Typography', '## Shape', '## Spacing', '## Layout', '## Components', '## Effects', '## Rules', '## CSS variables']) {
    assert.ok(out.includes(h), h);
  }
  assert.ok(out.includes('| `--color-primary` | `#6c5ce7` | primary |'));
});

test('exporters survive an almost empty scan', () => {
  const empty = { host: 'x', colors: [], typography: {}, shape: {}, spacing: {}, layout: {}, components: {}, effects: {}, vibe: [] };
  for (const f of EXPORT_FORMATS) assert.ok(exporters[f.id](empty).length > 10, f.id);
  assert.ok(classifyVibe(empty).length >= 1);
});

console.log(`\n${passed} passed${process.exitCode ? ', some failed' : ''}`);
