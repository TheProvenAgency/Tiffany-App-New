const { test } = require('node:test');
const assert = require('node:assert');
const auth = require('../lib/auth');

// ------------------------- password hashing -------------------------

test('a correct password verifies against its hash', () => {
  const cred = auth.hashPassword('correct horse');
  assert.ok(auth.verifyPassword('correct horse', cred));
});

test('a wrong password does not verify', () => {
  const cred = auth.hashPassword('correct horse');
  assert.equal(auth.verifyPassword('wrong horse', cred), false);
});

test('the plaintext password is never stored in the credential', () => {
  const cred = auth.hashPassword('msfs2026');
  assert.ok(!JSON.stringify(cred).includes('msfs2026'));
});

test('the same password hashed twice yields different hashes', () => {
  // Per-user random salt: two employees choosing the same password must not
  // produce identical hashes, or the store leaks which accounts match.
  const a = auth.hashPassword('samepass');
  const b = auth.hashPassword('samepass');
  assert.notEqual(a.hash, b.hash);
  assert.notEqual(a.salt, b.salt);
});

// ------------------------- migration -------------------------

test('ensureAdmin creates an admin from the legacy shared password', () => {
  const users = auth.ensureAdmin([], 'msfs2026');
  assert.equal(users.length, 1);
  assert.equal(users[0].username, 'admin');
  assert.equal(users[0].role, 'admin');
  assert.ok(auth.verifyPassword('msfs2026', users[0]));
});

test('ensureAdmin does not duplicate an existing admin', () => {
  const once = auth.ensureAdmin([], 'msfs2026');
  const twice = auth.ensureAdmin(once, 'msfs2026');
  assert.equal(twice.length, 1);
});

// ------------------------- authenticate -------------------------

test('authenticate returns the user for valid credentials', () => {
  const users = auth.ensureAdmin([], 'msfs2026');
  const u = auth.authenticate(users, 'admin', 'msfs2026');
  assert.equal(u.role, 'admin');
});

test('authenticate rejects a wrong password', () => {
  const users = auth.ensureAdmin([], 'msfs2026');
  assert.equal(auth.authenticate(users, 'admin', 'nope'), null);
});

test('authenticate rejects an unknown username', () => {
  const users = auth.ensureAdmin([], 'msfs2026');
  assert.equal(auth.authenticate(users, 'ghost', 'msfs2026'), null);
});

test('authenticate rejects a disabled user', () => {
  const users = auth.ensureAdmin([], 'msfs2026');
  users[0].disabled = true;
  assert.equal(auth.authenticate(users, 'admin', 'msfs2026'), null);
});

// ------------------------- sessions -------------------------

test('a session token resolves to the user role', () => {
  const s = auth.createSessions();
  const token = s.create({ id: 'u1', role: 'employee' });
  assert.equal(s.resolve(token).role, 'employee');
});

test('two sessions for the same user get different tokens', () => {
  // The token must be random, not derived from the password. A deterministic
  // token is forgeable by anyone who knows the password.
  const s = auth.createSessions();
  const a = s.create({ id: 'u1', role: 'admin' });
  const b = s.create({ id: 'u1', role: 'admin' });
  assert.notEqual(a, b);
});

test('an unknown token resolves to null', () => {
  const s = auth.createSessions();
  assert.equal(s.resolve('made-up-token'), null);
});

test('destroying a session invalidates its token', () => {
  const s = auth.createSessions();
  const token = s.create({ id: 'u1', role: 'admin' });
  s.destroy(token);
  assert.equal(s.resolve(token), null);
});

test('a session older than the max age is rejected', () => {
  // The cookie says 30 days; the server must agree, or a leaked token lives
  // forever.
  const s = auth.createSessions({ old: { userId: 'u1', role: 'admin', createdAt: 0 } }, { maxAgeMs: 1000 });
  assert.equal(s.resolve('old'), null);
});

test('a fresh session within the max age still resolves', () => {
  const s = auth.createSessions(null, { maxAgeMs: 60 * 1000 });
  const token = s.create({ id: 'u1', role: 'admin' });
  assert.ok(s.resolve(token));
});

test('expired sessions are pruned when the store loads', () => {
  const s = auth.createSessions({ old: { userId: 'u1', role: 'admin', createdAt: 0 } }, { maxAgeMs: 1000 });
  assert.equal(Object.keys(s.serialize()).length, 0);
});

test('destroying all sessions for a user revokes them everywhere', () => {
  const s = auth.createSessions();
  const a = s.create({ id: 'u1', role: 'employee' });
  const b = s.create({ id: 'u1', role: 'employee' });
  const other = s.create({ id: 'u2', role: 'admin' });
  s.destroyForUser('u1');
  assert.equal(s.resolve(a), null);
  assert.equal(s.resolve(b), null);
  assert.ok(s.resolve(other), 'other users keep their sessions');
});

// ------------------------- API permission boundary -------------------------

test('an admin may reach every route', () => {
  for (const [m, p] of [['GET', '/api/dashboard'], ['GET', '/api/config'], ['POST', '/api/production']]) {
    assert.ok(auth.canAccess('admin', m, p), `admin should reach ${m} ${p}`);
  }
});

