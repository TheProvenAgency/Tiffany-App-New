// POST /api/config (GHL/Meta/webhook-secret Settings save) must write
// Supabase FIRST and treat config.json as the backup -- same "Postgres
// primary" philosophy as Deal Production, not the fire-and-forget mirror
// every other setConfig() call site (users/SSO/invite-secret) still uses.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msfs-config-primary-'));
  process.env.DATA_DIR = dir;
  return dir;
}

test('setConfigPrimary(): awaits the Postgres write before resolving, not fire-and-forget', async () => {
  const dir = isolatedDataDir();
  const store = freshStore();
  const db = require('../lib/db');

  let pgWriteCompleted = false;
  db.isEnabled = () => true;
  db.query = async () => {
    await new Promise(r => setTimeout(r, 20)); // simulate real network latency
    pgWriteCompleted = true;
    return { rows: [] };
  };

  await store.setConfigPrimary({ ghlLocationId: 'LOC-1' });
  assert.equal(pgWriteCompleted, true, 'the Postgres write must have completed before setConfigPrimary resolves');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('setConfigPrimary(): JSON backup still lands even when the Postgres write fails', async () => {
  const dir = isolatedDataDir();
  const store = freshStore();
  const db = require('../lib/db');

  db.isEnabled = () => true;
  db.query = async () => { throw new Error('connection refused'); };

  await store.setConfigPrimary({ ghlLocationId: 'LOC-2' });

  const cfg = store.getConfig();
  assert.equal(cfg.ghlLocationId, 'LOC-2', 'JSON backup must still be written even though Postgres failed');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('setConfigPrimary(): works with Postgres unconfigured (JSON only, same as before)', async () => {
  const dir = isolatedDataDir();
  delete process.env.DATABASE_URL;
  const store = freshStore();

  await store.setConfigPrimary({ ghlLocationId: 'LOC-3' });

  const cfg = store.getConfig();
  assert.equal(cfg.ghlLocationId, 'LOC-3');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('setConfigPrimary(): a successful write is verifiable in the mocked app_settings call', async () => {
  const dir = isolatedDataDir();
  process.env.APP_ENCRYPTION_KEY = 'f'.repeat(64);
  const store = freshStore();
  const db = require('../lib/db');

  let capturedSql = '';
  let capturedParams = null;
  db.isEnabled = () => true;
  db.query = async (sql, params) => { capturedSql = sql; capturedParams = params; return { rows: [] }; };

  await store.setConfigPrimary({ ghlToken: 'pit-real-token', webhookSecret: 'real-secret' });

  assert.match(capturedSql, /insert into app_settings/i);
  assert.ok(Buffer.isBuffer(capturedParams[5])); // ghl_token_encrypted position
  assert.notEqual(capturedParams[5].toString('utf8'), 'pit-real-token'); // never sent as plaintext

  delete process.env.APP_ENCRYPTION_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});
