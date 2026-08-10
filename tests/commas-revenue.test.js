// Commas revenue is hardcoded from Commas' own reporting rather than summed
// from the payment events, because the events cannot be trusted to say WHEN a
// sale happened. Summed by date they gave $14,148 for January 2026; Commas
// itself reports $74,255.19. The export is a good record of which sales
// happened and what was bought -- it is not a good clock.
//
// The old revenue.js made exactly this mistake in the other direction: it
// carried the lifetime total ($874,877) as if it were the year to date, and
// dumped everything older than six months into January. That is what produced
// the Sales-trend cliff.
const { test } = require('node:test');
const assert = require('node:assert');
const server = require('../server.js');

const T = server.COMMAS_MONTHLY_REVENUE;

test('the table reconciles to what Commas reports for each year', () => {
  const sum = (yr) => Object.entries(T)
    .filter(([ym]) => ym.startsWith(yr))
    .reduce((a, [, v]) => a + v, 0);
  assert.ok(Math.abs(sum('2025') - 476399.62) < 0.01,
    `Commas reports $476,399.62 for 2025, table has ${sum('2025').toFixed(2)}`);
  assert.ok(Math.abs(sum('2026') - 398477.68) < 0.01,
    `Commas reports $398,477.68 YTD 2026, table has ${sum('2026').toFixed(2)}`);
});

test('lifetime matches the figure the old code carried as a mislabelled YTD', () => {
  const total = Object.values(T).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 874877.30) < 0.01,
    `expected $874,877.30 lifetime, got ${total.toFixed(2)}`);
});

test('the hardcoded table stops before the current month', () => {
  // Everything after COMMAS_HISTORY_THROUGH must come from the live feed, or
  // today's sales would never appear until someone edited this file.
  const through = server.COMMAS_HISTORY_THROUGH;
  for (const ym of Object.keys(T)) {
    assert.ok(ym <= through,
      `${ym} is past COMMAS_HISTORY_THROUGH (${through}) and would freeze the live feed out`);
  }
});

test('a full-history range returns the full reported lifetime', () => {
  assert.equal(server.commasIncomeForRange(null, null), 874877);
});

test('a single closed month returns that month exactly', () => {
  assert.equal(server.commasIncomeForRange('2026-02-01', '2026-02-28'), 86667);
  assert.equal(server.commasIncomeForRange('2026-07-01', '2026-07-31'), 28500);
});

test('a partial month is apportioned, not counted whole', () => {
  // A closed month is one reported total, not a daily series, so half of
  // July can only ever be an apportionment -- but it must not silently
  // return the whole month, which would overstate every short range.
  const half = server.commasIncomeForRange('2026-07-01', '2026-07-15');
  assert.ok(half > 0 && half < 28500, `expected part of July's $28,500, got ${half}`);
  assert.ok(Math.abs(half - 28500 * (15 / 31)) < 50);
});

test('revenue actually declined through 2026, and the table says so', () => {
  // Worth pinning: an earlier pass reported this trend backwards, off the bad
  // event dates, and told Tiffany the business was growing when Commas shows
  // January at $74,255 falling to $28,500 by July. If a future edit flips
  // this shape again, that is a red flag, not a rounding difference.
  assert.ok(T['2026-01'] > T['2026-07'] * 2,
    'January 2026 was more than double July 2026');
});

test('no invented series survive in the Revenue page', () => {
  // CO_DAILY was thirty hardcoded numbers and CO_WEEKLY twelve, standing in
  // for a daily/weekly sales history that neither Commas nor MFSN reports.
  // Both grains now read the live payment series off the dashboard payload.
  const fs = require('fs');
  const path = require('path');
  const rev = fs.readFileSync(path.join(__dirname, '..', 'public', 'revenue.js'), 'utf8');
  const code = rev.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/var CO_DAILY\s*=/.test(code), 'CO_DAILY should be gone');
  assert.ok(!/var CO_WEEKLY\s*=/.test(code), 'CO_WEEKLY should be gone');
  assert.ok(code.includes('window.__msfsDash'),
    'the daily/weekly grains should read the real payment series');
});

test('the trend chart says nothing rather than drawing a shape it cannot source', () => {
  const fs = require('fs');
  const path = require('path');
  const rev = fs.readFileSync(path.join(__dirname, '..', 'public', 'revenue.js'), 'utf8');
  assert.ok(rev.includes('No day-level sales in this range yet'),
    'an empty range should render an explicit empty state');
});
