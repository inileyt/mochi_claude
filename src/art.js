/*
 * Mochi — the character, as pixel art.
 *
 * Mochi is drawn on a 40 × 40 pixel grid (one SVG unit = one art pixel) with
 * crisp edges and a flat palette: no gradients, no curves. Every part is a set
 * of whole pixels, and every animation in styles.js moves parts by whole
 * pixels, so the art stays on the grid in every frame.
 *
 * The body is a 16 × 15 square with stepped (softened) corners. One SVG holds
 * every eye, mouth, brow and effect sprite; a mood is a "face recipe" naming
 * which are shown (MOODS below). Restyle Mochi by editing PALETTE or the
 * sprites; change a mood's face by editing MOODS.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  // Warm orange / amber palette (flat colors only).
  const PALETTE = {
    outline: '#55230d',
    shade: '#c95d24',
    base: '#ef8140',
    light: '#f9a35c',
    highlight: '#ffd8a3',
    amber: '#f7b23b',
    gold: '#ffe08a',
    ink: '#2b1208',
    shine: '#fff6e6',
    blush: '#ff8c7a',
    mouthIn: '#8f2414',
    tongue: '#ff7f6e',
    bubble: '#fff6e6',
    think: '#a8461a',
    zzz: '#8ea2e0',
    alert: '#ff5a2e',
    heart: '#ff6f8e',
    tear: '#7fd0ff',
    shadow: '#4a1f0c',
  };
  const C = PALETTE;

  // ——— pixel helpers ———
  /** Every pixel of the rectangle x1..x2, y1..y2 (inclusive). */
  const box = (x1, x2, y1, y2) => {
    const out = [];
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) out.push([x, y]);
    return out;
  };
  /** One <path> drawing a list of pixels in one color. */
  // A color can be a CSS variable ("var(--m-base)"): presentation attributes can't hold
  // var(), so those go into style="fill: …". That's how Mochi is recolored by role.
  const px = (list, color, cls = '', extra = '') =>
    `<path${cls ? ` class="${cls}"` : ''} ${String(color).startsWith('var(') ? `style="fill:${color}"` : `fill="${color}"`}${extra} d="${list.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join('')}"/>`;
  /** A sprite from text rows: each character maps to a color through `legend`; '.' is empty. */
  const sprite = (rows, x0, y0, legend, cls = '') => {
    const byColor = new Map();
    rows.forEach((row, dy) => [...row].forEach((ch, dx) => {
      const color = legend[ch];
      if (!color) return;
      if (!byColor.has(color)) byColor.set(color, []);
      byColor.get(color).push([x0 + dx, y0 + dy]);
    }));
    return `<g${cls ? ` class="${cls}"` : ''}>${[...byColor].map(([color, list]) => px(list, color)).join('')}</g>`;
  };

  // Body colors by role. The values live in CSS variables (styles.js), so a
  // color theme recolors every pose, face, outfit and effect without new sprites.
  const ROLE = {
    outline: 'var(--m-outline)', shade: 'var(--m-shade)', base: 'var(--m-base)',
    light: 'var(--m-light)', highlight: 'var(--m-highlight)', accent: 'var(--m-accent)', accentLight: 'var(--m-accent-light)', ink: 'var(--m-ink)',
  };
  const ROLE_DEFAULTS = {
    outline: C.outline, shade: C.shade, base: C.base, light: C.light, highlight: C.highlight, accent: C.amber, accentLight: C.gold, ink: C.ink,
  };
  const BODY_LEGEND = { O: ROLE.outline, H: ROLE.highlight, L: ROLE.light, B: ROLE.base, D: ROLE.shade };
  // 16 × 15, top-left at (12, 17). Stepped corners keep it square but soft.
  const BODY = [
    '..OOOOOOOOOOOO..',
    '.OHHLLLLLLLLLLO.',
    'OHHLBBBBBBBBBBDO',
    'OHLBBBBBBBBBBBDO',
    'OLBBBBBBBBBBBBDO',
    'OLBBBBBBBBBBBBDO',
    'OLBBBBBBBBBBBBDO',
    'OLBBBBBBBBBBBBDO',
    'OLBBBBBBBBBBBBDO',
    'OLBBBBBBBBBBBBDO',
    'OLBBBBBBBBBBBBDO',
    'OLBBBBBBBBBBBBDO',
    'OBBBBBBBBBBBBDDO',
    '.ODDDDDDDDDDDDO.',
    '..OOOOOOOOOOOO..',
  ];
  const ARM = ['.OO.', 'OLBO', 'OBBO', 'OBDO', '.OO.'];
  const LEG = ['OBBO', 'ODDO', '.OO.'];
  const ANTENNA = ['.AA.', 'AGAA', 'AAAA', '.AA.', '.OO.', '.OO.'];
  const ANT_LEGEND = { A: ROLE.accent, G: ROLE.accentLight, O: ROLE.outline };

  // Small pixel glyphs for effects.
  const GLYPH = {
    q: ['###', '..#', '.#.', '...', '.#.'],
    bang: ['#', '#', '#', '.', '#'],
    z3: ['###', '.#.', '###'],
    z4: ['####', '..#.', '.#..', '####'],
    z5: ['#####', '...#.', '..#..', '.#...', '#####'],
    heart: ['.#.#.', '#####', '#####', '.###.', '..#..'],
    heartS: ['#.#', '###', '.#.'],
    note: ['..##', '..#.', '..#.', '###.', '##..'],
    plus: ['.#.', '#*#', '.#.'],
    dot: ['*'],
    // UI scan: a magnifying glass (# frame, * lens, + shine), the pocket and its card, a check mark.
    magnifier: ['.###...', '#**+#..', '#***#..', '#***#..', '.###...', '....#..', '.....#.', '......#'],
    pouch: ['O######O', 'ODDDDDDO', 'OD.##.DO', 'ODDDDDDO', '.OOOOOO.'],
    card: ['OOOO', 'OPPO', 'OAAO', 'OOOO'],
    check: ['....#', '...##', '#.##.', '###..', '.#...'],
    cup: ['O..O', 'OWWO', 'OWWO', '.OO.'],
    // Idle antics unlocked by levels: a juggled star, a tiny book.
    star: ['..#..', '.###.', '#####', '.#.#.'],
    book: ['OOOOOOOOO', 'OPPPOPPPO', 'OPLPOPLPO', 'OPPPOPPPO', 'OOOOOOOOO'],
  };
  const glyph = (name, x, y, color, cls = '', core = color) => sprite(GLYPH[name], x, y, { '#': color, '*': core }, cls);

  // ——— face sprites (coordinates on the 40 grid) ———
  const eyesOpen = `
    <g class="eye-px">${px([...box(15, 16, 22, 24), ...box(23, 24, 22, 24)], ROLE.ink)}${px([[16, 22], [24, 22]], C.shine)}
      ${px([[15, 24], [23, 24]], C.shine, 'eyestar')}</g>
    ${px([...box(15, 16, 23, 23), ...box(23, 24, 23, 23)], ROLE.ink, 'lid')}
    <g class="tired-lids">${px([...box(15, 16, 22, 22), ...box(23, 24, 22, 22)], ROLE.base)}${px([[14, 23], [25, 23]], ROLE.ink)}</g>
    <g class="tired-bags">${px([[15, 25], [16, 25], [23, 25], [24, 25]], ROLE.shade)}</g>`;
  const eyesWide = `
    <g class="eye-px">${px([...box(14, 16, 21, 24), ...box(23, 25, 21, 24)], ROLE.ink)}${px([[14, 21], [15, 21], [14, 22], [23, 21], [24, 21], [23, 22]], C.shine)}</g>
    ${px([...box(14, 16, 23, 23), ...box(23, 25, 23, 23)], ROLE.ink, 'lid')}`;
  const eyesHappy = px([[14, 23], [15, 22], [16, 22], [17, 23], [22, 23], [23, 22], [24, 22], [25, 23]], ROLE.ink);
  const eyesClosed = px([[14, 23], [15, 24], [16, 24], [17, 23], [22, 23], [23, 24], [24, 24], [25, 23]], ROLE.ink);
  const eyesSad = `
    <g class="eye-px">${px([...box(15, 16, 23, 24), ...box(23, 24, 23, 24)], ROLE.ink)}${px([[16, 23], [24, 23]], C.shine)}</g>
    ${px([...box(15, 16, 24, 24), ...box(23, 24, 24, 24)], ROLE.ink, 'lid')}
    ${px([[14, 25], [14, 26]], C.tear, 'tear')}`;

  const brows = {
    up: [[14, 20], [15, 19], [16, 19], [23, 19], [24, 19], [25, 20]],
    sad: [[14, 22], [15, 21], [16, 20], [23, 20], [24, 21], [25, 22]],
    think: [[15, 21], [16, 21], [23, 19], [24, 19], [25, 20]],
    curious: [[14, 20], [15, 19], [16, 19], [23, 21], [24, 21]],
  };

  const mouths = {
    cat: px([[17, 27], [18, 28], [19, 27], [20, 27], [21, 28], [22, 27]], ROLE.ink),
    smile: px([[17, 27], [18, 28], [19, 28], [20, 28], [21, 28], [22, 27]], ROLE.ink),
    big: px([...box(17, 22, 27, 27), [17, 28], [22, 28], [18, 29], [21, 29], [19, 30], [20, 30]], ROLE.ink) +
      px(box(18, 21, 28, 28), C.mouthIn) + px([[19, 29], [20, 29]], C.tongue),
    o: px([[19, 27], [20, 27], [18, 28], [21, 28], [18, 29], [21, 29], [19, 30], [20, 30]], ROLE.ink) + px(box(19, 20, 28, 29), C.mouthIn),
    'small-o': px(box(19, 20, 28, 29), ROLE.ink),
    frown: px([[17, 30], [18, 29], [19, 28], [20, 28], [21, 29], [22, 30]], ROLE.ink),
    wavy: px([[19, 28], [20, 28], [21, 28], [22, 27]], ROLE.ink),
  };

  // Face recipes. eyes: open | wide | happy | closed | sad
  // mouth: cat | smile | big | o | small-o | frown | wavy
  // brows: none | up | sad | think | curious
  // fx: space separated — eyestars sparkles sparkles-soft think dots question exclaim zzz heart love note dizzy
  // look: default gaze; the companion turns it into whole-pixel steps.
  const MOODS = {
    neutral: { eyes: 'open', mouth: 'cat', brows: 'none', fx: '', look: [0, 0] },
    happy: { eyes: 'open', mouth: 'big', brows: 'none', fx: 'eyestars sparkles-soft', look: [0, -1] },
    thinking: { eyes: 'open', mouth: 'wavy', brows: 'think', fx: 'think', look: [5, -5] },
    focused: { eyes: 'open', mouth: 'cat', brows: 'none', fx: 'dots', look: [-6, 1] },
    curious: { eyes: 'open', mouth: 'small-o', brows: 'curious', fx: 'question', look: [-6, 0] },
    sad: { eyes: 'sad', mouth: 'frown', brows: 'sad', fx: 'heart', look: [0, 0] },
    surprised: { eyes: 'wide', mouth: 'o', brows: 'up', fx: 'exclaim', look: [0, -3] },
    excited: { eyes: 'happy', mouth: 'big', brows: 'none', fx: 'sparkles', look: [0, -2] },
    sleeping: { eyes: 'closed', mouth: 'small-o', brows: 'none', fx: 'zzz', look: [0, 2] },
  };

  const LABELS = {
    neutral: 'chilling',
    happy: 'happy',
    thinking: 'thinking',
    focused: 'focused',
    curious: 'curious',
    sad: 'here for you',
    surprised: 'surprised',
    excited: 'excited',
    sleeping: 'sleeping',
  };

  /**
   * Mochi's own body parts. A character (src/characters/*.js) can swap any of
   * them; the face, the animations, the effects and the outfit layers stay
   * shared, so every character gets all of Mochi's moods for free.
   *   legs · top (antenna, ears…) · back (behind the body: a tail) · body ·
   *   armL · armR · faceExtra (inside the face: whiskers) · front (over all)
   */
  const MOCHI_PARTS = {
    legs: sprite(LEG, 14, 32, BODY_LEGEND, 'leg leg-l') + sprite(LEG, 22, 32, BODY_LEGEND, 'leg leg-r'),
    top: sprite(ANTENNA, 18, 11, ANT_LEGEND) + px([[19, 12]], C.shine, 'spark-glow'),
    back: '',
    body: sprite(BODY, 12, 17, BODY_LEGEND),
    armL: sprite(ARM, 8, 23, BODY_LEGEND),
    armR: sprite(ARM, 28, 23, BODY_LEGEND),
    faceExtra: '',
    front: '',
  };

  const svg = (parts = MOCHI_PARTS) => {
    const P = { ...MOCHI_PARTS, ...parts };
    return `
<svg class="mochi-svg" viewBox="0 0 40 40" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <g class="ground-shadow">${px(box(13, 26, 35, 35), C.shadow, '', ' opacity=".22"')}${px(box(15, 24, 36, 36), C.shadow, '', ' opacity=".1"')}</g>

  <g class="action-wrap">
  <g class="mood-wrap">
    <g class="legs">${P.legs}</g>
    <g class="upper">
      <g class="back">${P.back}</g>
      <g class="sprout">${P.top}</g>
      <g class="body">${P.body}</g>
      <g class="arm arm-l">${P.armL}</g>
      <g class="arm arm-r">${P.armR}</g>

      <g class="face">
        ${P.faceExtra}
        <g class="cheek">${px([[13, 26], [14, 26], [25, 26], [26, 26]], C.blush)}</g>
        <g class="brows">
          ${Object.entries(brows).map(([name, list]) => px(list, ROLE.ink, `part brows-${name}`)).join('')}
        </g>
        <g class="eyes"><g class="pupils">
          <g class="part eyes-open">${eyesOpen}</g>
          <g class="part eyes-wide">${eyesWide}</g>
          <g class="part eyes-happy">${eyesHappy}</g>
          <g class="part eyes-closed">${eyesClosed}</g>
          <g class="part eyes-sad">${eyesSad}</g>
        </g></g>
        <g class="mouths">
          ${Object.entries(mouths).map(([name, d]) => `<g class="part mouth-${name}">${d}</g>`).join('')}
        </g>
        <g class="outfit-layer" data-slot="face"></g>
      </g>
      <g class="outfit-layer" data-slot="neck"></g>
      <g class="outfit-layer" data-slot="head"></g>
      <g class="front">${P.front}</g>
    </g>
  </g>
  </g>

  <g class="fx">
    <g class="part fx-sparkles">
      ${glyph('plus', 5, 13, C.amber, 'sparkle s1', C.gold)}${glyph('plus', 33, 11, C.amber, 'sparkle s2', C.gold)}
      ${glyph('plus', 35, 25, C.amber, 'sparkle s3', C.gold)}${glyph('plus', 3, 27, C.amber, 'sparkle s4', C.gold)}
      ${glyph('dot', 30, 5, C.gold, 'sparkle s5')}${glyph('dot', 9, 7, C.gold, 'sparkle s2')}
    </g>
    <g class="part fx-sparkles-soft">
      ${glyph('plus', 5, 14, C.amber, 'sparkle s1', C.gold)}${glyph('plus', 33, 12, C.amber, 'sparkle s3', C.gold)}
    </g>
    <g class="part fx-think">
      ${px([[30, 15]], C.bubble, 'tb1')}
      ${px(box(31, 32, 12, 13), C.bubble, 'tb2')}
      <g class="tb3">
        ${px([...box(32, 38, 1, 1), ...box(32, 38, 9, 9), ...box(31, 31, 2, 8), ...box(39, 39, 2, 8)], '#d9b48f')}
        ${px(box(32, 38, 2, 8), C.bubble)}
        ${glyph('q', 34, 3, C.think)}
      </g>
    </g>
    <g class="part fx-dots">
      ${px([[31, 18]], C.think, 'd1')}${px([[33, 18]], C.think, 'd2')}${px([[35, 18]], C.think, 'd3')}
    </g>
    <g class="part fx-question">${glyph('q', 31, 10, C.think)}</g>
    <g class="part fx-exclaim">
      ${glyph('bang', 32, 9, C.alert)}
      ${px([[8, 16], [7, 15], [9, 12], [8, 11], [6, 20], [5, 20]], C.alert)}
    </g>
    <g class="part fx-zzz">
      ${glyph('z3', 29, 13, C.zzz, 'z1')}${glyph('z4', 32, 7, C.zzz, 'z2')}${glyph('z5', 34, 0, C.zzz, 'z3')}
    </g>
    <g class="part fx-heart">${glyph('heart', 31, 12, C.heart, 'heart-shape')}</g>
    <g class="part fx-love">
      ${glyph('heart', 17, 5, C.heart, 'h1')}${glyph('heartS', 8, 10, C.heart, 'h2')}${glyph('heartS', 29, 9, C.heart, 'h3')}
    </g>
    <g class="part fx-note">${glyph('note', 31, 10, C.think)}</g>
    <g class="part fx-dizzy">
      ${glyph('plus', 13, 12, C.amber, 'dz1', C.gold)}${glyph('plus', 24, 12, C.zzz, 'dz2', C.shine)}
    </g>
    <g class="part fx-magnifier">
      <g class="mag">${sprite(GLYPH.magnifier, 9, 19, { '#': C.ink, '*': '#bfe6ff', '+': C.shine })}</g>
      ${px([[7, 15], [8, 14], [6, 13]], C.think, 'sniff s1')}${px([[31, 16], [32, 15], [33, 16]], C.think, 'sniff s2')}
    </g>
    <g class="part fx-cup"><g class="cup">${sprite(GLYPH.cup, 32, 27, { O: C.ink, W: '#8fd3ff' })}</g></g>
    <g class="part fx-juggle"><g class="jstar">${sprite(GLYPH.star, 18, 9, { '#': C.gold })}</g></g>
    <g class="part fx-book"><g class="book">${sprite(GLYPH.book, 15, 29, { O: ROLE.outline, P: '#fff6e6', L: '#c9a27a' })}</g></g>
    <g class="part fx-pocket">
      <g class="pouch">${sprite(GLYPH.pouch, 16, 27, { O: ROLE.outline, D: ROLE.shade, '#': ROLE.accent })}</g>
      <g class="drop">${sprite(GLYPH.card, 18, 4, { O: ROLE.outline, P: C.heart, A: ROLE.accent })}</g>
      <g class="tick">${sprite(GLYPH.check, 31, 10, { '#': '#6fd08c' })}</g>
    </g>
  </g>
</svg>`;
  };

  /**
   * A still picture of Mochi (no CSS needed): for the share card, previews and
   * the outfit editor. face: a mood name; outfits: [{ slot, markup, hide }];
   * colors: role → hex (defaults to the classic orange).
   */
  let stillCount = 0;
  function staticSvg({ mood = 'happy', outfits = [], colors = {}, size = 160, withShadow = true, parts } = {}) {
    const face = MOODS[mood] || MOODS.neutral;
    const roles = { ...ROLE_DEFAULTS, ...colors };
    let out = svg(parts);
    for (const item of outfits) out = out.replace(`<g class="outfit-layer" data-slot="${item.slot}"></g>`, `<g class="outfit-layer" data-slot="${item.slot}">${item.markup}</g>`);
    const hide = new Set(outfits.flatMap(o => o.hide || []));
    // CSS variables → the actual colors.
    out = out.replace(/var\(--m-([a-z-]+)\)/g, (m, role) => roles[role.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] || m);
    const showParts = [`eyes-${face.eyes}`, `mouth-${face.mouth}`, face.brows !== 'none' ? `brows-${face.brows}` : null].filter(Boolean);
    // The CSS is scoped to this one picture: a <style> inside inline SVG would
    // otherwise apply to everything around it (Mochi himself included).
    const scope = `mochi-still-${++stillCount}`;
    const hidden = ['.part', '.lid', '.eyestar', '.tear', '.tired-lids', '.tired-bags', ...(hide.has('antenna') ? ['.sprout'] : []), ...(withShadow ? [] : ['.ground-shadow'])];
    const css = `${hidden.map(c => `.${scope} ${c}`).join(',')}{display:none}${showParts.map(c => `.${scope} .${c}`).join(',')}{display:inline}`;
    return out
      .replace('<svg class="mochi-svg"', `<svg class="${scope}" width="${size}" height="${size}"`)
      .replace(/aria-hidden="true" focusable="false">/, `><style>${css}</style>`);
  }

  Mochi.art = { svg, staticSvg, MOODS, LABELS, PALETTE, ROLE, ROLE_DEFAULTS, MOCHI_PARTS, BODY_LEGEND, GRID: 40, px, sprite, box, glyph, GLYPH };
})();
