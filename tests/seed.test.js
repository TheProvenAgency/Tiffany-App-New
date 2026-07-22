// The lead tracker must not come up empty on a fresh disk, and the seed file
// holds 3,578 real client records so it must not be reachable from a browser.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msfs-seed-'));
process.env.APP_PASSWORD = 'test-admin-pw';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../server');

let base, server, adminCookie;

function req(pathname, { method = 'GET', cookie, body } = {}) {
  return fetch(base + pathname, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}

before(async () => {
  server = app.listen(0);
  await new Promise(res => server.once('listening', res));
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await req('/api/login', { method: 'POST', body: { username: 'admin', password: 'test-admin-pw' } });
  adminCookie = r.headers.get('set-cookie').split(';')[0];
});

after(() => {
  server.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

test('a fresh install seeds the tracker instead of showing nothing', async () => {
  // DATA_DIR is empty, so this exercises the first-run path.
  const d = await (await req('/api/production', { cookie: adminCookie })).json();
  assert.ok(Array.isArray(d.clients), 'clients must be an array, not null');
  assert.ok(d.clients.length > 3000, `expected the full book, got ${d.clients.length}`);
});

test('the seed is written to disk so later edits persist against it', async () => {
  assert.ok(fs.existsSync(path.join(process.env.DATA_DIR, 'production.json')));
});

test('an edit survives and is not undone by re-seeding', async () => {
  const first = (await (await req('/api/production', { cookie: adminCookie })).json()).clients[0];
  await req('/api/production/' + first.id, {
    method: 'PATCH', cookie: adminCookie, body: { note: 'worked this lead' }
  });
  const again = (await (await req('/api/production', { cookie: adminCookie })).json()).clients[0];
  assert.equal(again.notes.slice(-1)[0].text, 'worked this lead');
});

test('the seed file is not downloadable over HTTP', async () => {
  // 3,578 real client records must not sit in the browser-servable directory.
  const r = await req('/production-seed.json', { cookie: adminCookie });
  assert.notEqual(r.status, 200, 'the seed must not be served to a browser');
});
