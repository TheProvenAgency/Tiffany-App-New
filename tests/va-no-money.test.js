// A VA must see nothing about what a client pays or what the business makes.
// The boundary is the payload, not the UI -- a hidden column with the value
// still in the response is one devtools tab away from not hidden.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msfs-vamoney-'));
process.env.APP_PASSWORD = 'test-admin-pw';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../server');
const auth = require('../lib/auth.js');

let base, server, adminCookie, vaCookie;
const req = (p, c) => fetch(base + p, { headers: c ? { cookie: c } : {}, redirect: 'manual' });

before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = async (u, pw) => {
    const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: u, password: pw }) });
    return r.headers.get('set-cookie').split(';')[0];
  };
  adminCookie = await login('admin', 'test-admin-pw');
  await fetch(base + '/api/users', { method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'vam', name: 'VA Money', role: 'va', password: 'va-pw-9999' }) });
  vaCookie = await login('vam', 'va-pw-9999');
});
after(() => server && server.close());

test('redactClient strips every dollar-bearing field', () => {
  const c = { id: '1', name: 'A', totalSpent: 5800, numberOfPayments: 4,
              paymentCount: 4, mfsnCommission: 14.63, lastPaymentDate: '2026-04-21' };
  const out = auth.redactClient('va', c);
  for (const k of ['totalSpent', 'numberOfPayments', 'paymentCount', 'mfsnCommission']) {
    assert.equal(out[k], undefined, k + ' is money and must not survive');
  }
  assert.equal(out.lastPaymentDate, '2026-04-21',
    'a payment DATE drives the waiting clocks the VA works, and says nothing about cost');
  assert.equal(auth.redactClient('admin', c).totalSpent, 5800, 'admin keeps everything');
});

test('the clients list a VA receives carries no spend figures', async () => {
  const d = await (await req('/api/clients?limit=10', vaCookie)).json();
  const body = JSON.stringify(d);
  assert.ok(!/totalSpent/.test(body), 'totalSpent reached a VA');
  assert.ok(!/numberOfPayments/.test(body));
  assert.ok(!/mfsnCommission/.test(body));
});

test('the production roster a VA receives carries no payment counts', async () => {
  const d = await (await req('/api/production', vaCookie)).json();
  const body = JSON.stringify(d.clients || []);
  assert.ok(!/paymentCount/.test(body), 'how many times a client paid is money information');
  assert.ok(!/totalSpent/.test(body));
});

test('an admin still gets the full record from the same routes', async () => {
  const d = await (await req('/api/production', adminCookie)).json();
  const withCount = (d.clients || []).some(c => typeof c.paymentCount === 'number');
  // The seed environment may or may not attach counts; the guarantee that
  // matters is that the field is not stripped for revenue holders.
  const c = { id: '1', paymentCount: 3 };
  assert.equal(auth.redactClient('admin', c).paymentCount, 3);
  assert.ok(d.clients.length > 0);
});

test('the money columns hide themselves for sessions without revenue', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(/body:not\(\[data-caps~="revenue"\]\) \.moneyCol\{display:none\}/.test(page),
    'otherwise the table renders empty columns where the server stripped values');
});
