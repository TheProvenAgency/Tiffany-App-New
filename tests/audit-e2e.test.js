// End-to-end over real HTTP: the audit must be flawless, so this doesn't
// trust unit tests -- it boots the actual server as a child process, logs
// in through the real login route, marks a real roster client through the
// real API, KILLS the server, boots a second one on the same data dir, and
// checks the mark came back and sorts into the right filter. That is the
// exact "close the app and come back" path.
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn, execSync } = require('child_process');
const path = require('path');

const PORT = 4771;
const DATA = '/tmp/audit-e2e-data';
const PASS = 'e2e-scratch-' + Date.now(); // invented for this run only

function boot() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_PASSWORD: PASS },
    stdio: 'ignore'
  });
  return child;
}
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/login.html`);
      if (r.ok) return;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('server never came up');
}
async function login() {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: PASS })
  });
  assert.ok(r.ok, 'login works');
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie, 'a session cookie came back');
  return cookie;
}

test('an audit mark survives a full server restart and lands in the right filter', { timeout: 120000 }, async () => {
  execSync(`rm -rf ${DATA} && mkdir -p ${DATA}`);
  let child = boot();
  try {
    await waitUp();
    await new Promise(r => setTimeout(r, 4000)); // let the roster seed finish
    const cookie = await login();
    const H = { Cookie: cookie, 'Content-Type': 'application/json' };

    // the real roster, through the real route
    const list = await (await fetch(`http://127.0.0.1:${PORT}/api/audit`, { headers: H })).json();
    assert.ok(Array.isArray(list.rows) && list.rows.length > 100, 'thousands of real clients load');
    assert.equal(list.totals.audited, 0, 'a fresh book starts un-audited');
    const target = list.rows[0];

    // mark through the real route
    const marked = await (await fetch(`http://127.0.0.1:${PORT}/api/audit/${encodeURIComponent(target.id)}`, {
      method: 'POST', headers: H, body: JSON.stringify({ outcome: 'graduated' })
    })).json();
    assert.equal(marked.ok, true);
    assert.equal(marked.audit.outcome, 'graduated');
    assert.equal(marked.audit.who, 'Admin', 'credited to whoever clicked');

    // read it straight back
    const again = await (await fetch(`http://127.0.0.1:${PORT}/api/audit`, { headers: H })).json();
    assert.equal(again.totals.audited, 1);
    assert.equal(again.totals.graduated, 1, 'sorted into the right bucket');
    assert.equal(again.rows.find(r => r.id === target.id).audit.outcome, 'graduated');

    // THE test: kill the app entirely, boot a fresh one, log in fresh
    child.kill('SIGKILL');
    await new Promise(r => setTimeout(r, 1000));
    child = boot();
    await waitUp();
    await new Promise(r => setTimeout(r, 4000));
    const cookie2 = await login();
    const after = await (await fetch(`http://127.0.0.1:${PORT}/api/audit`, { headers: { Cookie: cookie2 } })).json();
    assert.equal(after.totals.audited, 1, 'the mark survived the restart');
    assert.equal(after.totals.graduated, 1, 'still in the right bucket');
    const row = after.rows.find(r => r.id === target.id);
    assert.equal(row.audit.outcome, 'graduated');
    assert.equal(row.audit.who, 'Admin', 'who and when survived too');

    // and a clear works end-to-end as well
    const cleared = await (await fetch(`http://127.0.0.1:${PORT}/api/audit/${encodeURIComponent(target.id)}`, {
      method: 'POST', headers: { Cookie: cookie2, 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome: null })
    })).json();
    assert.equal(cleared.ok, true);
    const final = await (await fetch(`http://127.0.0.1:${PORT}/api/audit`, { headers: { Cookie: cookie2 } })).json();
    assert.equal(final.totals.audited, 0, 'undo returns them to the to-do pile');
  } finally {
    child.kill('SIGKILL');
    execSync(`rm -rf ${DATA}`);
  }
});
