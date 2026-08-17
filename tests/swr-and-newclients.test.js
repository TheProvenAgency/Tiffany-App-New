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
  assert.ok(/setInterval\(warm, 25 \* 1000\)/.test(src),
    '25s beats the shortest (30s message) TTL, so the background refresh -- never a visitor -- pays for rebuilds');
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

test('one /api/me round-trip per page load, shared by every module', () => {
  // role.js, production.js, disputes.js, team.js and the drawer each asked
  // "who am I?" separately -- four calls per load, each queueing on its own.
  const pub = p => fs.readFileSync(path.join(__dirname, '..', 'public', p), 'utf8');
  const html = pub('index.html');
  assert.ok(/window\.apiMe=function/.test(html), 'the shared promise helper is defined inline');
  assert.ok(html.indexOf('window.apiMe=') < html.indexOf('src="/production.js"'),
    'and defined BEFORE the deferred modules that call it');
  for (const f of ['role.js', 'production.js', 'disputes.js', 'team.js']) {
    assert.ok(!pub(f).includes("fetch('/api/me')"), f + ' goes through the shared helper');
    assert.ok(pub(f).includes('window.apiMe()'), f + ' actually calls it');
  }
});

test('the warm loop also covers the default dashboard range and conversations', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const warm = src.split('const warm = ()')[1].split('};')[0];
  assert.ok(/dash:day:\$\{from\}:\$\{to\}/.test(warm),
    'the "last 30 days" landing view is pre-built with the exact key the browser asks for');
  assert.ok(/29 \* 86400000/.test(warm),
    'using the same UTC to-minus-29-days math as presetRange in index.html');
  assert.ok(/cachedSWR\('messages'/.test(warm), 'conversations stay hot for Messages and reply SLAs');
});

test('New Clients does not undo its own filter on the way in', () => {
  // pvGoNewClients sets the locked newclients filter, then routes through
  // showView('production') -- whose wrapper unconditionally cleared any
  // locked filter (that clear exists so the Deal Production nav button
  // unlocks). Net effect: New Clients applied its filter and wiped it in the
  // same call, rendering the full roster -- identical to Deal Production.
  const prod = fs.readFileSync(path.join(__dirname, '..', 'public', 'production.js'), 'utf8');
  assert.ok(/__pvEnteringLocked=true/.test(prod), 'the shortcut marks its entry as deliberate');
  assert.ok(/lockedFilter&&!window\.__pvEnteringLocked/.test(prod),
    'and the wrapper only clears locks that were NOT just set on purpose');
  const wrapper = prod.split('window.__pvWrap=true')[1];
  assert.ok(/__pvEnteringLocked=false/.test(wrapper),
    'the guard is one-shot, so the nav button still unlocks next time');
});
