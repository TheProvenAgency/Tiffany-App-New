// Real purchase dates per client, from the Commas payment events.
//
// These events were previously written off as undated. That was wrong: the
// check that condemned them summed a store that had not been seeded, got
// $14,148 for January against Commas' $74,255, and blamed the data. Summed
// properly the seed lands within 5% of Commas every month and matches July
// exactly. These tests pin the behaviour that depends on that.
const { test } = require('node:test');
const assert = require('node:assert');
const purchases = require('../lib/purchases.js');

const ev = (over) => Object.assign({
  at: '2026-01-10T00:00:00.000Z', amount: 250, name: 'Jane Doe', email: 'jane@x.com'
}, over);

test('first purchase is the earliest event, not the latest', () => {
  // The whole point. GHL only carries the LAST payment, so a client who bought
  // in January and paid again in April looked four months newer than they were.
  const [c] = purchases.attach([{ id: '1', name: 'Jane Doe', email: 'jane@x.com' }], [
    ev({ at: '2026-04-02T00:00:00.000Z' }),
    ev({ at: '2026-01-10T00:00:00.000Z' }),
    ev({ at: '2026-02-20T00:00:00.000Z' })
  ]);
  assert.equal(c.firstPaid, '2026-01-10T00:00:00.000Z');
  assert.equal(c.lastPaid, '2026-04-02T00:00:00.000Z');
  assert.equal(c.paymentCount, 3);
});

test('email wins over name when both would match', () => {
  const [c] = purchases.attach([{ id: '1', name: 'Jane Doe', email: 'jane@x.com' }], [
    ev({ email: 'jane@x.com', name: 'Someone Else', at: '2026-03-01T00:00:00.000Z' }),
    ev({ email: 'other@x.com', name: 'Jane Doe', at: '2020-01-01T00:00:00.000Z' })
  ]);
  assert.equal(c.paidSource, 'commas:email');
  assert.equal(c.firstPaid, '2026-03-01T00:00:00.000Z',
    'the name match must not drag in a stranger\'s earlier purchase');
});

test('a name match is recorded as such, so it can be distrusted', () => {
  const [c] = purchases.attach([{ id: '1', name: 'Jane Doe', email: null }], [ev({ email: null })]);
  assert.equal(c.paidSource, 'commas:name');
});

test('no match falls back to the GHL date but never calls it a first purchase', () => {
  // A last payment is not a first purchase. Reporting one as the other would
  // silently understate every wait computed from it.
  const [c] = purchases.attach(
    [{ id: '1', name: 'Nobody', email: 'nobody@x.com', lastPaymentDate: '2026-05-01' }],
    [ev()],
    { fallback: x => x.lastPaymentDate }
  );
  assert.equal(c.firstPaid, null);
  assert.equal(c.lastPaid, '2026-05-01');
  assert.equal(c.paidSource, 'ghl:last-payment');
  assert.equal(c.paymentCount, 0);
});

test('a client with nothing anywhere gets nulls, not a guess', () => {
  const [c] = purchases.attach([{ id: '1', name: 'Ghost', email: 'g@x.com' }], []);
  assert.equal(c.firstPaid, null);
  assert.equal(c.lastPaid, null);
  assert.equal(c.paidSource, null);
});

test('purchasedAt prefers the real first purchase over a stand-in', () => {
  assert.equal(purchases.purchasedAt({ firstPaid: 'A', lastPaid: 'B' }), 'A');
  assert.equal(purchases.purchasedAt({ firstPaid: null, lastPaid: 'B' }), 'B');
  assert.equal(purchases.purchasedAt({}), null);
  assert.equal(purchases.purchasedAt(null), null);
});

test('undated events are ignored rather than sorting to the front', () => {
  const [c] = purchases.attach([{ id: '1', name: 'Jane Doe', email: 'jane@x.com' }], [
    ev({ at: null }), ev({ at: '2026-06-01T00:00:00.000Z' })
  ]);
  assert.equal(c.firstPaid, '2026-06-01T00:00:00.000Z');
  assert.equal(c.paymentCount, 1);
});

