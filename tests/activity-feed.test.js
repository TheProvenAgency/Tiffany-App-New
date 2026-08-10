// GET /api/activity merges payment/dispute/new-client events for the
// dashboard's "Recent Orders" card. A DisputeFox account-level event (e.g.
// action:"report_imported") legitimately carries no client name/email --
// confirmed against a real Supabase row -- so the feed must fall back to a
// displayable label instead of a blank "?" row.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msfs-activity-test-'));
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

async function login(username, password) {
  const r = await req('/api/login', { method: 'POST', body: { username, password } });
  assert.equal(r.status, 200, `login failed for ${username}`);
  return r.headers.get('set-cookie').split(';')[0];
}

before(async () => {
  server = app.listen(0);
  await new Promise(res => server.once('listening', res));
  base = `http://127.0.0.1:${server.address().port}`;
  adminCookie = await login('admin', 'test-admin-pw');
});

after(() => {
  server.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

test('a client-less dispute event (blank name/email) still gets a displayable title', async () => {
  await req('/webhooks/disputefox', { method: 'POST', body: { action: 'report_imported' } });
  const d = await (await req('/api/activity', { cookie: adminCookie })).json();
  const item = d.items.find(i => i.kind === 'dispute' && i.sub.startsWith('report_imported'));
  assert.ok(item, 'the report_imported event should appear in the feed');
  assert.equal(item.title, 'DisputeFox update');
});

test('a normal dispute event with a real client keeps showing that client\'s name', async () => {
  await req('/webhooks/disputefox', { method: 'POST', body: { client_name: 'Jane Doe', client_email: 'jane@example.com', action: 'response_received', round_number: 2 } });
  const d = await (await req('/api/activity', { cookie: adminCookie })).json();
  const item = d.items.find(i => i.kind === 'dispute' && i.sub.startsWith('response_received'));
  assert.ok(item);
  assert.equal(item.title, 'Jane Doe');
  assert.equal(item.sub, 'response_received · R2');
});
