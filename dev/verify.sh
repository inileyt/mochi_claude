#!/usr/bin/env bash
# Quick checks after every change: JS syntax, manifest.json (valid, every file
# it names exists), and the unit tests. The browser smoke test is separate:
#   node tests/smoke.mjs
set -euo pipefail
cd "$(dirname "$0")/.."
fail=0
for f in $(git ls-files '*.js' '*.mjs') $(git ls-files --others --exclude-standard '*.js' '*.mjs'); do
  node --check "$f" 2>/dev/null || { echo "syntax error: $f"; node --check "$f" || true; fail=1; }
done
node - <<'NODE' || fail=1
const fs = require('fs');
const m = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const files = [
  m.background?.service_worker,
  ...(m.content_scripts || []).flatMap(c => [...(c.js || []), ...(c.css || [])]),
  ...Object.values(m.icons || {}), ...Object.values(m.action?.default_icon || {}),
  m.options_page, m.options_ui?.page,
  ...(m.web_accessible_resources || []).flatMap(w => w.resources || []),
].filter(Boolean);
const missing = files.filter(f => !fs.existsSync(f));
if (missing.length) { console.error('manifest names missing files:', missing.join(', ')); process.exit(1); }
console.log(`ok   manifest.json valid, ${files.length} files present (v${m.version})`);
NODE
for t in test/*.test.js; do node "$t" > /tmp/mochi-unit.log 2>&1 || { echo "FAIL $t"; tail -20 /tmp/mochi-unit.log; fail=1; }; done
[ "$fail" = 0 ] && echo "ok   syntax + unit tests" || { echo "verify FAILED"; exit 1; }
