// lib/db.js and lib/crypto.js are both meant to be safe no-ops when
// unconfigured -- that's the whole point of the Postgres mirror being
// "best effort." These tests don't need a real database or a real key.
const { test } = require('node:test');
const assert = require('node:assert');

test('db.isEnabled() is false with no DATABASE_URL', () => {
  delete require.cache[require.resolve('../lib/db')];
  const prev = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const db = require('../lib/db');
  assert.equal(db.isEnabled(), false);
  if (prev !== undefined) process.env.DATABASE_URL = prev;
});

test('db.query() rejects cleanly (not a throw, not a crash) when unconfigured', async () => {
  delete require.cache[require.resolve('../lib/db')];
  delete process.env.DATABASE_URL;
  const db = require('../lib/db');
  await assert.rejects(() => db.query('select 1'), /not configured/);
});

test('crypto.isEnabled() is false with no APP_ENCRYPTION_KEY', () => {
  delete require.cache[require.resolve('../lib/crypto')];
  const prev = process.env.APP_ENCRYPTION_KEY;
  delete process.env.APP_ENCRYPTION_KEY;
  const c = require('../lib/crypto');
  assert.equal(c.isEnabled(), false);
  if (prev !== undefined) process.env.APP_ENCRYPTION_KEY = prev;
});

test('crypto encrypt/decrypt round-trips a real secret when a key is configured', () => {
  delete require.cache[require.resolve('../lib/crypto')];
  process.env.APP_ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes, hex
  const c = require('../lib/crypto');
  assert.equal(c.isEnabled(), true);
  const ciphertext = c.encrypt('pit-super-secret-token');
  assert.ok(Buffer.isBuffer(ciphertext));
  assert.notEqual(ciphertext.toString('utf8'), 'pit-super-secret-token'); // never stored in the clear
  assert.equal(c.decrypt(ciphertext), 'pit-super-secret-token');
  delete process.env.APP_ENCRYPTION_KEY;
});

test('crypto.decrypt() fails loudly on tampered ciphertext (auth tag mismatch)', () => {
  delete require.cache[require.resolve('../lib/crypto')];
  process.env.APP_ENCRYPTION_KEY = 'b'.repeat(64);
  const c = require('../lib/crypto');
  const ciphertext = c.encrypt('some-secret');
  ciphertext[ciphertext.length - 1] ^= 0xff; // flip a byte in the ciphertext
  assert.throws(() => c.decrypt(ciphertext));
  delete process.env.APP_ENCRYPTION_KEY;
});
