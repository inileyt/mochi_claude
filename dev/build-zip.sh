#!/usr/bin/env bash
# Builds the zip people install: dist/mochi-extension.zip (always the same name,
# so "latest" download links keep working) and dist/mochi-extension-<version>.zip.
# Inside: one folder, mochi-extension/, with the extension and the install guide.
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('./manifest.json').version")
rm -rf dist && mkdir -p dist/mochi-extension
cp -r manifest.json src icons dist/mochi-extension/
cp INSTALL.md dist/mochi-extension/HOW-TO-INSTALL.md
(cd dist && zip -qr "mochi-extension-${version}.zip" mochi-extension && cp "mochi-extension-${version}.zip" mochi-extension.zip)
echo "dist/mochi-extension.zip (v${version})"
