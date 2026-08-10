// GoHighLevel is one source among several, not a prerequisite for the page.
// It used to be awaited bare in /api/dashboard, so a rejected token threw
// before anything rendered and the entire dashboard went blank -- including
// revenue, which comes from the local event log and the MFSN table and needs
// GHL for nothing. This is the regression test for that.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msfs-degrade-'));
process.env.APP_PASSWORD = 'test-admin-pw';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../server');
const ghl = require('../lib/ghl');
const store = require('../lib/store');

let base, server, adminCookie;
const realFetch = global.fetch;

function req(pathname, { method = 'GET', cookie, body } = {}) {
  return realFetch(base + pathname, {
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
  // Live mode, so the GHL path is actually exercised.
  await req('/api/config', {
    method: 'POST', cookie: adminCookie,
    body: { ghlToken: 'pit-token-that-will-be-rejected', ghlLocationId: 'loc' }
  });
  // server.js only seeds when started directly (require.main === module), so
  // do it here -- the point of this test is that revenue survives without
  // GHL, which needs the sale history actually loaded.
  store.seedCommasPayments();
});

after(() => { server.close(); global.fetch = realFetch; });

test('a rejected GoHighLevel token no longer blanks the whole dashboard', async () => {
  const original = ghl.fetchAllContacts;
  ghl.fetchAllContacts = async () => { throw new Error('GoHighLevel rejected the API token'); };
  try {
    const r = await req('/api/dashboard', { cookie: adminCookie });
    assert.equal(r.status, 200, 'the page must still render when GHL is down');
    const d = await r.json();
    assert.ok(d.kpis, 'kpis must be present so the cards have something to show');
    assert.ok(d.ghlError, 'and the failure must be reported, not swallowed silently');
  } finally {
    ghl.fetchAllContacts = original;
  }
});

test('revenue survives a GoHighLevel outage, because it never needed GHL', async () => {
  const original = ghl.fetchAllContacts;
  ghl.fetchAllContacts = async () => { throw new Error('GoHighLevel rejected the API token'); };
  try {
    const r = await req('/api/dashboard?from=2026-01-01&to=2026-12-31', { cookie: adminCookie });
    const d = await r.json();
    // The seeded Commas backfill covers 2026; MFSN's table covers it too.
    assert.ok(d.kpis.revenueTotal > 0, 'Commas sales come from the local event log');
    assert.ok(d.kpis.mfsnIncomeEst > 0, 'MFSN income comes from the commission table');
    assert.ok(d.kpis.totalIncome >= d.kpis.revenueTotal, 'total blends both sources');
  } finally {
    ghl.fetchAllContacts = original;
  }
});
