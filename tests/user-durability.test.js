// A freshly added team member vanished within minutes and could not log in.
//
// Root cause: accounts live in config.users, which is JSON on a host with no
// persistent disk. The Postgres mirror stored username/role/flags but NOT the
// credential hash, and nothing restored users at boot anyway -- so the mirror
// was decorative, and every deploy or spin-down deleted every account except
// admin, which ensureAdmin recreates from the env password. With deploys
// happening many times a day, an account's life expectancy was minutes.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const store = require('../lib/store.js');
const auth = require('../lib/auth.js');

test('the mirror carries the full record, credential included', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'store.js'), 'utf8');
  const fn = src.split('async function mirrorUsers')[1].split('\n}')[0];
  assert.ok(/JSON\.stringify\(u\)/.test(fn),
    'mirroring an account without its credential mirrors a login nobody can use');
  const mig = fs.readFileSync(path.join(__dirname, '..', 'lib', 'migrate.js'), 'utf8');
  assert.ok(/add column if not exists record jsonb/.test(mig));
});

test('boot restores users, and does so before mirroring pushes local out', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const boot = src.split('async function bootstrap()')[1].split('\n}')[0];
  // Match the calls, not the words -- the explanatory comment above the
  // restore names mirrorUsers and sits earlier in the file.
  const restoreAt = boot.indexOf('store.hydrateUsersFromPostgres(');
  const mirrorAt = boot.indexOf('store.mirrorUsers(');
  assert.ok(restoreAt > -1, 'nothing restored users at all before this');
  assert.ok(restoreAt < mirrorAt,
    'mirroring first would push the freshly-wiped list over the good copy');
});

test('hydration is restore-only-when-empty, like every other store', async () => {
  await assert.doesNotReject(() => store.hydrateUsersFromPostgres());
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'store.js'), 'utf8');
  const fn = src.split('async function hydrateUsersFromPostgres')[1].split('\n}')[0];
  assert.ok(/users\.length > 1\) return/.test(fn),
    'a populated local list is newer than Postgres, since every write mirrors forward');
});

test('a restored record still authenticates', () => {
  // The round trip that actually matters: make a user, serialize the way the
  // mirror does, parse the way hydration does, and log in with it.
  const u = auth.makeUser({ username: 'trip', name: 'Round Trip', role: 'va', password: 'pw-round-trip-1' });
  const restored = JSON.parse(JSON.stringify(u));
  const ok = auth.authenticate([restored], 'trip', 'pw-round-trip-1');
  assert.ok(ok, 'the credential must survive the mirror round trip');
  assert.ok(!auth.authenticate([restored], 'trip', 'wrong'), 'and still reject a wrong password');
});

test('creating an account reports whether it is actually durable', async () => {
  // The mirror was fire-and-forget, so a failed write meant the login worked
  // NOW and evaporated on the next restart, with the only evidence in a
  // server log nobody reads. The creator gets told, in the response.
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const route = src.split("app.post('/api/users'")[1].split('\n});')[0];
  assert.ok(/await saveUsersDurable/.test(route), 'creation must await the mirror');
  assert.ok(/durable: mirrored/.test(route), 'and report the result');
  assert.ok(/may not survive a restart/.test(route), 'in words, when it failed');
});

test('mirrorUsers reports success honestly', async () => {
  // Without Postgres configured there is nothing durable about the write, and
  // saying otherwise would just move the lie.
  const ok = await store.mirrorUsers([{ id: 'x', username: 'y' }]);
  assert.equal(ok, false, 'no database means not mirrored, which is false, not undefined');
});
