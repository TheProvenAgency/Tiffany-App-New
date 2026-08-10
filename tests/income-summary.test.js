// Both the Revenue page and the four Admina KPI tiles used to type out their
// own copy of the monthly income table. They drifted, silently and in the
// direction that matters: public/revenue.js was still summing MFSN through
// June 2026, so every "Total income" figure it produced was short by July's
// $18,113.84, and public/admina-dashboard.html was still rendering a member
// book (1,493 enrolled / 736 actives) the portal had long moved past.
//
// /api/income-summary is now the only place those numbers come from. These
// tests hold it to the two properties that make it safe to depend on:
// the arithmetic is internally consistent, and it agrees with the portal.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const server = require('../server.js');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('every month reports both sources and a total that actually adds up', () => {
  for (const m of server.incomeByMonth()) {
    assert.match(m.ym, /^\d{4}-\d{2}$/, `${m.ym} should be a YYYY-MM key`);
    assert.ok(m.commas >= 0, `${m.ym} commas should not be negative`);
    assert.ok(m.mfsn >= 0, `${m.ym} mfsn should not be negative`);
    assert.equal(m.total, m.commas + m.mfsn,
      `${m.ym}: total ${m.total} should be commas ${m.commas} + mfsn ${m.mfsn}`);
  }
});

test('the MFSN side still reconciles to the portal lifetime figure', () => {
  // Same guarantee mfsn-income.test.js makes about the raw table, asserted
  // again through the endpoint's own output so a bug in the month grouping
  // (dropping or double-counting a month) fails here rather than shipping.
  const total = server.incomeByMonth().reduce((a, m) => a + m.mfsn, 0);
  assert.ok(Math.abs(total - 244194) <= 37,
    `expected roughly the portal's $244,194 lifetime, got ${total}`);
});

test('months come back in chronological order', () => {
  const yms = server.incomeByMonth().map(m => m.ym);
  assert.deepEqual(yms, yms.slice().sort(), 'a chart would render these shuffled');
});

test('the member book is served from one place, not typed into a page', () => {
  const m = server.MFSN_MEMBERS;
  assert.ok(m.enrolled > 0 && m.active > 0 && m.upgraded > 0);
  // Allow a hair of slack: the portal counts "upgraded" and "still to
  // upgrade" on separate tabs, snapshotted seconds apart, so they can land
  // one member either side of the enrolled total. Anything wider than that
  // means a real miscount, not a timing artifact.
  assert.ok(Math.abs((m.upgraded + m.toUpgrade) - m.enrolled) <= 1,
    `upgraded ${m.upgraded} + to-upgrade ${m.toUpgrade} should account for the ${m.enrolled}-member book`);
  assert.ok(m.newActives <= m.targetActives,
    'actives are counted against the promotion target, so cannot exceed it');
});

test('no page carries its own copy of the member counts any more', () => {
  // The specific failure this guards: admina-dashboard.html rendered 1,493
  // enrolled and 736 actives from markup for weeks after the portal moved on,
  // because nothing tied it back to the source.
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'admina-dashboard.html'), 'utf8');
  const body = page.replace(/<!--[\s\S]*?-->/g, '');
  for (const stale of ['1,493', '1493', '736', '1226', '1,226']) {
    assert.ok(!body.includes(stale),
      `admina-dashboard.html still hardcodes ${stale}; it should read /api/income-summary`);
  }
});

test('the endpoint stays cheap enough for four tiles to call it', () => {
  // The tiles fire this on every load. If it ever starts reading the client
  // roster or calling GoHighLevel it stops being a KPI endpoint and becomes
  // a second /api/dashboard -- which is what made the tiles show $0.
  const handler = src.match(/app\.get\('\/api\/mfsn-summary'[\s\S]*?\n\}\);/)[0];
  for (const forbidden of ['readProd', 'ghl.', 'await', 'getClients']) {
    assert.ok(!handler.includes(forbidden),
      `/api/mfsn-summary should not use ${forbidden}`);
  }
});

