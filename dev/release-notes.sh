#!/usr/bin/env bash
# Release notes: how to install (for everyone), then release-notes/<version>.md
# if it exists, or else what changed since the last release.
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('./manifest.json').version")
prev=$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || true)
cat <<NOTES
## ⬇️ Download: **[mochi-extension.zip](https://github.com/inileyt/mochi_claude/releases/download/v${version}/mochi-extension.zip)**

**Install (2 minutes):** download the zip → unzip it → open \`chrome://extensions\` → turn on **Developer mode** → **Load unpacked** → pick the **mochi-extension** folder.
Step by step in English, Հայերեն and Русский: **[How to install](https://github.com/inileyt/mochi_claude/blob/main/INSTALL.md)**.

**Ներբեռնեք zip-ը → բացեք (unzip) → \`chrome://extensions\` → Developer mode → Load unpacked → ընտրեք mochi-extension թղթապանակը։**

---

NOTES
# Hand-written notes for this version, if there are any (release-notes/<version>.md)…
if [ -f "release-notes/${version}.md" ]; then
  cat "release-notes/${version}.md"
  exit 0
fi
# …otherwise, the list of changes since the last release.
echo "### What's new in ${version}"
if [ -n "$prev" ]; then
  git log --no-merges --format='- %s' "${prev}..HEAD" | grep -v -i '^- README\|^- Online test' || true
else
  git log --no-merges --format='- %s' -15
fi
