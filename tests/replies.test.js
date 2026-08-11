// Conversations where the client spoke last and nobody answered. 83 of the
// last 300 are in that state on the live account, 35 of them 4-7 days old.
const { test } = require('node:test');
const assert = require('node:assert');
const replies = require('../lib/replies.js');

const NOW = new Date('2026-08-11T12:00:00Z').getTime();
const hoursAgo = h => new Date(NOW - h * 3600000).toISOString();
const c = (over) => Object.assign({
  id: 'x', name: 'A Client', channelKey: 'SMS', channel: 'SMS',
  lastDirection: 'inbound', lastAt: hoursAgo(1), lastBody: 'hi', unread: 1
}, over);

test('only conversations the client spoke last in are waiting', () => {
  const q = replies.buildQueue([
    c({ id: 'theirs', lastDirection: 'inbound' }),
    c({ id: 'ours', lastDirection: 'outbound' })
  ], { now: NOW });
  assert.deepEqual(q.items.map(i => i.id), ['theirs']);
});

test('a reaction is not somebody waiting on a reply', () => {
  // "Loved a message" coming back as the last inbound event is not a question.
  // Counting it would pad the queue with work that does not exist.
  const q = replies.buildQueue([
    c({ id: 'react', channelKey: 'SMS_REACTION', lastBody: 'Loved "I got you boo."' }),
    c({ id: 'real' })
  ], { now: NOW });
  assert.deepEqual(q.items.map(i => i.id), ['real']);
});

test('the SLA is in days but the clock is in hours', () => {
  // A message from this morning and one from three days ago are both "0d" and
  // "3d" respectively, but the boundary has to fall at the hour or a message
  // sent 47 hours ago reads the same as one sent 25.
  const q = replies.buildQueue([
    c({ id: 'in', lastAt: hoursAgo(47) }),
    c({ id: 'out', lastAt: hoursAgo(49) })
  ], { now: NOW, slaDays: 2 });
  const by = Object.fromEntries(q.items.map(i => [i.id, i]));
  assert.equal(by.in.flagged, false, '47 hours is inside a two-day window');
  assert.equal(by.out.flagged, true);
});

test('longest wait first', () => {
  const q = replies.buildQueue([
    c({ id: 'a', lastAt: hoursAgo(10) }),
    c({ id: 'b', lastAt: hoursAgo(200) }),
    c({ id: 'c', lastAt: hoursAgo(50) })
  ], { now: NOW });
  assert.deepEqual(q.items.map(i => i.id), ['b', 'c', 'a']);
});

test('an undated conversation is shown, never called late, and sorts last', () => {
  const q = replies.buildQueue([
    c({ id: 'nodate', lastAt: null }),
    c({ id: 'old', lastAt: hoursAgo(300) })
  ], { now: NOW });
  const by = Object.fromEntries(q.items.map(i => [i.id, i]));
  assert.equal(by.nodate.waitingHours, null);
  assert.equal(by.nodate.flagged, false, 'an unknown wait is not a breach');
  assert.equal(q.items[q.items.length - 1].id, 'nodate');
});

test('totals say how many conversations were actually looked at', () => {
  // The feed is capped at the 300 most recent. Reporting "83 waiting" without
  // that context claims a search of all history that never happened.
  const q = replies.buildQueue([c({ id: 'a' }), c({ id: 'b', lastDirection: 'outbound' })], { now: NOW });
  assert.equal(q.totals.scanned, 2);
  assert.equal(q.totals.waiting, 1);
});

test('unread and waiting are different things and both survive', () => {
  // A conversation can be read and still unanswered -- somebody opened it and
  // moved on. That is exactly the one worth surfacing.
  const q = replies.buildQueue([c({ id: 'read', unread: 0, lastAt: hoursAgo(100) })], { now: NOW });
  assert.equal(q.items[0].unread, 0);
  assert.equal(q.items[0].flagged, true);
});
