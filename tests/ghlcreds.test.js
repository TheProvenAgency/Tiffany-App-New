// Guardrails for the GHL v2 credentials, so the Settings screen catches the
// common mix-ups (v1 key pasted, a token dropped into the Location field, a URL
// pasted) before any call goes to GoHighLevel.
const { test } = require('node:test');
const assert = require('node:assert');
const c = require('../lib/ghlcreds');

// ------------------------- location id extraction -------------------------

test('a pasted sub-account URL yields just the location id', () => {
  assert.equal(c.extractLocationId('https://app.gohighlevel.com/v2/location/ve9EPM428h8vShlRW1KT/dashboard'), 've9EPM428h8vShlRW1KT');
});

test('a bare location id passes through untouched', () => {
  assert.equal(c.extractLocationId('ve9EPM428h8vShlRW1KT'), 've9EPM428h8vShlRW1KT');
});

test('surrounding whitespace is trimmed', () => {
  assert.equal(c.extractLocationId('  ve9EPM428h8vShlRW1KT \n'), 've9EPM428h8vShlRW1KT');
});

// ------------------------- token kind -------------------------

test('a pit- token is accepted as v2', () => {
  const r = c.classifyToken('pit-1234abcd-5678-90ef-ghij-klmnopqrstuv');
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'v2');
});

test('a JWT is flagged as a v1 key with guidance to use the pit- token', () => {
  const r = c.classifyToken('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJsb2NhdGlvbl9pZCI6IngifQ.sig');
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'v1');
  assert.match(r.message, /pit-/);
});

test('an empty token is reported as missing', () => {
  assert.equal(c.classifyToken('').ok, false);
  assert.equal(c.classifyToken('').kind, 'empty');
});

test('a truncated pit- token is caught, not waved through', () => {
  // The exact silent failure from the real session: an 18-char fragment that
  // starts pit- and looks fine. A full token is 40 chars.
  const r = c.classifyToken('pit-4c158fe4-b7');
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'truncated');
  assert.match(r.message, /incomplete|truncat|whole/i);
});

test('a full-length pit- token passes', () => {
  const r = c.classifyToken('pit-4c158fe4-b7da-4869-ba83-d5ca3bd9d7df'); // 40 chars
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'v2');
});

// ------------------------- location id sanity -------------------------

test('a normal ~20-char id is accepted', () => {
  assert.equal(c.classifyLocationId('ve9EPM428h8vShlRW1KT').ok, true);
});

test('a pit- token in the location field is caught', () => {
  const r = c.classifyLocationId('pit-1234abcd-5678-90ef-ghij-klmnopqrstuv');
  assert.equal(r.ok, false);
  assert.match(r.message, /token/i);
});

test('a JWT in the location field is caught', () => {
  const r = c.classifyLocationId('eyJhbGciOiJIUzI1NiJ9.eyJ4IjoxfQ.sig');
  assert.equal(r.ok, false);
  assert.match(r.message, /token/i);
});

test('a 40-char value is rejected as too long for a location id', () => {
  // This is the exact failure from the real session: a token length in the
  // location slot.
  const r = c.classifyLocationId('abcdefghijklmnopqrstuvwxyz0123456789ABCD');
  assert.equal(r.ok, false);
});

test('an empty location id is reported as missing', () => {
  assert.equal(c.classifyLocationId('').ok, false);
});
