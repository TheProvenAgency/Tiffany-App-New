// public/mfsn.js and server.js both carry the MFSN commission figures: the
// page renders the month-by-month table, the server does range math for the
// dashboard. Two copies of the same numbers drift, and the drift is silent --
// this is the check that they haven't.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const mfsnSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'mfsn.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

const COMM = eval(mfsnSrc.match(/var COMM=(\[[\s\S]*?\]);/)[1]);
const M = eval('(' + mfsnSrc.match(/var M=(\{[\s\S]*?\});/)[1] + ')');
const serverTable = eval('({' + serverSrc.match(/const MFSN_MONTHLY_INCOME = \{([\s\S]*?)\};/)[1] + '})');

test('the page and the server hold the same number of months', () => {
  assert.equal(COMM.length, Object.keys(serverTable).length);
});

test('the page and the server agree on the lifetime total', () => {
  const page = COMM.reduce((s, r) => s + r.total, 0);
  const server = Object.values(serverTable).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(page - server) < 0.01,
    `page has ${page.toFixed(2)}, server has ${server.toFixed(2)}`);
});

test('every month on the page matches the server month for month', () => {
  const MON = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
    July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };
  for (const row of COMM) {
    const [name, year] = row.mo.split(' ');
    const ym = `${year}-${String(MON[name]).padStart(2, '0')}`;
    assert.ok(ym in serverTable, `${ym} is on the page but missing from the server table`);
    assert.ok(Math.abs(serverTable[ym] - row.total) < 0.01,
      `${ym}: page ${row.total} vs server ${serverTable[ym]}`);
  }
});

test("the page's headline figures are derived from its own table, not typed separately", () => {
  const lifetime = Math.round(COMM.reduce((s, r) => s + r.total, 0));
  assert.equal(M.lifetime, lifetime, 'M.lifetime should equal the sum of COMM');
  const ytd = Math.round(COMM.filter(r => r.mo.endsWith('2026')).reduce((s, r) => s + r.total, 0));
  assert.equal(M.ytd, ytd, 'M.ytd should equal the 2026 rows of COMM');
  assert.equal(M.latestMonth, Math.round(COMM[0].total), 'M.latestMonth should be the newest row');
});