test('the Revenue page no longer trusts its own hand-copied figures', () => {
  // CO_MONTHLY opened with $543,648 for January -- the lifetime total, not a
  // month -- and then decayed, so the Sales trend showed the business
  // shrinking through 2026 while the transaction records show it growing.
  // The constants survive only as a pre-fetch fallback; what matters is that
  // the page actually replaces them.
  const rev = fs.readFileSync(path.join(__dirname, '..', 'public', 'revenue.js'), 'utf8');
  assert.ok(rev.includes("fetch('/api/mfsn-summary')"),
    'revenue.js should source its figures from the server');
  assert.ok(/INCOME_BY_MONTH\s*=\s*byMonth/.test(rev),
    'revenue.js should overwrite INCOME_BY_MONTH with the served months');
  assert.ok(/MF_MONTHLY\s*=\s*\{\s*labels:/.test(rev.split('hydrateFromServer')[1] || ''),
    'revenue.js should rebuild MF_MONTHLY from the served months');
});

test('the KPI tiles ask the parent for data instead of refetching', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'admina-dashboard.html'), 'utf8');
  const embedded = page.split('window.parent !== window')[1] || '';
  // A self-fetch is only legitimate on the standalone branch. Four embedded
  // frames each pulling /api/dashboard is what produced the 502s.
  assert.ok(/ev\.data\.type\s*[!=]==\s*'msfs-kpi'/.test(page),
    'the tile should handle the pushed payload message');
  const beforeStandalone = page.split('window.parent !== window')[0];
  assert.ok(!beforeStandalone.includes("fetch('/api/dashboard"),
    'an embedded tile must not fetch /api/dashboard itself');
});

test('index.html hands the payload down after it has one', () => {
  const idx = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const fn = idx.split('function broadcastRangeToKpiFrames()')[1].split('}')[0];
  assert.ok(fn.includes('lastDashboard'),
    'the broadcast should carry the payload, not just the range');
  // Broadcasting before the fetch resolves would send null and the tiles
  // would sit on the pending state until the next date change.
  const load = idx.split('async function loadDashboard()')[1] || '';
  const fetchAt = load.indexOf("await fetch('/api/dashboard");
  const castAt = load.indexOf('broadcastRangeToKpiFrames()');
  assert.ok(fetchAt > -1 && castAt > fetchAt,
    'the broadcast must happen after the payload lands');
});

test('income comes from the fast endpoint, not the slow one', () => {
  // /api/dashboard is ~1.8s warm and ~17s on a cold Render container, and
  // while it ran every income figure sat blank -- which reads as broken, and
  // is what "the revenue isn't showing" has been describing. The money is
  // derived from two monthly tables and the payment feed, none of which need
  // the client roster or GoHighLevel, so it can be served in well under a
  // second and must not be gated behind the roster.
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const handler = src.match(/app\.get\('\/api\/mfsn-summary'[\s\S]*?\n\}\);/)[0];
  assert.ok(handler.includes('commasIncomeForRange') && handler.includes('mfsnIncomeForRange'),
    'the fast endpoint should answer income for a window');
  for (const forbidden of ['readProd', 'ghl.', 'await', 'getClients']) {
    assert.ok(!handler.includes(forbidden), `/api/mfsn-summary must not use ${forbidden}`);
  }

  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'admina-dashboard.html'), 'utf8');
  assert.ok(page.includes('sum.income'),
    'the tile should render income straight off the fast endpoint');
  // And the slow payload must never blank out a figure already on screen.
  assert.ok(/classList\.contains\('kpi-pending'\)/.test(page),
    'applyDashboard should only fill income if the fast path has not already');
});

test('the fast endpoint respects the selected window', () => {
  const server = require('../server.js');
  const feb = server.commasIncomeForRange('2026-02-01', '2026-02-28');
  const all = server.commasIncomeForRange(null, null);
  assert.ok(feb < all, 'a one-month window must not return the lifetime figure');
});

test('a stale reply can never overwrite a newer one', () => {
  // The bug this pins: the tile fired an unranged request on load (which the
  // server answers with ALL history) while the parent pushed the real date
  // range a moment later. Whichever reply landed last won, and the unranged
  // one usually did -- so the card read $1,119,071 of lifetime income under a
  // "LAST 30 DAYS" heading. A wrong number under a confident label is worse
  // than a slow one.
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'admina-dashboard.html'), 'utf8');
  assert.ok(/var reqSeq/.test(page), 'requests should be sequenced');
  assert.ok(/mine\s*!==\s*reqSeq/.test(page), 'a superseded reply must be dropped');
  // ...and the failure path needs the same guard, or a slow error clears a
  // figure a newer success already put on screen.
  const catchBlock = page.split('.catch(function(e){')[1] || '';
  assert.ok(catchBlock.indexOf('mine !== reqSeq') < catchBlock.indexOf('n/a'),
    'the catch handler should bail out before blanking the tile');
});

test('an embedded tile waits for the range instead of asking for all history', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'admina-dashboard.html'), 'utf8');
  const embedded = page.split('if (window.parent !== window) {')[1] || '';
  assert.ok(/reqSeq === 0/.test(embedded),
    'the fallback should only fire if no ranged request ever happened');
});
