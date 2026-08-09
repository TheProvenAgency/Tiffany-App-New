// store.cached() backs readProd() -- a ~18-20s cold Postgres reconstruction
// behind a 30s TTL. Without single-flight dedup, N concurrent requests
// hitting a cold/expired key would each kick off their own reconstruction.
// These tests use a fresh require() (store.js's memCache/inFlight are
// module-level) and a counting fn to prove dedup, not just inspect code.
const { test } = require('node:test');
const assert = require('node:assert');

function freshStore() {
  delete require.cache[require.resolve('../lib/store')];
  return require('../lib/store');
}

test('cached(): concurrent callers on a cold key share one underlying call', async () => {
  const store = freshStore();
  let calls = 0;
  const slowFn = () => new Promise(resolve => {
    calls++;
    setTimeout(() => resolve('result-' + calls), 50);
  });

  const results = await Promise.all([
    store.cached('stampede-key', 1000, slowFn),
    store.cached('stampede-key', 1000, slowFn),
    store.cached('stampede-key', 1000, slowFn),
    store.cached('stampede-key', 1000, slowFn),
    store.cached('stampede-key', 1000, slowFn)
  ]);

  assert.equal(calls, 1, 'fn should have been invoked exactly once for 5 concurrent cold-cache callers');
  assert.deepEqual(results, ['result-1', 'result-1', 'result-1', 'result-1', 'result-1'],
    'every concurrent caller should receive the same shared result');
});

test('cached(): a fresh (non-expired) hit never touches fn again', async () => {
  const store = freshStore();
  let calls = 0;
  const fn = () => { calls++; return Promise.resolve('v' + calls); };

  const first = await store.cached('fresh-key', 10000, fn);
  const second = await store.cached('fresh-key', 10000, fn);

  assert.equal(calls, 1);
  assert.equal(first, 'v1');
  assert.equal(second, 'v1');
});

test('cached(): after TTL expiry, a new stampede triggers exactly one new call', async () => {
  const store = freshStore();
  let calls = 0;
  const fn = () => Promise.resolve('v' + (++calls));

  const initial = await store.cached('ttl-key', 20, fn);
  assert.equal(initial, 'v1');

  await new Promise(resolve => setTimeout(resolve, 30)); // let the 20ms TTL expire

  const [a, b, c] = await Promise.all([
    store.cached('ttl-key', 20, fn),
    store.cached('ttl-key', 20, fn),
    store.cached('ttl-key', 20, fn)
  ]);

  assert.equal(calls, 2, 'exactly one new call for the post-expiry stampede, not three');
  assert.equal(a, 'v2');
  assert.equal(b, 'v2');
  assert.equal(c, 'v2');
});

test('cached(): a rejected fn() does not poison future calls', async () => {
  const store = freshStore();
  let calls = 0;
  const fn = () => {
    calls++;
    return calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve('recovered');
  };

  await assert.rejects(() => store.cached('error-key', 1000, fn), /boom/);
  const value = await store.cached('error-key', 1000, fn);

  assert.equal(calls, 2, 'a failed call must not leave a stale in-flight entry blocking retries');
  assert.equal(value, 'recovered');
});
