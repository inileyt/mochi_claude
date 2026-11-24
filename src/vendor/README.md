# Bundled libraries (Image Scan)

Shipped inside the extension so nothing is fetched from the web at run time.
`dev/vendor.sh` fetches them again (for updates).

| Folder | What | Version | License |
|---|---|---|---|
| `tesseract/worker.min.js`, `tesseract.min.js` | [tesseract.js](https://github.com/naptha/tesseract.js) OCR (worker + API) | 7.0.0 | Apache-2.0 (`LICENSE-tesseract.js.md`) |
| `tesseract/tesseract-core-simd-lstm.*` | [tesseract.js-core](https://github.com/naptha/tesseract.js-core), the WASM build of Tesseract (SIMD, LSTM engine only) | 6.1.2 | Apache-2.0 (`LICENSE-tesseract.js-core`) |
| `tesseract/lang/eng, rus, hye.traineddata.gz` | [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) English, Russian and Armenian models (gzipped) | main | Apache-2.0 (`lang/LICENSE-tessdata_fast`) |
| `fonts/*.woff2` | 44 Google Fonts via [Fontsource](https://fontsource.org) 5.3.0, Latin + Cyrillic subsets | 5.3.0 | SIL OFL 1.1; Roboto Slab Apache-2.0 (`fonts/LICENSE-*`) |

Fonts: Inter, Roboto, Montserrat, Poppins, Open Sans, Lato, Rubik, Oswald, Bebas Neue, Anton,
Playfair Display, Merriweather, Lora, DM Serif Display, Roboto Slab, Space Mono, JetBrains Mono,
Pacifico, Caveat, Lobster, Nunito, Work Sans, Raleway, Manrope, Source Sans 3, Mulish, DM Sans,
PT Sans, Noto Serif, PT Serif, Libre Baskerville, EB Garamond, Cormorant, Bitter, Comfortaa,
Fredoka, Archivo Black, Fjalla One, Fira Code, Roboto Mono, IBM Plex Mono, Dancing Script,
Satisfy, Shadows Into Light (the list Mochi uses: `src/image-scan/fonts.js`).
