const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const store = require('../lib/store.js');

test('a stale cache serves instantly and refreshes behind the reply', async () => {
  // With plain cached(), whoever arrives first after the TTL lapses pays the
  // full rebuild -- here about two seconds -- while everyone behind them gets
  // it free. That first-arriver was the "everything takes 10 seconds" report.
  let builds = 0;
  const fn = async () => { builds++; return 'v' + builds; };
  const first = await store.cachedSWR('swr-test', 1, fn);
  assert.equal(first, 'v1');
  await new Promise(r => setTimeout(r, 10)); // let the TTL lapse
  const t0 = Date.now();
  const second = await store.cachedSWR('swr-test', 1, fn);
  assert.equal(second, 'v1', 'the stale value comes back immediately');
  assert.ok(Date.now() - t0 < 50, 'without waiting on the rebuild');
  await new Promise(r => setTimeout(r, 20));
  const third = await store.cachedSWR('swr-test', 1000, fn);
  assert.equal(third, 'v2', 'and the background refresh landed');
});

test('only the very first request ever waits', async () => {
  let resolve;
  const fn = () => new Promise(r => { resolve = r; });
  const p = store.cachedSWR('swr-cold', 1000, fn);
  await new Promise(r => setTimeout(r, 5)); // let the build actually start
  resolve('built');
  assert.equal(await p, 'built');
});

test('a failed background refresh keeps the stale value rather than throwing', async () => {
  let calls = 0;
  const fn = async () => { calls++; if (calls > 1) throw new Error('down'); return 'good'; };
  await store.cachedSWR('swr-fail', 1, fn);
  await new Promise(r => setTimeout(r, 10));
  const v = await store.cachedSWR('swr-fail', 1, fn);
  assert.equal(v, 'good', 'stale beats an error the caller cannot act on');
});

test('the expensive endpoints use SWR and boot keeps them warm', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(/cachedSWR\('roster:composed'/.test(src));
  assert.ok(/cachedSWR\(cacheKey/.test(src), 'the dashboard payload too');
  assert.ok(/setInterval\(warm, 50 \* 1000\)/.test(src),
    '50s beats the 60s TTL, so the background refresh -- never a visitor -- pays for rebuilds');
});

test('New Clients means bought in the last 30 days, not the whole backlog', () => {
  // The old filter was "anyone in Onboarding or ready" -- the same list Deal
  // Production already shows, 485-day-old entries included.
  const prod = fs.readFileSync(path.join(__dirname, '..', 'public', 'production.js'), 'utf8');
  const f = prod.split("id:'newclients'")[1].split('\n}}')[0];
  assert.ok(/30\*86400000/.test(f), 'a 30-day window on the purchase date');
  assert.ok(!/stage==='Onboarding'\|\|/.test(f), 'the stage-based backlog filter is gone');
  assert.ok(/curSort='paid'; sortDir=-1/.test(prod), 'and the view opens newest first');
});
