// The boot migration is the only thing that can reach the deployed database
// (the connection string exists only as a Render env var), so it runs
// unattended on every start. That earns it two hard rules: it must be purely
// additive, and it must never be able to stop boot.
const { test } = require('node:test');
const assert = require('node:assert');
const migrate = require('../lib/migrate');

test('every statement is additive -- nothing can destroy data', () => {
  const all = migrate.STATEMENTS.join('\n').toLowerCase();
  for (const forbidden of ['drop table', 'delete from', 'truncate', 'drop column', 'drop database']) {
    assert.equal(all.includes(forbidden), false,
      `a migration that can "${forbidden}" must not run unattended`);
  }
});

test('every create is guarded, so re-running is a no-op', () => {
  for (const sql of migrate.STATEMENTS) {
    const s = sql.toLowerCase().trim();
    if (s.startsWith('create table')) {
      assert.ok(s.includes('if not exists'), `unguarded create table: ${s.slice(0, 60)}`);
    }
    if (s.startsWith('create unique index') || s.startsWith('create index')) {
      assert.ok(s.includes('if not exists'), `unguarded create index: ${s.slice(0, 60)}`);
    }
    if (s.startsWith('alter table') && s.includes('add column')) {
      assert.ok(s.includes('if not exists'), `unguarded add column: ${s.slice(0, 60)}`);
    }
  }
});

test('the one constraint drop is narrowly scoped and existence-checked', () => {
  // Relaxing users_role_check is the single non-create statement. It targets
  // exactly that constraint and only when present -- roles are presets in
  // lib/auth.js now, so the database is not the place that decides which
  // role names exist.
  const s = migrate.RELAX_ROLE_CHECK.toLowerCase();
  assert.ok(s.includes('users_role_check'));
  assert.ok(s.includes('if exists'));
  assert.equal(s.includes('drop table'), false);
});

test('it no-ops rather than throwing when Postgres is not configured', async () => {
  delete process.env.DATABASE_URL;
  delete require.cache[require.resolve('../lib/db')];
  delete require.cache[require.resolve('../lib/migrate')];
  const fresh = require('../lib/migrate');
  const res = await fresh.run();
  assert.deepEqual(res, { skipped: true });
});

test('a failing statement is reported but never rejects, so boot continues', async () => {
  // Fresh copies of both: the previous test evicts them from the cache, so
  // stubbing the old db instance would leave migrate holding a different one.
  delete require.cache[require.resolve('../lib/db')];
  delete require.cache[require.resolve('../lib/migrate')];
  const db = require('../lib/db');
  const fresh = require('../lib/migrate');
  db.isEnabled = () => true;
  db.query = async () => { throw new Error('permission denied for schema public'); };
  const res = await fresh.run();
  assert.ok(res.failed.length > 0, 'failures should be surfaced');
  assert.equal(res.applied, 0);
});