test('totals accumulate per client', () => {
  const [c] = purchases.attach([{ id: '1', name: 'Jane Doe', email: 'jane@x.com' }],
    [ev({ amount: 100 }), ev({ amount: 250, at: '2026-02-01T00:00:00.000Z' })]);
  assert.equal(c.paymentCount, 2);
});

test('an abbreviated sheet name matches a full Commas name', () => {
  // Deal Production came from a spreadsheet: names are a first name and a last
  // initial ("April O.") and there is no email column. Neither exact key can
  // ever match one of those rows, so the coarse key is the only way in.
  const [c] = purchases.attach([{ id: '1', name: 'Mariah B.' }],
    [ev({ name: 'Mariah Bell', email: 'm@x.com', at: '2026-02-02T00:00:00.000Z' })]);
  assert.equal(c.firstPaid, '2026-02-02T00:00:00.000Z');
  assert.equal(c.paidSource, 'commas:initial');
});

test('an ambiguous initial match is refused, not guessed', () => {
  // "April O." against two different April O-somethings would hand one of them
  // the other's purchase date. A confidently wrong date is worse than none.
  const [c] = purchases.attach([{ id: '1', name: 'April O.' }], [
    ev({ name: 'April Orum', email: 'a@x.com', at: '2026-01-10T00:00:00.000Z' }),
    ev({ name: 'April Osborne', email: 'b@x.com', at: '2026-03-01T00:00:00.000Z' })
  ]);
  assert.equal(c.firstPaid, null);
  assert.equal(c.paidSource, 'ambiguous');
});

test('an ambiguous match still takes the GHL stand-in if there is one', () => {
  const [c] = purchases.attach([{ id: '1', name: 'April O.', lastPaymentDate: '2026-05-01' }], [
    ev({ name: 'April Orum', email: 'a@x.com' }),
    ev({ name: 'April Osborne', email: 'b@x.com' })
  ], { fallback: x => x.lastPaymentDate });
  assert.equal(c.lastPaid, '2026-05-01');
  assert.equal(c.paidSource, 'ghl:last-payment');
});

test('against the real data, most of the roster gets a real purchase date', () => {
  // Regression guard with teeth: run the shipped seed against the shipped
  // roster. Before this matcher existed the answer was zero, because the exact
  // keys could never match an abbreviated name.
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..');
  const seed = JSON.parse(fs.readFileSync(path.join(root, 'seed', 'commas-payments-seed.json'), 'utf8'));
  const prodRaw = JSON.parse(fs.readFileSync(path.join(root, 'seed', 'production-seed.json'), 'utf8'));
  const prod = Array.isArray(prodRaw) ? prodRaw : (prodRaw.clients || []);

  const out = purchases.attach(prod, seed);
  const withDate = out.filter(c => c.firstPaid).length;
  const ambiguous = out.filter(c => c.paidSource === 'ambiguous').length;

  assert.ok(withDate > prod.length * 0.7,
    `expected most of the ${prod.length} clients to get a real purchase date, got ${withDate}`);
  assert.ok(ambiguous > 0, 'some names genuinely collide; refusing them is the point');
  assert.ok(ambiguous < prod.length * 0.2,
    `${ambiguous} ambiguous is too many -- the key is too coarse to be useful`);
});

test('the real seed reconciles with Commas, which is why the dates are trusted', () => {
  // The evidence that overturned the earlier "these dates are unusable" call.
  // July is exact; the whole file is within 5% of Commas' reported lifetime.
  const fs = require('fs');
  const path = require('path');
  const seed = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'seed', 'commas-payments-seed.json'), 'utf8'));
  const july = seed.filter(e => String(e.at).slice(0, 7) === '2026-07')
    .reduce((a, e) => a + (e.amount || 0), 0);
  assert.equal(Math.round(july), 28500, "July should match Commas' own $28,500");
  const total = seed.reduce((a, e) => a + (e.amount || 0), 0);
  assert.ok(total > 874877 * 0.94, `seed total ${Math.round(total)} is too far below Commas' lifetime`);
});
