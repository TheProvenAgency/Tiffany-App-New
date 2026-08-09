// Render's free tier has no persistent disk -- config.json (GHL token,
// location id, webhook secret) is wiped on every restart/spin-down.
// hydrateConfigFromPostgres() restores it from the app_settings mirror
// once at boot, before the server starts accepting requests, without
// making getConfig() itself async (see lib/store.js's comment on why that
// would be a much bigger, riskier change).
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msfs-config-hydrate-'));
  process.env.DATA_DIR = dir;
  return dir;
}

test('hydrateConfigFromPostgres(): no-op when Postgres is not configured', async () => {
  const dir = isolatedDataDir();
  delete process.env.DATABASE_URL;
  const store = freshStore();

  await store.hydrateConfigFromPostgres(); // must resolve cleanly, not throw

  const cfg = store.getConfig();
  assert.equal(cfg.ghlToken, ''); // still the untouched default -- nothing to restore from
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hydrateConfigFromPostgres(): restores GHL token, location id, and webhook secret from app_settings when local config is empty', async () => {
  const dir = isolatedDataDir();
  process.env.APP_ENCRYPTION_KEY = 'd'.repeat(64);
  const store = freshStore();
  const crypto = require('../lib/crypto');
  const db = require('../lib/db');

  const realToken = 'pit-restored-from-postgres';
  const realSecret = 'restored-webhook-secret';
  db.isEnabled = () => true; // simulate DATABASE_URL being configured
  db.query = async () => ({
    rows: [{
      ghl_location_id: 'LOC-RESTORED',
      fb_page_id: null, ig_user_id: null, ig_handle: null, fb_page_url: null,
      ghl_token_encrypted: crypto.encrypt(realToken),
      meta_page_token_encrypted: null,
      webhook_secret_encrypted: crypto.encrypt(realSecret)
    }]
  });

  await store.hydrateConfigFromPostgres();

  const cfg = store.getConfig();
  assert.equal(cfg.ghlToken, realToken);
  assert.equal(cfg.ghlLocationId, 'LOC-RESTORED');
  assert.equal(cfg.webhookSecret, realSecret);

  delete process.env.APP_ENCRYPTION_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hydrateConfigFromPostgres(): never overwrites a value already present locally', async () => {
  const dir = isolatedDataDir();
  process.env.APP_ENCRYPTION_KEY = 'e'.repeat(64);
  const store = freshStore();
  const crypto = require('../lib/crypto');
  const db = require('../lib/db');

  store.setConfig({ ghlToken: 'already-here', ghlLocationId: 'LOC-LOCAL', webhookSecret: 'already-here-too' });

  let queried = false;
  db.isEnabled = () => true;
  db.query = async () => {
    queried = true;
    return { rows: [{ ghl_location_id: 'LOC-FROM-PG', ghl_token_encrypted: crypto.encrypt('from-pg'), webhook_secret_encrypted: crypto.encrypt('from-pg-secret'), meta_page_token_encrypted: null, fb_page_id: null, ig_user_id: null, ig_handle: null, fb_page_url: null }]
    };
  };

  await store.hydrateConfigFromPostgres();

  assert.equal(queried, false, 'should short-circuit before querying when all 3 core fields are already present');
  const cfg = store.getConfig();
  assert.equal(cfg.ghlToken, 'already-here');
  assert.equal(cfg.ghlLocationId, 'LOC-LOCAL');
  assert.equal(cfg.webhookSecret, 'already-here-too');

  delete process.env.APP_ENCRYPTION_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hydrateConfigFromPostgres(): a Postgres error during hydration does not throw or block boot', async () => {
  const dir = isolatedDataDir();
  const store = freshStore();
  const db = require('../lib/db');

  db.isEnabled = () => true;
  db.query = async () => { throw new Error('connection refused'); };

  await assert.doesNotReject(() => store.hydrateConfigFromPostgres());

  fs.rmSync(dir, { recursive: true, force: true });
});
