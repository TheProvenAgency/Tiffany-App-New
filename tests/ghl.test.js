// GoHighLevel is rate-limited (the README leans on caching to cope) and the
// dashboard pulls many pages at once, so transient 429s are expected. A single
// one used to fail the whole dashboard. fetch is mocked here — no real keys.
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const ghl = require('../lib/ghl');

const cfg = { ghlToken: 'pit-x', ghlLocationId: 'loc' };
const realFetch = global.fetch;

// Retry without real waiting.
ghl._setRetry({ tries: 3, baseDelayMs: 0, timeoutMs: 50 });

let calls;
function mock(sequence) {
  calls = 0;
  global.fetch = async () => {
    const r = sequence[Math.min(calls, sequence.length - 1)];
    calls++;
    if (r.throwName) { const e = new Error('network'); e.name = r.throwName; throw e; }
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: h => (r.headers && r.headers[h.toLowerCase()]) || null },
      json: async () => r.body || {},
      text: async () => JSON.stringify(r.body || {})
    };
  };
}
afterEach(() => { global.fetch = realFetch; });

test('a transient 429 is retried and then succeeds', async () => {
  mock([{ status: 429 }, { status: 200, body: { total: 42 } }]);
  const r = await ghl.testConnection(cfg);
  assert.equal(r.ok, true);
  assert.equal(r.totalContacts, 42);
  assert.equal(calls, 2, 'it should have retried exactly once');
});

test('a bad token fails immediately with a clear message and no retry', async () => {
  mock([{ status: 401, body: { message: 'invalid token' } }]);
  await assert.rejects(() => ghl.testConnection(cfg), err => {
    assert.match(err.message, /token/i, 'the message must point at the token');
    assert.equal(err.retryable, false);
    return true;
  });
  assert.equal(calls, 1, 'an auth failure must not be retried');
});

test('persistent rate-limiting gives up with a rate-limit message', async () => {
  mock([{ status: 429 }]);
  await assert.rejects(() => ghl.testConnection(cfg), err => {
    assert.match(err.message, /rate|limit/i);
    assert.equal(err.retryable, true);
    return true;
  });
  assert.equal(calls, 3, 'it should try the configured number of times then stop');
});

test('a server error is retried', async () => {
  mock([{ status: 503 }, { status: 200, body: { total: 1 } }]);
  const r = await ghl.testConnection(cfg);
  assert.equal(r.ok, true);
  assert.equal(calls, 2);
});

test('a timeout is retried and then succeeds', async () => {
  mock([{ throwName: 'AbortError' }, { status: 200, body: { total: 7 } }]);
  const r = await ghl.testConnection(cfg);
  assert.equal(r.totalContacts, 7);
  assert.equal(calls, 2);
});

test('Retry-After is honored when the server sends it', async () => {
  // Not asserting the wall-clock wait (baseDelayMs is 0 here); just that a
  // 429 carrying Retry-After is still treated as retryable and recovers.
  mock([{ status: 429, headers: { 'retry-after': '0' } }, { status: 200, body: { total: 3 } }]);
  const r = await ghl.testConnection(cfg);
  assert.equal(r.totalContacts, 3);
  assert.equal(calls, 2);
});

test('createContact creates a new contact and normalizes the response', async () => {
  mock([{ status: 200, body: { contact: { id: 'c1', firstName: 'Jane', lastName: 'Doe', email: 'jane@x.com' } } }]);
  const r = await ghl.createContact(cfg, { firstName: 'Jane', lastName: 'Doe', email: 'jane@x.com' });
  assert.equal(r.duplicate, false);
  assert.equal(r.contact.id, 'c1');
  assert.equal(r.contact.name, 'Jane Doe');
});

test('createContact treats a duplicate-contact 400 as a normal outcome, not a failure', async () => {
  mock([{ status: 400, body: { message: 'duplicate contact', meta: { contactId: 'existing-1' } } }]);
  const r = await ghl.createContact(cfg, { firstName: 'Jane', email: 'jane@x.com' });
  assert.equal(r.duplicate, true);
  assert.equal(r.existingId, 'existing-1');
  assert.match(r.message, /duplicate/i);
});

test('createContact still throws on an unrelated 400 with no contactId', async () => {
  mock([{ status: 400, body: { message: 'missing required field' } }]);
  await assert.rejects(() => ghl.createContact(cfg, { firstName: 'Jane' }));
});
