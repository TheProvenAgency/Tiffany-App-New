// Page load was 10-14 seconds. Measured where it went: /api/ops 13.7s,
// /api/onboarding 12.7s, /api/dashboard 11.6s, /api/upsell 9.8s -- with tiny,
// gzipped payloads. The time was server CPU: each endpoint independently
// composed the full roster (parse 3,891 records, read the GHL roster, match
// 5,133 payment events, tag MFSN) and the dashboard fires them concurrently,
// so one small CPU did the same two-second job four times at once while the
// requests starved each other.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('the four roster endpoints share one cached composition', () => {
  assert.ok(/function composedRoster\(\)/.test(src));
  assert.ok(/store\.cached\('roster:composed'/.test(src),
    'cached() also collapses concurrent callers onto one in-flight build');
  for (const route of ["app.get('/api/production'", "app.get('/api/ops'",
                       "app.get('/api/onboarding'", "app.get('/api/upsell'"]) {
    const body = src.split(route)[1].split('\n});')[0];
    assert.ok(/composedRoster\(\)/.test(body), route + ' should use the shared build');
  }
});

test('an edit invalidates the shared roster, on both patch routes', () => {
  // Cached for speed; an edit is exactly what makes it stale. Without this a
  // stage change looked ignored for up to a minute.
  for (const route of ["app.patch('/api/production/:id'", "app.patch('/api/disputes/:id'"]) {
    const body = src.split(route)[1].split('\n});')[0];
    assert.ok(/clearCacheKey\('roster:composed'\)/.test(body), route + ' must invalidate');
  }
});

test('clicking a lead opens the drawer immediately, before the roster loads', () => {
  // The roster is a multi-second fetch on first use, and pvOpenClient waited
  // for it before touching the DOM -- so a Dashboard click produced nothing
  // for seconds, which reads as broken. Same bug, same fix, as openClient.
  const prod = fs.readFileSync(path.join(__dirname, '..', 'public', 'production.js'), 'utf8');
  const fn = prod.split('window.pvOpenClient=function(id){')[1].split('\n};')[0];
  const openAt = fn.indexOf("classList.add('open')");
  const loadAt = fn.indexOf('loadThen(');
  assert.ok(openAt > -1 && openAt < loadAt, 'drawer shell first, fetch second');
  assert.ok(/Loading/.test(fn));
  assert.ok(/Could not find this client/.test(fn), 'a miss must say so, not hang on Loading');
});

test('every "+N more" goes somewhere', () => {
  // It was plain text. A count that looks like a link and does nothing is
  // worse than no count.
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  // class="wl-more" only -- a bare /wl-more[^>]*/ also matches the CSS rule,
  // since [^>] happily crosses newlines.
  const mores = page.match(/class="wl-more"[^\n]*/g) || [];
  assert.ok(mores.length >= 4);
  for (const m of mores) {
    assert.ok(/onclick=/.test(m), 'this overflow count is dead: ' + m);
  }
});

test('the dashboard payload is cached per range, and webhooks drop it', () => {
  // ~2s of bucketing per call, and the same range is asked for repeatedly --
  // a reload, the KPI-tile handshake, a preset clicked back and forth.
  const route = src2().split("app.get('/api/dashboard'")[1].split('\n});')[0];
  assert.ok(route.includes('store.cached(cacheKey') && route.includes('`dash:${granularity}'),
    'keyed by range, or one range would serve another');
  // Webhook writes call store.clearCache(), which clears every key including
  // these -- that is the freshness guarantee.
  assert.ok(/clearCache\(\)/.test(src2()));
});

function src2() {
  return fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
}
