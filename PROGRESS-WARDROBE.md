# PROGRESS — 1.32.0: new friends + a bigger wardrobe

Branch `feature/wardrobe-friends` (from `feature/bug-reporter-svg`; #8 and #9 aren't merged yet).
Inna asked: new characters (fox, penguin, bear cub, cloud, bunny) and more things in the wardrobe
(clothes, hats, glasses).

## Design (decided up front)

- Characters use the existing registry (`src/characters/*.js`): only their own parts, colors, lines and
  antics; moods, face, animations and outfits are shared. Each one gets a personality:
  - **bunny** (level 2): long ears (one bent), pink nose, fluffy tail that wags; double hop + a carrot when bored.
  - **penguin** (4): white tummy, orange beak and feet, flippers; waddles; a fish when bored; extra happy in winter.
  - **fox** (5): pointy ears with dark tips, white chin, bushy tail that swishes; pounces; sometimes finds a long answer "clever".
  - **bear cub** (8): round ears, light muzzle; sleepy (naps after 90 s); honey when bored.
  - **cloud** (12): floats (no legs); wears its mood as weather: a rainbow when happy, rain when sad (pure CSS on `data-mood`).
- Load order = unlock order, so the friends grid reads by level. `progress.js` announces each one.
- New fx sprites in `art.js`: honey, carrot, fish, rain, rainbow.
- Wardrobe: a 4th slot **body** (clothes), drawn over the body and under the face/arms. An outfit may also
  have a `back` part drawn behind the body (the cape). Wardrobe grouped by slot with headers.
- 15 new items: hats (beanie, flower crown, cap, cowboy hat, top hat, crown), glasses (round, heart,
  nerd, 3D, monocle), neck (bow tie), clothes (overalls, tutu, superhero cape). Several at level 1.
- Online friends: the look sent online stays at 3 outfit ids (the deployed Firestore rules allow ≤ 3), so
  clothes don't show on a friend's screen yet (see Questions).

## Tasks

- [x] **C1. Characters** — 5 files, colors, parts, lines, antics, CSS (tail wag, waddle, float, weather).
- [x] **W1. Wardrobe** — body slot + back layer, 15 items, grouped view, clothes thumbnails on a faint body, editor slot.
- [x] **T. Tests** — `test/outfits.test.js` (data + characters + cape behind), smoke group `wardrobe` (6).
- [x] **F. Finish 1.32** — locales ×11 (done with C1/W1), README + gallery picture, version, full run, PR.

## Notes

- **C1/W1** — Art checked big in a preview (all moods, every item on Mochi). Clothes thumbnails show the
  item on a faint body (else a tutu is a pink line); the cape's thumbnail puts its back part behind it.
  `staticSvg` (share card, previews) and `companion.setOutfit` both move `.outfit-back` parts into the
  back layer. 68 new locale keys × 11 languages.
- **T** — `node test/outfits.test.js`: 23 outfits (11 head, 6 face, 3 neck, 3 body), 9 characters. Smoke
  `wardrobe`: level gates (bunny at 2 … cloud at 12, "next unlock"), each character draws in its colors
  and runs its antic (carrot, fish, honey seen), cloud rain/rainbow by mood, grouped wardrobe with one item
  per slot worn and the cape behind, take everything off (body too), editor accepts a body item, no errors.
- **F** — README section 'New friends and a bigger wardrobe (v1.32)' with `docs/gifs/wardrobe.png` (drawn by `dev/wardrobe-picture.cjs`), Wardrobe/Friends/Outfit format updated; version 1.32.0, release-notes/1.32.0.md, whatsNew.1_32_0 × 11. Full smoke run: **158 passed, 0 failed**.

## Summary 1.32 (done)

Five new characters with their own habits (bunny, penguin, fox, bear cub, cloud with weather moods) and a bigger wardrobe: a clothes slot, a cape drawn behind the body, 15 new hats/glasses/clothes, grouped by slot. 158/158 smoke checks.

## Questions for Inna

- Online friends see head, glasses and neck items, not clothes yet: showing clothes needs the Firestore
  rules (`online/firestore.rules`, `outfit.size() <= 3`) raised to 4 and deployed. Want me to do that?
