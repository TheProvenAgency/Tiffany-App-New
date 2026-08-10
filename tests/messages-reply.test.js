// POST /api/messages/:id/reply — replying to a conversation thread and
// syncing it through GoHighLevel. Same write-gating spirit as sms/status:
// READ_ONLY refuses in live mode, demo mode is a harmless no-op. Open to
// both roles (unlike the client-profile "send SMS" button) -- replying to
// the shared inbox is routine day-to-day client contact, the same as
// Deal Production and Follow-Ups, not admin configuration.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msfs-reply-'));
process.env.APP_PASSWORD = 'test-admin-pw';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../server');
const ghl = require('../lib/ghl');

let base, server, adminCookie, employeeCookie;
const realFetch = global.fetch;

function req(pathname, { method = 'GET', cookie, body } = {}) {
  // realFetch, never the global: these tests stub global.fetch to observe
  // the server's outbound GoHighLevel call, and a stubbed global would
  // otherwise swallow the test's own request to the test server -- capturing
  // the request we sent instead of the one the route made.
  return realFetch(base + pathname, {
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

  await req('/api/users', {
    method: 'POST', cookie: adminCookie,
    body: { username: 'reply-va', name: 'Reply VA', role: 'employee', password: 'va-pw' }
  });
  employeeCookie = await login('reply-va', 'va-pw');
});

after(() => {
  server.close();
  global.fetch = realFetch;
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

// ------------------------- validation -------------------------

test('an empty message is rejected', async () => {
  const r = await req('/api/messages/convo-1/reply', {
    method: 'POST', cookie: adminCookie, body: { contactId: 'c1', message: '   ' }
  });
  assert.equal(r.status, 400);
});

test('a missing contactId is rejected', async () => {
  const r = await req('/api/messages/convo-1/reply', {
    method: 'POST', cookie: adminCookie, body: { message: 'hi' }
  });
  assert.equal(r.status, 400);
});

// ------------------------- demo mode -------------------------

test('demo mode is a harmless no-op, not a real send', async () => {
  const r = await req('/api/messages/convo-1/reply', {
    method: 'POST', cookie: adminCookie, body: { contactId: 'c1', message: 'hello there' }
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.demo, true);
});

// ------------------------- permissions -------------------------

test('an employee can reply to a message too (routine client contact, not admin config)', async () => {
  const r = await req('/api/messages/convo-1/reply', {
    method: 'POST', cookie: employeeCookie, body: { contactId: 'c1', message: 'hi' }
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.demo, true, 'still demo mode at this point in the suite -- no real send');
});

test('an employee can still read the inbox', async () => {
  const r = await req('/api/messages', { cookie: employeeCookie });
  assert.equal(r.status, 200);
});

// ------------------------- live mode -------------------------

test('READ_ONLY refuses a reply against live GoHighLevel', async () => {
  process.env.READ_ONLY = '1';
  await req('/api/config', {
    method: 'POST', cookie: adminCookie,
    body: { ghlToken: 'pit-fake-token', ghlLocationId: 'fake-location' }
  });
  const r = await req('/api/messages/convo-1/reply', {
    method: 'POST', cookie: adminCookie, body: { contactId: 'c1', message: 'test message' }
  });
  assert.equal(r.status, 403);
  const body = await r.json();
  assert.match(body.error, /read-only/i);
  delete process.env.READ_ONLY;
});

test('a live reply calls ghl.sendMessage with the right channel and records the event', async () => {
  let captured = null;
  global.fetch = async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body) };
    return {
      ok: true, status: 200,
      headers: { get: () => null },
      json: async () => ({ messageId: 'msg-123' }),
      text: async () => '{}'
    };
  };

  const r = await req('/api/messages/convo-42/reply', {
    method: 'POST', cookie: adminCookie,
    body: { contactId: 'contact-9', type: 'facebook', message: 'thanks for reaching out!' }
  });
  assert.equal(r.status, 200);
  const resBody = await r.json();
  assert.equal(resBody.ok, true);
  assert.equal(resBody.id, 'msg-123');

  assert.ok(captured, 'ghl.sendMessage should have called fetch');
  assert.match(captured.url, /\/conversations\/messages$/);
  // FACEBOOK (our normalized channel key) must map to GHL's own 'FB' type,
  // not be sent through verbatim -- see SEND_TYPE_MAP in lib/ghl.js.
  assert.equal(captured.body.type, 'FB');
  assert.equal(captured.body.contactId, 'contact-9');
  assert.equal(captured.body.conversationId, 'convo-42');
  assert.equal(captured.body.message, 'thanks for reaching out!');

  global.fetch = realFetch;
});

test('an Email reply includes a subject and html body', async () => {
  let captured = null;
  global.fetch = async (url, opts) => {
    captured = JSON.parse(opts.body);
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: 'msg-email-1' }), text: async () => '{}' };
  };

  const r = await req('/api/messages/convo-7/reply', {
    method: 'POST', cookie: adminCookie,
    body: { contactId: 'contact-1', type: 'EMAIL', message: 'Following up on your account.' }
  });
  assert.equal(r.status, 200);
  assert.equal(captured.type, 'Email');
  assert.ok(captured.subject, 'an email send needs a subject');
  assert.equal(captured.html, 'Following up on your account.');

  global.fetch = realFetch;
});
