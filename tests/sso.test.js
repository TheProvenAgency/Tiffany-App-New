const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const auth = require('../lib/auth');

const SECRET = 'test-shared-secret';

// Mirrors exactly what the Proven Agency's /api/link-out route signs, so
// these tests exercise the real wire format rather than a stand-in.
function signToken(payload, secret) {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
  return `${payloadB64}.${signature}`;
}

function freshPayload(overrides) {
  return {
    slug: 'tiffany',
    email: 'nikki@provenagency.test',
    name: 'Nikki Elliott',
    exp: Date.now() + 60_000,
    ...overrides
  };
}

// ------------------------- verifySsoToken -------------------------

test('a validly signed, unexpired token verifies and returns its payload', () => {
  const token = signToken(freshPayload(), SECRET);
  const payload = auth.verifySsoToken(token, SECRET);
  assert.ok(payload);
  assert.equal(payload.email, 'nikki@provenagency.test');
  assert.equal(payload.slug, 'tiffany');
});

test('a token signed with the wrong secret is rejected', () => {
  const token = signToken(freshPayload(), 'a-different-secret');
  assert.equal(auth.verifySsoToken(token, SECRET), null);
});

test('an expired token is rejected even with a valid signature', () => {
  const token = signToken(freshPayload({ exp: Date.now() - 1000 }), SECRET);
  assert.equal(auth.verifySsoToken(token, SECRET), null);
});

test('a tampered payload (email swapped after signing) is rejected', () => {
  const token = signToken(freshPayload(), SECRET);
  const [payloadB64, signature] = token.split('.');
  const forged = Buffer.from(JSON.stringify(freshPayload({ email: 'attacker@evil.test' }))).toString('base64url');
  assert.equal(auth.verifySsoToken(`${forged}.${signature}`, SECRET), null);
});

test('a malformed token (no dot separator) is rejected', () => {
  assert.equal(auth.verifySsoToken('not-a-real-token', SECRET), null);
});

test('a token with garbage base64 payload is rejected without throwing', () => {
  assert.doesNotThrow(() => {
    assert.equal(auth.verifySsoToken('!!!not-base64!!!.deadbeef', SECRET), null);
  });
});

test('an empty or missing token is rejected', () => {
  assert.equal(auth.verifySsoToken('', SECRET), null);
  assert.equal(auth.verifySsoToken(null, SECRET), null);
  assert.equal(auth.verifySsoToken(undefined, SECRET), null);
});

test('verification fails closed when no secret is configured', () => {
  const token = signToken(freshPayload(), SECRET);
  assert.equal(auth.verifySsoToken(token, ''), null);
  assert.equal(auth.verifySsoToken(token, undefined), null);
});

test('a payload missing email is rejected', () => {
  const token = signToken(freshPayload({ email: undefined }), SECRET);
  assert.equal(auth.verifySsoToken(token, SECRET), null);
});

// ------------------------- findOrCreateSsoUser -------------------------

test('the first SSO login for an email provisions a new admin account', () => {
  const { users, user } = auth.findOrCreateSsoUser([], freshPayload());
  assert.equal(users.length, 1);
  assert.equal(user.role, 'admin');
  assert.equal(user.username, 'nikki@provenagency.test');
  assert.equal(user.name, 'Nikki Elliott');
  assert.equal(user.ssoOnly, true);
});

test('a repeat SSO login for the same email reuses the existing account', () => {
  const first = auth.findOrCreateSsoUser([], freshPayload());
  const second = auth.findOrCreateSsoUser(first.users, freshPayload());
  assert.equal(second.users.length, 1, 'must not create a second account');
  assert.equal(second.user.id, first.user.id);
});

test('email matching is case-insensitive', () => {
  const first = auth.findOrCreateSsoUser([], freshPayload({ email: 'Nikki@ProvenAgency.test' }));
  const second = auth.findOrCreateSsoUser(first.users, freshPayload({ email: 'nikki@provenagency.test' }));
  assert.equal(second.users.length, 1);
  assert.equal(second.user.id, first.user.id);
});

test('two different admins SSOing in get two separate accounts', () => {
  const a = auth.findOrCreateSsoUser([], freshPayload({ email: 'nikki@provenagency.test', name: 'Nikki' }));
  const b = auth.findOrCreateSsoUser(a.users, freshPayload({ email: 'other-admin@provenagency.test', name: 'Other Admin' }));
  assert.equal(b.users.length, 2);
  assert.notEqual(a.user.id, b.user.id);
});

test('an SSO-provisioned account has an unguessable random password on record', () => {
  const { user } = auth.findOrCreateSsoUser([], freshPayload());
  assert.ok(user.hash && user.salt);
});

// ------------------------- ssoOnly blocks password login -------------------------

test('an ssoOnly account cannot authenticate through the password form, even knowing its own hash is real', () => {
  const { users, user } = auth.findOrCreateSsoUser([], freshPayload());
  // Nobody actually knows the random password, but even simulating a correct
  // guess must fail closed because the account is ssoOnly.
  const rehash = auth.hashPassword('guessed-somehow');
  user.hash = rehash.hash;
  user.salt = rehash.salt;
  assert.equal(auth.authenticate(users, user.username, 'guessed-somehow'), null);
});

test('a normal (non-ssoOnly) account is unaffected and still logs in with its password', () => {
  const users = auth.ensureAdmin([], 'msfs2026');
  assert.ok(auth.authenticate(users, 'admin', 'msfs2026'));
});

// ------------------------- sessions carry viaSso -------------------------

test('a session created with viaSso:true resolves with that flag set', () => {
  const s = auth.createSessions();
  const token = s.create({ id: 'u1', role: 'admin' }, { viaSso: true });
  assert.equal(s.resolve(token).viaSso, true);
});

test('a normal session created without extra flags has no viaSso', () => {
  const s = auth.createSessions();
  const token = s.create({ id: 'u1', role: 'admin' });
  assert.equal(s.resolve(token).viaSso, undefined);
});
