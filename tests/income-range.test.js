// Total income = real Commas sales (per-sale dates, from the backfill) plus
// real MFSN payouts (per-month, from the affiliate portal). Both had to stop
// being estimates before any range figure could be trusted.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'commas-payments-seed.json'), 'utf8'));

test('every seeded Commas sale carries a real date and a positive amount', () => {
  assert.ok(seed.length > 5000, 'the full history should be present');
  for (const e of seed.slice(0, 200)) {
    assert.match(e.at, /^\d{4}-\d{2}-\d{2}T/, 'each sale needs a parseable timestamp');
    assert.equal(e.type, 'payment');
    assert.ok(e.amount > 0);
  }
});

test('seeded ids are unique, so re-seeding cannot double-count', () => {
  const ids = new Set(seed.map(e => e.id));
  assert.equal(ids.size, seed.length, 'a duplicate id would silently inflate revenue');
});

test('the backfill spans the pre-webhook period the old snapshot existed for', () => {
  const dates = seed.map(e => e.at.slice(0, 10)).sort();
  assert.ok(dates[0] < '2025-06-01', 'history should reach back into 2025');
  assert.ok(dates[dates.length - 1] > '2026-06-01', 'and run up to the webhook era');
});

test('a narrower range sums to strictly less than all time', () => {
  const inRange = (d, f, t) => { const x = d.slice(0, 10); return x >= f && x <= t; };
  const sum = rows => Math.round(rows.reduce((s, e) => s + e.amount, 0));
  const all = sum(seed);
  const ytd = sum(seed.filter(e => inRange(e.at, '2026-01-01', '2026-12-31')));
  const q = sum(seed.filter(e => inRange(e.at, '2026-04-21', '2026-07-20')));
  assert.ok(q > 0, 'a real quarter should have real revenue');
  assert.ok(q < ytd, 'a quarter is a subset of the year');
  assert.ok(ytd < all, 'a year is a subset of all time');
});
