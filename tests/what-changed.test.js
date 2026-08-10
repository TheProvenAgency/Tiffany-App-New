// The decline card. Its whole justification is that it is built ONLY from
// data that survives scrutiny: the Commas monthly table and the MFSN payout
// table. It deliberately does not attempt a per-product timeline, because the
// payment events' dates don't survive the export -- and a breakdown built on
// those dates is exactly what once reported this business as growing when
// Commas showed it shrinking.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const server = require('../server.js');

const rev = fs.readFileSync(path.join(__dirname, '..', 'public', 'revenue.js'), 'utf8');
const fn = rev.split('function renderWhatChanged()')[1].split('\n}\n')[0];

test('it reads the monthly tables, not the payment events', () => {
  assert.ok(fn.includes('INCOME_BY_MONTH'), 'should use the served monthly table');
  assert.ok(!/series\.revenue|__msfsDash/.test(fn),
    'the day-level payment feed must not be the basis for a month-over-month claim');
});

test('the peak it would find is a real peak in the real data', () => {
  const months = server.incomeByMonth().filter(m => m.commas > 0);
  const peak = months.reduce((a, m) => (m.total > a.total ? m : a), months[0]);
  const last = months[months.length - 1];
  assert.equal(peak.ym, '2025-09', 'Sep 2025 is the best month in the data');
  assert.equal(last.ym, '2026-07');
  assert.ok(peak.total > last.total, 'there is a decline to describe');
});

test('the two sources moved in opposite directions, which is the point of the card', () => {
  // Commas sales collapsed while MFSN commission held. If a future data change
  // makes that untrue the card's closing sentence stops being accurate, so it
  // is worth failing loudly rather than quietly narrating the wrong story.
  const months = server.incomeByMonth().filter(m => m.commas > 0);
  const peak = months.find(m => m.ym === '2025-09');
  const last = months[months.length - 1];
  assert.ok(last.commas < peak.commas * 0.5, 'Commas sales more than halved');
  assert.ok(last.mfsn >= peak.mfsn, 'MFSN commission did not fall');
});

test('the driver is chosen by dollars moved, not percentage', () => {
  // A big percentage swing on a small line is not the story. Naming the wrong
  // driver would point attention at the wrong problem.
  assert.ok(/moveCo\s*>=\s*moveMf/.test(fn),
    'the driver should be whichever source moved more in absolute dollars');
});

test('it says nothing when there is nothing to say', () => {
  assert.ok(/peak===last/.test(fn),
    'if the latest month is the best month there is no decline to narrate');
  assert.ok(/yms\.length<2/.test(fn), 'two months are needed for a comparison');
});
