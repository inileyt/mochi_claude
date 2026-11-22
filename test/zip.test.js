/*
 * The rebuild-spec zip writer (src/deep-scan/zip.js): CRC32, a round trip,
 * and the system `unzip` accepting the file (when it's installed).
 *   node test/zip.test.js
 */
globalThis.Mochi = {};
const Z = require('../src/deep-scan/zip.js');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error(`FAIL ${m}`); } };

ok(Z.crc32(new TextEncoder().encode('123456789')) === 0xcbf43926, 'crc32 check value');
ok(Z.crc32(new Uint8Array(0)) === 0, 'crc32 of nothing');

const png = new Uint8Array(3000).map((_, i) => (i * 37) % 256);
const files = [
  { name: 'PROMPT.md', data: '# Prompt\nՀայերեն, русский, 中文 ✓\n' },
  { name: 'screenshots/full-1440.png', data: png },
  { name: 'spec.json', data: JSON.stringify({ a: 1 }) },
  { name: 'PROMPT.md', data: 'duplicate, ignored' },
];
const bytes = Z.build(files, { date: new Date(2026, 10, 22, 13, 45, 10) });
const back = Z.read(bytes);
ok(back.length === 3, `3 files (got ${back.length})`);
ok(new TextDecoder().decode(back[0].data).includes('Հայերեն'), 'utf-8 text survives');
ok(back[1].name === 'screenshots/full-1440.png' && back[1].data.every((b, i) => b === png[i]), 'binary survives, folder name kept');
ok(back.every(f => Z.crc32(f.data) === f.crc), 'stored CRCs match');

let unzip = null;
try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); unzip = true; } catch (_) { unzip = false; }
if (unzip) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-zip-'));
  const file = path.join(dir, 'spec.zip');
  fs.writeFileSync(file, bytes);
  const test = execFileSync('unzip', ['-t', file]).toString();
  ok(/No errors detected/.test(test), `unzip -t: ${test}`);
  execFileSync('unzip', ['-q', file, '-d', path.join(dir, 'out')]);
  ok(fs.readFileSync(path.join(dir, 'out', 'screenshots', 'full-1440.png')).equals(Buffer.from(png)), 'unzip extracts the same bytes');
  fs.rmSync(dir, { recursive: true, force: true });
}
if (fails) process.exit(1);
console.log(`ok   zip writer${unzip ? ' (checked with unzip)' : ''}`);
