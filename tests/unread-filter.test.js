// Asked for in the team walkthrough: Sunshine needs to see what is waiting on
// a reply without reading down a list of 300 conversations.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msfs-unread-'));
process.env.APP_PASSWORD = 'test-admin-pw';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../server');

let base, server, cookie;
const req = (p, o = {}) => fetch(base + p, {
  method: o.method || 'GET', redirect: 'manual',
  headers: Object.assign({}, cookie ? { cookie } : {}, o.body ? { 'content-type': 'application/json' } : {}),
  body: o.body ? JSON.stringify(o.body) : undefined
});

before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-admin-pw' }) });
  cookie = r.headers.get('set-cookie').split(';')[0];
});
after(() => server && server.close());

test('unread=1 returns a subset, and every row in it is genuinely unread', async () => {
  const all = await (await req('/api/messages')).json();
  const un = await (await req('/api/messages?unread=1')).json();
  assert.ok(un.conversations.length <= all.conversations.length);
  for (const c of un.conversations) {
    assert.ok(c.unread > 0, `${c.id} came back from the unread filter with unread=${c.unread}`);
  }
});

test('unread narrows within a channel rather than replacing it', async () => {
  // The two are different axes. If unread ignored the channel, turning it on
  // would silently widen the list back out to every channel.
  const all = await (await req('/api/messages')).json();
  const ch = (all.channels || [])[0];
  if (!ch) return;
  const both = await (await req(`/api/messages?channel=${encodeURIComponent(ch)}&unread=1`)).json();
  for (const c of both.conversations) {
    assert.equal(c.channelKey, ch, 'the channel filter should still apply');
    assert.ok(c.unread > 0);
  }
});

test('the UI asks the server rather than filtering the page it already has', () => {
  // A second client-side pass would drift from the counts the server reports.
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'messages.js'), 'utf8');
  assert.ok(/qs\.set\('unread','1'\)/.test(src), 'the request should carry the flag');
  const load = src.split('function loadList()')[1].split('\n}')[0];
  assert.ok(!/\.filter\(.*unread/.test(load), 'no separate client-side unread filter');
});

test('the unread chip toggles instead of replacing the channel selection', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'messages.js'), 'utf8');
  const click = src.split('el.onclick=function(){')[1].split('};')[0];
  assert.ok(/dataset\.unread/.test(click) && /unreadOnly=!unreadOnly/.test(click),
    'clicking Unread should toggle it, not set the channel');
});
