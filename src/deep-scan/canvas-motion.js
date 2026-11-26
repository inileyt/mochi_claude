/*
 * Mochi — Deep Scan: canvas/WebGL motion, measured not guessed. What a <canvas> draws comes from
 * JavaScript and can't be read, but we can *watch* it: grab N frames, diff them, and say where it moves,
 * how much of it moves, and whether it loops. Pure functions (no DOM, no CDP) so they unit-test on
 * synthetic frames; media.js feeds them the real frames it captures with the debugger.
 *
 * A "frame" is an RGBA Uint8ClampedArray of length w*h*4 (as from getImageData), all the same w×h.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  /** Per-cell motion magnitude (0..255), averaged over consecutive frame pairs. grid[r*cols + c]. */
  function cellMotion(frames, w, h, cols, rows) {
    const grid = new Float64Array(cols * rows);
    if (frames.length < 2) return grid;
    const cw = w / cols, ch = h / rows;
    for (let f = 1; f < frames.length; f++) {
      const a = frames[f - 1], b = frames[f];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let sum = 0, n = 0;
          const x0 = Math.floor(c * cw), x1 = Math.floor((c + 1) * cw), y0 = Math.floor(r * ch), y1 = Math.floor((r + 1) * ch);
          for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
              const i = (y * w + x) * 4;
              sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
              n += 3;
            }
          }
          if (n) grid[r * cols + c] += sum / n;
        }
      }
    }
    const pairs = frames.length - 1;
    for (let i = 0; i < grid.length; i++) grid[i] /= pairs;
    return grid;
  }

  /** Connected cells above threshold → up to `max` bounding boxes (as fractions of the canvas). */
  function regions(grid, cols, rows, thresh, max = 3) {
    const on = i => grid[i] > thresh;
    const seen = new Uint8Array(cols * rows);
    const boxes = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const start = r * cols + c;
      if (seen[start] || !on(start)) continue;
      let minC = c, maxC = c, minR = r, maxR = r, cells = 0;
      const stack = [start];
      seen[start] = 1;
      while (stack.length) {
        const i = stack.pop(), ci = i % cols, ri = (i - ci) / cols;
        cells++;
        if (ci < minC) minC = ci; if (ci > maxC) maxC = ci; if (ri < minR) minR = ri; if (ri > maxR) maxR = ri;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nc = ci + dc, nr = ri + dr;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          const j = nr * cols + nc;
          if (!seen[j] && on(j)) { seen[j] = 1; stack.push(j); }
        }
      }
      boxes.push({ x: minC / cols, y: minR / rows, w: (maxC - minC + 1) / cols, h: (maxR - minR + 1) / rows, cells });
    }
    return boxes.sort((a, b) => b.cells - a.cells).slice(0, max).map(({ cells, ...b }) => ({ x: +b.x.toFixed(3), y: +b.y.toFixed(3), w: +b.w.toFixed(3), h: +b.h.toFixed(3) }));
  }

  /** A loop period, in frame steps, from the autocorrelation of a per-frame-pair signal — or null if no clear loop. */
  function period(signal) {
    const n = signal.length;
    if (n < 6) return null;
    const mean = signal.reduce((s, v) => s + v, 0) / n;
    const dev = signal.map(v => v - mean);
    const denom = dev.reduce((s, v) => s + v * v, 0);
    if (denom < 1e-9) return null;
    let best = null, bestScore = 0.35; // needs a reasonably strong peak
    for (let lag = 2; lag <= Math.floor(n / 2); lag++) {
      let sum = 0;
      for (let i = 0; i < n - lag; i++) sum += dev[i] * dev[i + lag];
      const score = sum / denom;
      if (score > bestScore) { bestScore = score; best = lag; }
    }
    return best;
  }

  /**
   * frames: RGBA arrays (same w×h). gapMs: time between frames. →
   * { movingFraction, regions:[{x,y,w,h}], periodMs|null, cols, rows }.
   */
  function analyze(frames, w, h, { gapMs = 120, cols = 16, rows = 12 } = {}) {
    cols = Math.max(2, Math.min(cols, w)); rows = Math.max(2, Math.min(rows, h));
    const grid = cellMotion(frames, w, h, cols, rows);
    const maxCell = Math.max(1, ...grid);
    const thresh = Math.max(4, maxCell * 0.25); // ignore sensor noise; a cell moves if it's a quarter of the busiest
    let moving = 0; for (const v of grid) if (v > thresh) moving++;
    const signal = [];
    for (let f = 1; f < frames.length; f++) { // global change per step, for the loop check
      let s = 0; const a = frames[f - 1], b = frames[f];
      for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      signal.push(s);
    }
    const lag = period(signal);
    return { movingFraction: +(moving / (cols * rows)).toFixed(3), regions: regions(grid, cols, rows, thresh), periodMs: lag ? Math.round(lag * gapMs) : null, cols, rows };
  }

  Mochi.deepCanvasMotion = { cellMotion, regions, period, analyze };
  if (typeof module !== 'undefined') module.exports = Mochi.deepCanvasMotion;
})();
