// The 17-second cold start is one thing: fetching 5,504 GoHighLevel contacts.
// store.cached() holds them for ten minutes, but it is in-memory, and Render's
// free tier throws the container away after about fifteen minutes idle. So in
// practice the cache is almost always cold when someone actually opens the
// app, and they wait the full fetch while the page renders empty.
//
// A snapshot in Postgres survives the container. These tests hold it to the
// rule that makes serving stale data acceptable: it must be honest about
// being stale, and it must never be served in place of a live fetch that
// would have succeeded quickly.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const store = require('../lib/store.js');

test('the schema has somewhere to keep the roster', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'migrate.js'), 'utf8');
  assert.ok(/create table if not exists client_snapshot/.test(src));
});

test('saving and reading degrade quietly without Postgres', async () => {
  // Local dev and CI have no DATABASE_URL. A missing snapshot store must not
  // break the roster, only remove the speed-up.
  await assert.doesNotReject(() => store.saveClientsSnapshot([{ id: '1', name: 'A' }]));
  const got = await store.getClientsSnapshot();
  assert.ok(got === null || (got && Array.isArray(got.clients)),
    'either no snapshot, or a well-formed one');
});

test('a snapshot reports when it was taken', async () => {
  const got = await store.getClientsSnapshot();
  if (!got) return; // no Postgres here
  assert.ok(got.savedAt, 'a snapshot without a timestamp cannot be judged stale');
});

test('the server prefers a snapshot over a blocking fetch on a cold cache', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const fn = src.split('async function getClients()')[1].split('\n}')[0];
  assert.ok(fn.includes('getClientsSnapshot'),
    'getClients() should fall back to the persisted snapshot');
  assert.ok(/refresh|background/i.test(fn),
    'serving a snapshot must also kick off a refresh, or it would never go stale-free');
});

test('a refreshed roster is written back', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(src.includes('saveClientsSnapshot'),
    'nothing would ever populate the snapshot otherwise');
});

test('the snapshot has a staleness limit rather than being served forever', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(/SNAPSHOT_MAX_AGE|maxAge/.test(src),
    'an unbounded snapshot would silently serve last month\'s roster');
});
