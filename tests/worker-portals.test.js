// The VA and disputer portals are where those people spend their entire day.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

test('a worker gets one flat nav instead of collapsed groups', () => {
  // A VA landed on a sidebar showing a single button. Deal Production, Clients
  // and Messages were all present but sat in collapsed groups reachable only
  // by clicking icon-rail buttons -- so the three places they work were hidden
  // behind a navigation puzzle.
  const role = read('role.js');
  assert.ok(/function flattenNav\(/.test(role));
  assert.ok(/total > 9/.test(role), 'an admin with twenty destinations still wants grouping');
});

test('switching view cannot re-collapse a flattened nav', () => {
  // Every view switch calls setNavGroup to open "its" group, which would hide
  // the other three again on the first click.
  const page = read('index.html');
  const fn = page.split('function setNavGroup')[1].split('\n}')[0];
  assert.ok(/flatnav/.test(fn), 'setNavGroup must respect flat mode');
});

test('Team Dashboard rows bind their click at click time, not render time', () => {
  // The handler was written only if window.pvOpenClient existed when the row
  // was drawn. If production.js had not loaded yet the row was rendered dead
  // and stayed dead for the whole session.
  const team = read('team.js');
  assert.ok(/data-cid=/.test(team), 'the row should carry its id');
  assert.ok(!/onclick="'\+\(window\.pvOpenClient/.test(team),
    'the render-time capability check must be gone');
  assert.ok(/addEventListener\('click'/.test(team), 'and be replaced by a delegated handler');
});

test('the Team Dashboard shows documents rather than a dead day count', () => {
  // days-in-stage reads 0 for every onboarding client, so the card was a list
  // of "0d in onboarding".
  // Strip comments: the replacement quotes the old string to explain itself.
  const team = read('team.js').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/d in onboarding/.test(team));
  assert.ok(/docs\?\(have\+'\/'\+docs\+' docs'\)/.test(team));
});

test('a VA is not pointed at a view they cannot open', () => {
  // "see Pipeline" was the overflow link, and a VA has no pipeline capability.
  const team = read('team.js');
  assert.ok(!/more — see Pipeline/.test(team));
  assert.ok(/more in Deal Production/.test(team));
});
