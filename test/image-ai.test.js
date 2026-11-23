/*
 * Image Scan: the on-device description (Prompt API), with a fake LanguageModel.
 *   node test/image-ai.test.js
 */
const assert = require('node:assert/strict');
const AI = require('../src/image-scan/ai.js');

(async () => {
  // No API at all → unavailable, quietly.
  delete globalThis.LanguageModel;
  assert.equal((await AI.status()).available, 'unavailable');
  assert.equal((await AI.describe({ width: 10, height: 10 })).available, 'unavailable');

  // The answer is cleaned: a code fence, extra spaces, too many objects, a missing field.
  const d = AI.normalize('```json\n{"subject":"  a red  bicycle ","objects":["tree","bench","sky","a","b","c","d","e","f","g","h","i","j","k"],"setting":"park","style":"photo","lighting":"golden hour","mood":"calm","composition":"centered","caption":"A red bicycle leans on a tree."}\n```');
  assert.equal(d.subject, 'a red bicycle');
  assert.equal(d.objects.length, 12);
  assert.equal(d.camera, '');
  assert.throws(() => AI.normalize('{"objects":[]}'), /empty-description/);
  assert.deepEqual(AI.SCHEMA.required, AI.FIELDS);

  // A fake model: available, answers JSON that follows the schema; the image goes in as an image part.
  const FIXED = { subject: 'a summer sale poster', objects: ['sun', 'palm leaves'], setting: 'flat background', style: 'flat illustration', lighting: 'even, bright', mood: 'cheerful', composition: 'centered headline', camera: 'straight-on', caption: 'A bright poster announcing a summer sale.' };
  const seen = {};
  globalThis.createImageBitmap = async () => ({ close() { seen.closed = true; } });
  globalThis.LanguageModel = {
    availability: async opts => { seen.opts = opts; return 'available'; },
    create: async opts => ({
      prompt: async (messages, options) => { seen.messages = messages; seen.constraint = options.responseConstraint; return JSON.stringify(FIXED); },
      destroy() { seen.destroyed = true; },
    }),
  };
  const r = await AI.describe({ width: 1600, height: 900 });
  assert.equal(r.available, 'available');
  assert.deepEqual(r.description, FIXED);
  assert.ok(seen.opts.expectedInputs.some(i => i.type === 'image'), 'asks for image input');
  assert.equal(seen.messages[0].content[1].type, 'image');
  assert.equal(seen.constraint, AI.SCHEMA, 'structured output');
  assert.ok(seen.destroyed && seen.closed, 'session and bitmap released');

  // Needs a download: describe() never starts one (that needs the user's click on Mochi's page).
  let created = false;
  globalThis.LanguageModel = { availability: async () => 'downloadable', create: async () => { created = true; } };
  assert.equal((await AI.describe({ width: 10, height: 10 })).available, 'downloadable');
  assert.equal(created, false, 'no download without asking');

  // A model that fails → an error, not a crash.
  globalThis.LanguageModel = { availability: async () => 'available', create: async () => ({ prompt: async () => 'not json', destroy() {} }) };
  assert.ok((await AI.describe({ width: 10, height: 10 })).error);
  console.log('ok   on-device description: unavailable / available (fake model, schema, image part) / downloadable (no auto download) / bad answer');
})().catch(err => { console.error(err); process.exit(1); });
