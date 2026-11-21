/*
 * Checks every language file against English: missing keys, extra keys,
 * {placeholders} that don't match, and lists vs. single texts.
 *   node test/locales.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
globalThis.Mochi = { locales: {} };
const dir = path.join(__dirname, '../src/locales');
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) require(path.join(dir, f));
const { en, ...others } = globalThis.Mochi.locales;
const holes = v => [...new Set((Array.isArray(v) ? v.join(' ') : String(v)).match(/\{\w+\}/g) || [])].sort().join(',');

let problems = 0;
const bad = msg => { problems++; console.error(`FAIL ${msg}`); };
console.log(`en: ${Object.keys(en).length} keys`);
for (const [code, l] of Object.entries(others)) {
  const missing = Object.keys(en).filter(k => !(k in l));
  const extra = Object.keys(l).filter(k => !(k in en));
  for (const k of missing) bad(`${code}: missing ${k}`);
  for (const k of extra) bad(`${code}: unknown key ${k}`);
  for (const k of Object.keys(en)) {
    if (!(k in l)) continue;
    if (Array.isArray(en[k]) !== Array.isArray(l[k])) bad(`${code}: ${k} should be ${Array.isArray(en[k]) ? 'a list' : 'a single text'}`);
    // Every placeholder a text uses must exist in English (a translation may leave one out).
    const want = new Set(holes(en[k]).split(',').filter(Boolean));
    for (const h of holes(l[k]).split(',').filter(Boolean)) if (!want.has(h)) bad(`${code}: ${k} uses ${h}, English doesn't`);
  }
  if (!l['language.name']) bad(`${code}: set 'language.name'`);
  console.log(`${code}: ${Object.keys(l).length} keys, ${missing.length} missing`);
}
if (problems) process.exitCode = 1;
console.log(problems ? `${problems} problems` : 'ok   all languages match English');
