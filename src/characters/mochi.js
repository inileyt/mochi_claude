/*
 * Mochi — the characters registry, and Mochi himself.
 *
 * A character only defines what makes it itself; the mood engine, the face,
 * the animations, the effects and the outfits are shared:
 *
 *   Mochi.characters.register({
 *     id: 'cat', name: 'char.cat.name', unlock: { level: 3 },
 *     colors: { outline, shade, base, light, highlight, accent, accentLight },  // by role
 *     parts: { legs, top, back, body, armL, armR, faceExtra, front },           // SVG on the 40×40 grid
 *                                                                              // (Mochi's are used for any left out)
 *     phrases: { hello: 'char.cat.hello', poke: 'char.cat.poke', … },         // locale keys (lists)
 *     moodMap: { excited: 'happy' },          // how it shows each mood
 *     sleepAfter: 60000,                       // naps sooner than Mochi (5 min)
 *     idle: [{ when: c => true, run: (c, engine) => … }],                       // its own idle antics
 *     onResponseEnd(text, el, c, engine) { return true if handled },          // its own reaction to Claude
 *     tick(c, engine, ctx) { … },                                             // every 5 s (night mode…)
 *   })
 *
 * Keep the face area free: eyes sit at y 22–24, the mouth at y 27–30.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const list = [];
  Mochi.characters = {
    register(char) { list.push(char); },
    get: id => list.find(c => c.id === id) || list[0],
    all: () => list.slice(),
  };

  Mochi.characters.register({
    id: 'mochi',
    name: 'char.mochi.name',
    unlock: { level: 1 },
    colors: { ...Mochi.art.ROLE_DEFAULTS },
    parts: Mochi.art.MOCHI_PARTS,
    phrases: null, // Mochi's own lines in config.js
  });
})();
