// lib/webhook-feed.js -- the real-time webhook activity feed's capture-time
// allowlist/redaction. Tested in isolation, no server needed.
const { test } = require('node:test');
const assert = require('node:assert');

function fresh() {
  delete require.cache[require.resolve('../lib/webhook-feed')];
  return require('../lib/webhook-feed');
}

test('sheet-sync: only allowlisted fields are captured, everything else is dropped at capture time', () => {
  const feed = fresh();
  const body = [{ body: [{
    NAME: 'Jane Doe', PACKAGE: 'Pkg', TU: 'Round 1 login', EQ: '-', EX: '-', Member_List: 'Yes',
    RND_1_DATE: '01/01/2026',
    ROUND_1_CFPB_EMAIL: 'jane@example.com', CFPB_PW_RND_1: 'hunter2',
    Col_2: 'mystery', id: 42, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'
  }] }];
  const entry = feed.record('/sheet-sync', body);
  const item = entry.display.items[0];
  assert.deepEqual(Object.keys(item).sort(), ['NAME', 'PACKAGE', 'RND_1_DATE', 'TU', 'EQ', 'EX', 'Member_List'].sort());
  assert.equal(item.NAME, 'Jane Doe');
  assert.equal(item.RND_1_DATE, '01/01/2026');
  assert.ok(!('CFPB_PW_RND_1' in item), 'CFPB password never enters the buffer');
  assert.ok(!('ROUND_1_CFPB_EMAIL' in item), 'CFPB email never enters the buffer');
  assert.ok(!('Col_2' in item), 'a field not on the allowlist is dropped even though it is not obviously sensitive');
  assert.ok(!('id' in item) && !('createdAt' in item), 'n8n bookkeeping fields are dropped too -- allowlist, not a blocklist');
  assert.ok(!JSON.stringify(entry).includes('hunter2'), 'the plaintext password is nowhere in the captured entry, not even indirectly');
});

test('the hard-block backstop excludes a password/email/secret-shaped key even if it were mis-added to an allowlist', () => {
  const feed = fresh();
  const dangerousAllowlist = ['NAME', 'CFPB_PW_RND_1', 'ROUND_1_CFPB_EMAIL', 'apiSecret', 'authToken'];
  const item = { NAME: 'Jane', CFPB_PW_RND_1: 'hunter2', ROUND_1_CFPB_EMAIL: 'j@x.com', apiSecret: 'sk-abc', authToken: 'tok-123' };
  const out = feed.pickAllowlisted(item, dangerousAllowlist);
  assert.deepEqual(out, { NAME: 'Jane' }, 'every blocked-pattern key is excluded regardless of being on the allowlist');
});

test('other webhook sources (fanbasis, disputefox, mfsn, sms) capture metadata only -- no field content', () => {
  const feed = fresh();
  const e1 = feed.record('/fanbasis', { email: 'buyer@example.com', amount: 49, name: 'Real Person' });
  assert.equal(e1.display.items, null);
  assert.ok(!JSON.stringify(e1).includes('buyer@example.com'));
  assert.ok(!JSON.stringify(e1).includes('Real Person'));

  const e2 = feed.record('/mfsn', { members: [{ email: 'a@x.com' }, { email: 'b@x.com' }] });
  assert.equal(e2.display.itemCount, 2, 'item COUNT is allowed -- structural, not payload content');
  assert.equal(e2.display.items, null);
  assert.ok(!JSON.stringify(e2).includes('a@x.com'));

  const e3 = feed.record('/disputefox', { clientId: 'c1', round: 3, action: 'dispute_sent' });
  assert.equal(e3.display.items, null);

  const e4 = feed.record('/sms', { direction: 'inbound', phone: '+15551234567' });
  assert.equal(e4.display.items, null);
  assert.ok(!JSON.stringify(e4).includes('5551234567'));
});

test('summary text matches the requested format, e.g. "MFSN sync · 5 items"', () => {
  const feed = fresh();
  const e = feed.record('/mfsn', { members: [1, 2, 3, 4, 5] });
  assert.equal(e.summary, 'MFSN sync · 5 items');
});

test('the ring buffer is capped and drops the oldest entries', () => {
  const feed = fresh();
  for (let i = 0; i < 55; i++) feed.record('/mfsn', { members: [] });
  assert.equal(feed.since(0).length, 50);
});

test('since(afterId) returns only strictly newer entries, oldest first', () => {
  const feed = fresh();
  const a = feed.record('/mfsn', {});
  const b = feed.record('/mfsn', {});
  const c = feed.record('/mfsn', {});
  const got = feed.since(a.id);
  assert.deepEqual(got.map(e => e.id), [b.id, c.id]);
});

test('setStatus attaches the response status code to the right entry', () => {
  const feed = fresh();
  const e = feed.record('/mfsn', {});
  feed.setStatus(e.id, 401);
  assert.equal(feed.since(0)[0].status, 401);
});
