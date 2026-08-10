// Two things about the MFSN member sync, both touched this session:
// 1. mirrorSetMfsnMembers must run delete+insert as ONE transaction, batched,
//    not 1,000+ sequential awaited single-row inserts with no atomicity --
//    the real Zap now replaces 1,000+ members every 6h.
// 2. hydrateMfsnFromPostgres restores mfsn_members.json at boot when it's
//    empty (ephemeral-disk restart), mirroring hydrateConfigFromPostgres --
//    without it, the affiliate-gap dashboard reads an empty list and shows
//    every client as a gap until the next scheduled sync, up to 6h later.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshStore() {
  delete require.cache[require.resolve('../lib/store')];
  delete require.cache[require.resolve('../lib/db')];
  delete require.cache[require.resolve('../lib/crypto')];
  return require('../lib/store');
}

function isolatedDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msfs-mfsn-pg-'));
  process.env.DATA_DIR = dir;
  return dir;
}

test('setMfsnMembers(): the mirror runs inside one transaction, not per-row db.query calls', async () => {
  const dir = isolatedDataDir();
  const store = freshStore();
  const db = require('../lib/db');

  const statements = [];
  let usedTransaction = false;
  db.isEnabled = () => true;
  db.query = async () => { throw new Error('mirrorSetMfsnMembers must use withTransaction, not db.query directly'); };
  db.withTransaction = async (fn) => {
    usedTransaction = true;
    const client = { query: async (sql, params) => { statements.push({ sql, params }); return { rows: [] }; } };
    return fn(client);
  };

  store.setMfsnMembers([
    { email: 'a@x.com', name: 'A A', hasAffiliateCode: true, planAmount: 29.9 },
    { email: 'b@x.com', name: 'B B', hasAffiliateCode: false, planAmount: null }
  ]);
  await new Promise(r => setTimeout(r, 20));

  assert.equal(usedTransaction, true);
  assert.match(statements[0].sql, /delete from mfsn_members/i);
  assert.match(statements[1].sql, /insert into mfsn_members/i);
  assert.equal(statements[1].params.length, 8); // 2 members * 4 columns, one batched statement

  fs.rmSync(dir, { recursive: true, force: true });
});

test('setMfsnMembers(): a 1,200-member sync batches into multiple insert statements, not one per row', async () => {
  const dir = isolatedDataDir();
  const store = freshStore();
  const db = require('../lib/db');

  const inserts = [];
  db.isEnabled = () => true;
  db.withTransaction = async (fn) => {
    const client = { query: async (sql, params) => { if (/^insert/i.test(sql.trim())) inserts.push(params.length / 4); return { rows: [] }; } };
    return fn(client);
  };

  const members = Array.from({ length: 1200 }, (_, i) => ({ email: `m${i}@x.com`, name: `M ${i}` }));
  store.setMfsnMembers(members);
  await new Promise(r => setTimeout(r, 30));

  assert.equal(inserts.length, 3, 'batches of 500 -> 3 insert statements for 1,200 rows');
  assert.deepEqual(inserts, [500, 500, 200]);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('hydrateMfsnFromPostgres(): no-op when Postgres is not configured', async () => {
  const dir = isolatedDataDir();
  delete process.env.DATABASE_URL;
  const store = freshStore();

  await store.hydrateMfsnFromPostgres();
  assert.deepEqual(store.getMfsnMembers(), []);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('hydrateMfsnFromPostgres(): restores members from Postgres when the local list is empty', async () => {
  const dir = isolatedDataDir();
  const store = freshStore();
  const db = require('../lib/db');

  db.isEnabled = () => true;
  db.query = async (sql) => {
    if (/select email, name, has_affiliate_code, plan_amount from mfsn_members/i.test(sql)) {
      return { rows: [{ email: 'restored@x.com', name: 'Restored Person', has_affiliate_code: true, plan_amount: '29.90' }] };
    }
    if (/select synced_at from mfsn_sync_meta/i.test(sql)) {
      return { rows: [{ synced_at: '2026-08-10T02:06:40.547Z' }] };
    }
    return { rows: [] };
  };

  await store.hydrateMfsnFromPostgres();

  const members = store.getMfsnMembers();
  assert.equal(members.length, 1);
  assert.equal(members[0].email, 'restored@x.com');
  assert.equal(members[0].hasAffiliateCode, true);
  assert.equal(members[0].planAmount, 29.9);
  assert.equal(store.getMfsnSyncedAt(), '2026-08-10T02:06:40.547Z');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('hydrateMfsnFromPostgres(): never overwrites a local list that already has members', async () => {
  const dir = isolatedDataDir();
  const store = freshStore();
  const db = require('../lib/db');

  store.setMfsnMembers([{ email: 'local@x.com', name: 'Local Person' }]);

  let queried = false;
  db.isEnabled = () => true;
  db.query = async () => { queried = true; return { rows: [] }; };

  await store.hydrateMfsnFromPostgres();

  assert.equal(queried, false, 'should short-circuit before querying when local data already exists');
  assert.equal(store.getMfsnMembers()[0].email, 'local@x.com');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('hydrateMfsnFromPostgres(): a Postgres error during hydration does not throw or block boot', async () => {
  const dir = isolatedDataDir();
  const store = freshStore();
  const db = require('../lib/db');

  db.isEnabled = () => true;
  db.query = async () => { throw new Error('connection refused'); };

  await assert.doesNotReject(() => store.hydrateMfsnFromPostgres());

  fs.rmSync(dir, { recursive: true, force: true });
});
