// /api/login accepted unlimited guesses. With employee accounts handed out on
// temporary passwords, that is a practical way in, not a theoretical one.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msfs-throttle-'));
process.env.APP_PASSWORD = 'test-admin-pw';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../server');

let base, server;

const login = (username, password) => fetch(base + '/api/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password })
});

before(async () => {
  server = app.listen(0);
  await new Promise(res => server.once('listening', res));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

test('repeated wrong passwords are eventually throttled', async () => {
  let sawThrottle = false;
  for (let i = 0; i < 15; i++) {
    const r = await login('admin', 'guess-' + i);
    if (r.status === 429) { sawThrottle = true; break; }
    assert.equal(r.status, 401, 'before throttling, a wrong password is 401');
  }
  assert.ok(sawThrottle, 'guessing must be cut off, not allowed indefinitely');
});

test('the throttle refuses even the correct password while locked', async () => {
  // Otherwise an attacker who guesses right on attempt 500 still gets in.
  const r = await login('admin', 'test-admin-pw');
  assert.equal(r.status, 429);
  const body = await r.json();
  assert.match(body.error, /too many/i, 'the refusal should explain itself');
});

test('guessing from a rotating client address is still cut off', async () => {
  // Reproduces production: behind Render's edge the observed address is not
  // stable, so an address-keyed counter never accumulates. The account-level
  // backstop has to hold on its own.
  let sawThrottle = false;
  for (let i = 0; i < 40; i++) {
    const r = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${i % 250}` },
      body: JSON.stringify({ username: 'rotating-target', password: 'guess-' + i })
    });
    if (r.status === 429) { sawThrottle = true; break; }
  }
  assert.ok(sawThrottle, 'an attacker rotating addresses must still be stopped');
});

test('a different account is unaffected by another account lockout', async () => {
  // Locking every account because one was attacked would be a denial of
  // service against the whole team. Comes from a fresh address so this isolates
  // the account dimension — the earlier tests already tripped 127.0.0.1's
  // address counter, which is its own correct behavior.
  const r = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.7' },
    body: JSON.stringify({ username: 'someone-else', password: 'whatever' })
  });
  assert.equal(r.status, 401, 'not 429 — neither this account nor this address was attacked');
});
