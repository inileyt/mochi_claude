/*
 * Tests for the secret phrases (English and Russian).
 *   node test/eggs.test.js
 */
const assert = require('node:assert/strict');
const path = require('node:path');
globalThis.Mochi = { features: [] };
require(path.join(__dirname, '../src/easter-eggs.js'));
const { lovesMochi } = globalThis.Mochi.eggs;

let passed = 0;
const expect = (text, want) => {
  try { assert.equal(lovesMochi(text), want); passed++; console.log(`ok   ${JSON.stringify(text)} → ${want}`); }
  catch { console.error(`FAIL ${JSON.stringify(text)} → ${!want}, wanted ${want}`); process.exitCode = 1; }
};
expect('I love you Mochi', true);
expect('i love you, mochi!!', true);
expect('I luv u Mochi', true);
expect('Mochi, I love you', true);
expect('люблю тебя, Mochi', true);
expect('Люблю тебя Мочи', true);
expect('Мочи, я тебя люблю', true);
expect('Te quiero, Mochi', true);
expect('Je t’aime Mochi', true);
expect('Ti amo Mochi', true);
expect('Ich liebe dich, Mochi', true);
expect('Eu te amo Mochi', true);
expect('Люблю тебе, Mochi', true);
expect('我爱你，Mochi', true);
expect('モチ、愛してる', true);
expect('Սիրում եմ քեզ, Mochi', true);
expect('I love you', false);
expect('I love mochi ice cream', false);
expect('Can you explain how I love you works in this song?', false);
expect('mochi recipe please', false);
console.log(`${passed} passed`);