test('an employee may reach the Deal Production routes', () => {
  assert.ok(auth.canAccess('employee', 'GET', '/api/production'));
  assert.ok(auth.canAccess('employee', 'GET', '/api/production/C1000'), 'poll one lead for live refresh');
  assert.ok(auth.canAccess('employee', 'PATCH', '/api/production/C1000'));
  assert.ok(auth.canAccess('employee', 'GET', '/api/me'));
  assert.ok(auth.canAccess('employee', 'POST', '/api/logout'));
});

test('an employee is denied the money and admin routes', () => {
  // /api/clients is NOT in this list -- see the redacted-Clients tests
  // below (2026-08-05 Company vs Team Dashboard spec).
  for (const p of ['/api/dashboard', '/api/config', '/api/pipeline',
                   '/api/reactivation', '/api/social']) {
    assert.equal(auth.canAccess('employee', 'GET', p), false, `employee must not reach ${p}`);
  }
});

test('an employee reads Clients read-only (money redaction happens in server.js, not here)', () => {
  assert.ok(auth.canAccess('employee', 'GET', '/api/clients'));
  assert.ok(auth.canAccess('employee', 'GET', '/api/clients/c1'));
  for (const [m, p] of [['POST', '/api/clients'], ['POST', '/api/clients/c1/status'],
                        ['POST', '/api/clients/c1/affiliate'], ['POST', '/api/clients/c1/notes'],
                        ['POST', '/api/clients/c1/sms'], ['POST', '/api/clients/c1/contact'],
                        ['POST', '/api/clients/c1/tags']]) {
    assert.equal(auth.canAccess('employee', m, p), false, `employee must not reach ${m} ${p}`);
  }
});

test('an employee may no longer use Follow-Ups', () => {
  // Reversed 2026-08-05: the Company vs Team Dashboard spec dropped
  // Follow-Ups from the Employee nav and asked for it to be blocked at the
  // route level too, not just hidden.
  assert.equal(auth.canAccess('employee', 'GET', '/api/tasks'), false);
  assert.equal(auth.canAccess('employee', 'POST', '/api/tasks'), false);
  assert.equal(auth.canAccess('employee', 'PATCH', '/api/tasks/t1'), false);
  assert.equal(auth.canAccess('employee', 'DELETE', '/api/tasks/t1'), false);
  assert.equal(auth.canAccess('employee', 'GET', '/api/tasks/t1/notes'), false);
  assert.equal(auth.canAccess('employee', 'POST', '/api/tasks/t1/notes'), false);
  assert.equal(auth.canAccess('employee', 'DELETE', '/api/task-notes/n1'), false);
});

test('an employee may read the login directory (for assignee/@mention lookups) but not manage it', () => {
  assert.ok(auth.canAccess('employee', 'GET', '/api/users'));
  assert.equal(auth.canAccess('employee', 'POST', '/api/users'), false);
  assert.equal(auth.canAccess('employee', 'PATCH', '/api/users/u1'), false);
  assert.equal(auth.canAccess('employee', 'DELETE', '/api/users/u1'), false);
});

test('an employee is denied the bulk production overwrite', () => {
  // POST replaces all 3,578 records; only admin imports.
  assert.equal(auth.canAccess('employee', 'POST', '/api/production'), false);
});

test('an employee is denied routes that write to live GoHighLevel', () => {
  assert.equal(auth.canAccess('employee', 'POST', '/api/clients/abc/sms'), false);
  assert.equal(auth.canAccess('employee', 'POST', '/api/clients/abc/status'), false);
});

test('an unknown route is denied to employees by default', () => {
  // Deny-by-default: a route added later must be closed until opened.
  assert.equal(auth.canAccess('employee', 'GET', '/api/some-future-report'), false);
});

// ------------------------- static asset boundary -------------------------

test('an employee is denied personal-finances.js', () => {
  // That file contains balances hardcoded in source; there is no API to gate.
  assert.equal(auth.canAccessAsset('employee', '/personal-finances.js'), false);
});

test('an employee may load the app shell and production script', () => {
  assert.ok(auth.canAccessAsset('employee', '/index.html'));
  assert.ok(auth.canAccessAsset('employee', '/production.js'));
  assert.ok(auth.canAccessAsset('employee', '/logo.png'));
  assert.ok(auth.canAccessAsset('employee', '/role.js'), 'role.js decides what the employee sees');
});

test('an admin may load every asset', () => {
  assert.ok(auth.canAccessAsset('admin', '/personal-finances.js'));
});

// ------------------------- field-level permissions -------------------------

test('an employee may edit dispute rounds, docs and append a note', () => {
  const { denied } = auth.filterEditable('employee', { tu: {}, eq: {}, ex: {}, docs: {}, note: 'called' });
  assert.deepEqual(denied, []);
});

test('an employee may not rewrite the notes array', () => {
  // Writing `notes` wholesale would let one employee delete or forge another's
  // note. They append through `note`, which the server attributes.
  const { denied } = auth.filterEditable('employee', { notes: [] });
  assert.deepEqual(denied, ['notes']);
});

test('an employee may not change stage or va', () => {
  // stage moves a lead through the pipeline; va reassigns ownership.
  const { denied } = auth.filterEditable('employee', { stage: 'Completed', va: 'Someone' });
  assert.deepEqual(denied.sort(), ['stage', 'va']);
});

test('an admin may change any field', () => {
  const { denied } = auth.filterEditable('admin', { stage: 'Completed', va: 'X', pkg: 'Y' });
  assert.deepEqual(denied, []);
});
