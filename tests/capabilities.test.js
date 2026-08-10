const { test } = require('node:test');
const assert = require('node:assert');
const auth = require('../lib/auth');

// Per-feature capabilities replaced the two fixed roles. A role is now just a
// named preset of capabilities; what the gate actually checks is the
// capability. Deny-by-default still holds: a route with no rule is closed to
// everyone except admin.

test('admin holds every capability', () => {
  const caps = auth.capsFor('admin');
  for (const c of auth.CAPABILITIES) assert.ok(caps.has(c), `admin should hold ${c}`);
});

test('a role string still resolves to its preset (back-compat with the old gate)', () => {
  const caps = auth.capsFor('employee');
  assert.ok(caps.has('production'));
  assert.ok(caps.has('messages'));
  assert.equal(caps.has('revenue'), false, 'employees never had money surfaces');
  assert.equal(caps.has('admin'), false);
});

test('an explicit capability list on the user overrides the role preset', () => {
  const caps = auth.capsFor({ role: 'employee', capabilities: ['disputes'] });
  assert.ok(caps.has('disputes'));
  assert.equal(caps.has('production'), false, 'the preset must not leak in when caps are explicit');
});

test('an unknown role resolves to no capabilities, not to everything', () => {
  const caps = auth.capsFor('something-new');
  assert.equal(caps.size, 0);
});

// ------------------------- VA preset -------------------------

test('a VA reaches Deal Production and Messages', () => {
  const va = { role: 'va' };
  assert.ok(auth.canAccess(va, 'GET', '/api/production'));
  assert.ok(auth.canAccess(va, 'PATCH', '/api/production/C1000'));
  assert.ok(auth.canAccess(va, 'GET', '/api/messages'));
  assert.ok(auth.canAccess(va, 'POST', '/api/messages/m1/reply'));
});

test('a VA never reaches revenue or admin surfaces', () => {
  const va = { role: 'va' };
  for (const [m, p] of [
    ['GET', '/api/dashboard'],
    ['GET', '/api/affiliate-gap'],
    ['POST', '/api/config'],
    ['GET', '/api/revenue'],
    ['POST', '/api/users']
  ]) {
    assert.equal(auth.canAccess(va, m, p), false, `VA must not reach ${m} ${p}`);
  }
});

// ------------------------- Disputer preset -------------------------

test('a disputer reaches the round queue and a client dispute record', () => {
  const d = { role: 'disputer' };
  assert.ok(auth.canAccess(d, 'GET', '/api/disputes/queue'));
  assert.ok(auth.canAccess(d, 'GET', '/api/disputes/C1000'));
  assert.ok(auth.canAccess(d, 'PATCH', '/api/disputes/C1000'));
});

test('a disputer does not reach Deal Production, Messages, or any money', () => {
  const d = { role: 'disputer' };
  for (const [m, p] of [
    ['GET', '/api/production'],
    ['PATCH', '/api/production/C1000'],
    ['GET', '/api/messages'],
    ['GET', '/api/dashboard'],
    ['GET', '/api/pipeline']
  ]) {
    assert.equal(auth.canAccess(d, m, p), false, `disputer must not reach ${m} ${p}`);
  }
});

// ------------------------- universal, capability-free routes -------------

test('every signed-in role reaches its own account routes regardless of capabilities', () => {
  for (const role of ['employee', 'va', 'disputer']) {
    const a = { role };
    assert.ok(auth.canAccess(a, 'GET', '/api/me'), `${role} needs /api/me`);
    assert.ok(auth.canAccess(a, 'POST', '/api/logout'), `${role} needs logout`);
    assert.ok(auth.canAccess(a, 'POST', '/api/me/password'), `${role} needs own password`);
    assert.ok(auth.canAccess(a, 'GET', '/api/notifications'), `${role} needs own bell`);
  }
});

// ------------------------- field-level -------------------------

test('dispute bureau fields are writable with the disputes capability', () => {
  const { allowed, denied } = auth.filterEditable({ role: 'disputer' }, { tu: { r: 2 }, va: 'someone' });
  assert.deepEqual(allowed, { tu: { r: 2 } });
  assert.ok(denied.includes('va'), 'ownership reassignment stays admin-only');
});

test('a disputer cannot write Deal Production-only fields', () => {
  const { allowed, denied } = auth.filterEditable({ role: 'disputer' }, { stage: 'Ready', docs: {} });
  assert.deepEqual(allowed, {});
  assert.deepEqual(denied.sort(), ['docs', 'stage']);
});

// ------------------------- money redaction -------------------------

test('a client record keeps its money fields only for a holder of the revenue capability', () => {
  const client = { name: 'A', totalSpent: 900, mfsnCommission: 13.8 };
  const forVa = auth.redactClient({ role: 'va' }, client);
  assert.equal(forVa.mfsnCommission, undefined);
  const forAdmin = auth.redactClient('admin', client);
  assert.equal(forAdmin.mfsnCommission, 13.8);
});

// ------------------------- asset boundary -------------------------

test('a static asset is reachable only with the capability it belongs to', () => {
  assert.ok(auth.canAccessAsset({ role: 'va' }, '/production.js'));
  assert.ok(auth.canAccessAsset({ role: 'va' }, '/messages.js'));
  assert.equal(auth.canAccessAsset({ role: 'va' }, '/revenue.js'), false);
  assert.equal(auth.canAccessAsset({ role: 'va' }, '/personal-finances.js'), false);
  assert.ok(auth.canAccessAsset({ role: 'disputer' }, '/disputes.js'));
  assert.equal(auth.canAccessAsset({ role: 'disputer' }, '/production.js'), false);
});
