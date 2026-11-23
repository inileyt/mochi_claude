// Draws docs/gifs/wardrobe.png: every character, then some of them dressed up (for the README).
//   node dev/wardrobe-picture.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1000, height: 290 }, deviceScaleFactor: 2 });
  await p.setContent('<body style="margin:0;padding:18px 10px;background:#fff6e6;font:600 12px ui-monospace,monospace;color:#55230d"><div id="a" style="display:flex;justify-content:center;flex-wrap:wrap"></div><div id="b" style="display:flex;justify-content:center;flex-wrap:wrap;margin-top:10px"></div></body>');
  await p.addScriptTag({ content: 'window.Mochi={features:[],t:k=>k,tPick:k=>k,debugHooks:{},settings:{define(){},get(){return {}},onChange(){}},menu:{addView(){},addSetting(){},addItem(){}},store:{today:()=>"2026-06-01"}};' });
  const order = JSON.parse(fs.readFileSync(path.join(R, 'manifest.json'), 'utf8')).content_scripts[0].js.filter(f => f.startsWith('src/characters/'));
  for (const f of ['src/art.js', 'src/outfits.js', ...order]) await p.addScriptTag({ path: path.join(R, f) });
  const en = fs.readFileSync(path.join(R, 'src/locales/en.js'), 'utf8');
  const names = Object.fromEntries([...en.matchAll(/'(char\.\w+\.name)': ['"]([^'"]+)['"]/g)].map(m => [m[1], m[2]]));
  await p.evaluate(({ names }) => {
    const cell = (where, c, ids, label) => {
      const outfits = ids.map(id => Mochi.outfits.byId(id)).map(o => ({ slot: o.slot, markup: Mochi.outfits.markup(o), hide: o.hide || [] }));
      const d = document.createElement('div');
      d.style.cssText = 'text-align:center;width:104px';
      d.innerHTML = Mochi.art.staticSvg({ mood: 'happy', parts: c.parts, colors: c.colors, outfits, size: 104 }) + `<div>${label}</div>`;
      document.getElementById(where).append(d);
    };
    for (const c of Mochi.characters.all()) cell('a', c, [], names[c.name] || c.id);
    const C = id => Mochi.characters.get(id);
    for (const [id, ids] of [['mochi', ['crown', 'cape']], ['fox', ['round-glasses', 'bow-tie']], ['penguin', ['top-hat', 'bow-tie']], ['bear', ['cap', 'overalls']], ['cloud', ['heart-glasses']], ['bunny', ['tutu']], ['cat', ['cowboy-hat']], ['robot', ['3d-glasses']], ['mochi', ['beanie', 'nerd-glasses']]]) cell('b', C(id), ids, '');
  }, { names });
  const out = path.join(R, 'docs/gifs/wardrobe.png');
  await p.screenshot({ path: out, fullPage: true });
  await b.close();
  console.log('wrote', path.relative(R, out));
})();
