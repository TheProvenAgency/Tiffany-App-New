// Sessions were the last thing still living only in a file on Render's
// ephemeral disk. The free tier has no persistent disk and spins down after
// about fifteen minutes idle, so sessions.json was destroyed on every
// spin-down and every deploy -- meaning Tiffany was silently logged out
// several times a day. A logged-out browser doesn't announce itself; the
// dashboard's fetches just 401 and the page renders empty, which is
// indistinguishable from "the app is broken and showing nothing".
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const store = require('../lib/store.js');
const migrate = require('../lib/migrate.js');

test('the schema provides somewhere for sessions to live', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'migrate.js'), 'utf8');
  assert.ok(/create table if not exists sessions/.test(src),
    'migrate.js should create a sessions table');
  assert.ok(/token\s+text primary key/.test(src),
    'the token is the natural key and must be unique');
});

test('mirroring is a no-op when Postgres is not configured', async () => {
  // Local dev and the test run have no DATABASE_URL. Persistence must
  // degrade to file-only rather than throwing on every login.
  await assert.doesNotReject(() => store.mirrorSessions({
    abc: { userId: 'u1', role: 'admin', createdAt: Date.now() }
  }));
  await assert.doesNotReject(() => store.hydrateSessionsFromPostgres());
});

test('hydration returns a plain token->session map', async () => {
  const out = await store.hydrateSessionsFromPostgres();
  assert.ok(out && typeof out === 'object', 'callers pass this straight to createSessions()');
  assert.ok(!Array.isArray(out));
});

test('server.js persists sessions somewhere durable, not just to disk', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const fn = src.split('function persistSessions()')[1].split('\n}')[0];
  assert.ok(fn.includes('mirrorSessions'),
    'persistSessions() should mirror to Postgres, not only write sessions.json');
});

test('boot restores sessions before the app starts serving', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const boot = src.split('async function bootstrap()')[1].split('\n}')[0];
  assert.ok(boot.includes('hydrateSessionsFromPostgres') || boot.includes('restoreSessions'),
    'bootstrap() should restore sessions');
});

test('an expired session is not resurrected by hydration', () => {
  // The 30-day expiry is a security property, not a storage detail. Restoring
  // rows blindly would hand back tokens the in-memory store had already
  // dropped, so createSessions() must stay the thing that decides.
  const auth = require('../lib/auth.js');
  const old = Date.now() - (31 * 24 * 60 * 60 * 1000);
  const s = auth.createSessions({ stale: { userId: 'u1', role: 'admin', createdAt: old } });
  assert.equal(s.resolve('stale'), null, 'a 31-day-old token must not resolve');
});

test('restore() re-admits a live session but refuses an aged-out one', () => {
  // The restore path is new, and it is the one place a token can enter the
  // map without having just been minted -- so it has to apply the same
  // expiry rule resolve() does, or a restart becomes a way to revive
  // credentials that had already lapsed.
  const auth = require('../lib/auth.js');
  const s = auth.createSessions({});
  const fresh = { userId: 'u1', role: 'admin', createdAt: Date.now() };
  const stale = { userId: 'u2', role: 'admin', createdAt: Date.now() - (31 * 24 * 60 * 60 * 1000) };

  assert.equal(s.restore('good', fresh), true);
  assert.equal(s.restore('old', stale), false);
  assert.ok(s.resolve('good'), 'a live session should come back after a restart');
  assert.equal(s.resolve('old'), null, 'an expired token must stay dead');
});

test('a restored session keeps its role and preview flag', () => {
  const auth = require('../lib/auth.js');
  const s = auth.createSessions({});
  s.restore('t', { userId: 'u1', role: 'disputer', createdAt: Date.now(), previewRole: 'employee' });
  const got = s.resolve('t');
  assert.equal(got.role, 'disputer', 'role decides what the session may reach');
  assert.equal(got.previewRole, 'employee');
});
