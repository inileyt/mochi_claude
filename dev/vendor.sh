#!/usr/bin/env bash
# Fetches the libraries Image Scan ships inside the extension (no CDN at run time):
#   src/vendor/tesseract/  tesseract.js 7.0.0 (worker) + tesseract.js-core 6.1.2 (SIMD + LSTM build)
#                          + eng / rus "fast" models from tesseract-ocr/tessdata_fast, gzipped
#   src/vendor/fonts/      44 Google Fonts (OFL / Apache) as woff2, Latin + Cyrillic, from @fontsource
# Run from anywhere; needs npm and curl. The result is committed, so this is only for updates.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=src/vendor
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# ——— Tesseract ———
mkdir -p "$OUT/tesseract/lang"
(cd "$TMP" && npm pack -q tesseract.js@7.0.0 tesseract.js-core@6.1.2 >/dev/null && for t in *.tgz; do mkdir -p "${t%.tgz}" && tar xzf "$t" -C "${t%.tgz}"; done)
cp "$TMP"/tesseract.js-7.0.0/package/dist/worker.min.js "$OUT/tesseract/"
cp "$TMP"/tesseract.js-7.0.0/package/dist/tesseract.min.js "$OUT/tesseract/"
cp "$TMP"/tesseract.js-7.0.0/package/LICENSE.md "$OUT/tesseract/LICENSE-tesseract.js.md" 2>/dev/null || cp "$TMP"/tesseract.js-7.0.0/package/LICENSE* "$OUT/tesseract/LICENSE-tesseract.js"
cp "$TMP"/tesseract.js-core-6.1.2/package/tesseract-core-simd-lstm.js "$OUT/tesseract/"
cp "$TMP"/tesseract.js-core-6.1.2/package/tesseract-core-simd-lstm.wasm "$OUT/tesseract/"
cp "$TMP"/tesseract.js-core-6.1.2/package/LICENSE "$OUT/tesseract/LICENSE-tesseract.js-core"
for l in eng rus; do
  curl -fsSL -o "$TMP/$l.traineddata" "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/$l.traineddata"
  gzip -9 -n -c "$TMP/$l.traineddata" > "$OUT/tesseract/lang/$l.traineddata.gz"
done
curl -fsSL -o "$OUT/tesseract/lang/LICENSE-tessdata_fast" "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/LICENSE"

# ——— fonts ———
mkdir -p "$OUT/fonts"
VARIABLE="inter roboto montserrat open-sans rubik oswald playfair-display merriweather lora roboto-slab jetbrains-mono caveat nunito work-sans raleway manrope source-sans-3 mulish dm-sans noto-serif eb-garamond cormorant bitter comfortaa fredoka fira-code roboto-mono dancing-script"
STATIC="poppins lato bebas-neue anton dm-serif-display space-mono pacifico lobster pt-sans pt-serif libre-baskerville archivo-black fjalla-one ibm-plex-mono satisfy shadows-into-light"
(cd "$TMP" && for f in $VARIABLE; do npm pack -q "@fontsource-variable/$f@5.3.0" >/dev/null; done && for f in $STATIC; do npm pack -q "@fontsource/$f@5.3.0" >/dev/null; done)
for t in "$TMP"/fontsource-*.tgz; do
  d="${t%.tgz}"; mkdir -p "$d" && tar xzf "$t" -C "$d"
  for f in "$d"/package/files/*-{latin,cyrillic}-{wght,400,700}-normal.woff2; do [ -f "$f" ] && cp "$f" "$OUT/fonts/"; done
  name=$(basename "$d" | sed -E 's/^fontsource-(variable-)?//; s/-5\.3\.0$//')
  cp "$d/package/LICENSE" "$OUT/fonts/LICENSE-$name"
done
du -sh "$OUT/tesseract" "$OUT/fonts"
