/*
 * Tests for the prompt coach's rules (English and Russian drafts).
 *   node test/coach.test.js
 */
const assert = require('node:assert/strict');
const path = require('node:path');
globalThis.Mochi = {
  settings: { define() {}, get() {} },
  menu: { addSetting() {} },
  features: [],
};
require(path.join(__dirname, '../src/prompt-coach.js'));
const { check } = globalThis.Mochi.coach;

let passed = 0;
const expect = (draft, want, opts) => {
  const got = check(draft, opts)?.id || null;
  try { assert.equal(got, want); passed++; console.log(`ok   ${JSON.stringify(draft)} → ${got}`); }
  catch { console.error(`FAIL ${JSON.stringify(draft)} → ${got}, wanted ${want}`); process.exitCode = 1; }
};

// English
expect('fix it', 'vague');
expect('help', 'vague');
expect('make it better', 'vague');
expect('hi', 'short');
expect('my code throws an error when I click save', 'error');
expect("this function doesn't work", 'code');
expect('this function doesn\'t work:\n```js\nfoo()\n```', null);
expect('TypeError: x is undefined at main (app.js:3)', null);
expect('explain this', 'reference', { newChat: true });
expect('explain this', null, { newChat: false });
expect('write a cover letter', 'goal');
expect('write a cover letter for a junior designer job at Figma', null);
expect('Write a short poem about autumn leaves', null);
expect('I want to plan a 3-day trip to Yerevan in May with my family, two kids, we like museums and food. What should we see each day?', null);
expect('', null);
expect('/help', null);
// Russian
expect('исправь', 'vague');
expect('помоги', 'vague');
expect('сделай лучше', 'vague');
expect('у меня ошибка в коде', 'error');
expect('мой код не работает', 'code');
expect('объясни это', 'reference', { newChat: true });
expect('напиши сопроводительное письмо', 'goal');
expect('напиши сопроводительное письмо для вакансии дизайнера', null);
expect('напиши статью чтобы объяснить детям фотосинтез', null);

console.log(`\n${passed} passed${process.exitCode ? ', some failed' : ''}`);
