// MFSN pays monthly and exposes no per-day feed, so the income table is the
// portal's own Commission Summary export. The lifetime sum agreeing with the
// portal's own "LT" figure is what proves the table is complete rather than
// a partial hand-copy (an earlier version had only 11 of the 37 months).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const table = eval('({' + src.match(/const MFSN_MONTHLY_INCOME = \{([\s\S]*?)\};/)[1] + '})');

test('the commission table covers every month the portal reports', () => {
  const months = Object.keys(table).sort();
  assert.equal(months.length, 37, 'the portal reports 37 months of commission');
  assert.equal(months[0], '2023-07');
  assert.equal(months[months.length - 1], '2026-07');
});

test('the table sums to the affiliate portal\'s own lifetime figure', () => {
  const total = Object.values(table).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 244194.34) < 0.01,
    `expected the portal's $244,194.34 lifetime, got ${total.toFixed(2)}`);
});

test('every month is a real non-negative payout', () => {
  for (const [ym, v] of Object.entries(table)) {
    assert.match(ym, /^\d{4}-\d{2}$/, `${ym} should be a YYYY-MM key`);
    assert.ok(typeof v === 'number' && v >= 0, `${ym} should carry a real amount`);
  }
});

test('commission grew over time, so an early month is far below a recent one', () => {
  // Sanity that the months aren't shuffled: Jul 2023 was the very start of
  // the affiliate book, Jul 2026 is the current run-rate.
  assert.ok(table['2026-07'] > table['2023-08'] * 100);
});
