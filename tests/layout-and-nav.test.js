// Three things a person actually noticed while using this.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

test('a rearranged dashboard survives a restart', () => {
  // Personal layouts were JSON-only on a host with no persistent disk, so an
  // arrangement lasted until the next spin-down. The code said mirroring
  // needed a users table -- which was added later, and nobody came back.
  const store = fs.readFileSync(path.join(__dirname, '..', 'lib', 'store.js'), 'utf8');
  const fn = store.split('function setDashboardLayout')[1].split('\n}')[0];
  assert.ok(/mirrorPersonalLayout/.test(fn), 'a personal layout must be mirrored');
  assert.ok(/lookupUserPgId/.test(store), 'against the real account id');
});

test('a restored layout is the shape the client actually reads', () => {
  // Hydration rebuilt {order, sizes}; the app stores and reads {nodes}. A
  // layout restored in the wrong shape is quietly ignored, which is no better
  // than losing it.
  const store = fs.readFileSync(path.join(__dirname, '..', 'lib', 'store.js'), 'utf8');
  const fn = store.split('async function hydrateDashboardLayoutsFromPostgres')[1].split('\n}')[0];
  assert.ok(/out\[key\] = \{ nodes \}/.test(fn));
  assert.ok(/if \(!nodes\.length\) continue/.test(fn), 'an empty layout is not worth restoring');
});

test('saving a layout can never fail the rearrange', () => {
  const store = fs.readFileSync(path.join(__dirname, '..', 'lib', 'store.js'), 'utf8');
  const fn = store.split('function setDashboardLayout')[1].split('\n}')[0];
  assert.ok(/\.catch\(\(\) => \{\}\)/.test(fn), 'the mirror is fire-and-forget');
});

test('work sits above reporting on the dashboard', () => {
  const page = read('index.html');
  const y = id => {
    const m = page.match(new RegExp('gs-id="' + id + '" gs-x="\\d+" gs-y="(\\d+)"'));
    return m ? Number(m[1]) : null;
  };
  const work = ['onboarding', 'ops', 'replies-due', 'upsell'];
  const reporting = ['rev-trend', 'what-changed', 'churn', 'mentorship', 'activity',
                     'social-snapshot', 'top-content', 'social-growth'];
  const lowestWork = Math.max(...work.map(y));
  const highestReport = Math.min(...reporting.map(y));
  assert.ok(lowestWork < highestReport,
    `work cards should all sit above reporting (work bottom ${lowestWork}, reporting top ${highestReport})`);
});

test('the stale social cards are last, not scattered mid-page', () => {
  const page = read('index.html');
  const y = id => Number(page.match(new RegExp('gs-id="' + id + '" gs-x="\\d+" gs-y="(\\d+)"'))[1]);
  for (const stale of ['social-snapshot', 'top-content', 'social-growth']) {
    assert.ok(y(stale) >= y('activity'), stale + ' still reads Jul 14 2026; it belongs at the bottom');
  }
});

test('a disputer does not get "Change password" as a nav destination', () => {
  // They have exactly one place to work. Giving a third of the sidebar to
  // settings made account chores look like half the job.
  const role = read('role.js');
  const map = role.split('var NAV_CAPS = ')[1].split('};')[0];
  assert.ok(/changePwNavBtn: false/.test(map));
  assert.ok(/signOutNavBtn: false/.test(map));
  assert.ok(/if \(need === false\) return CAPS\.indexOf\('admin'\) >= 0/.test(role),
    'and the check cannot depend on the flat-nav class, which is set later');
});

test('the account menu exists to hold what left the sidebar', () => {
  const page = read('index.html');
  assert.ok(/id="hdrAcctDd"/.test(page));
  for (const item of ['Change password', 'Sign out']) {
    assert.ok(page.split('id="hdrAcctDd"')[1].split('</header>')[0].includes(item),
      item + ' must still be reachable');
  }
});

test('the two work cards own the top row, above the KPI tiles', () => {
  const page = read('index.html');
  const y = id => Number(page.match(new RegExp('gs-id="' + id + '" gs-x="\\d+" gs-y="(\\d+)"'))[1]);
  assert.equal(y('onboarding'), 0);
  assert.equal(y('ops'), 0);
  for (const below of ['kpi-total-income', 'kpi-enrolled', 'clientbase']) {
    assert.ok(y(below) > 0, below + ' is context, not the job — it sits under the queues');
  }
});

test('work-card rows open the client they name', () => {
  // A list of client names that cannot be clicked is a report, not a tool.
  const page = read('index.html');
  assert.ok(/wl-row" data-cid=/.test(page.match(/async function renderOnboarding[\s\S]*?\n\}/)[0]),
    'onboarding rows must carry the client id');
  assert.ok(/wl-row" data-cid=/.test(page.match(/async function renderOps[\s\S]*?\n\}/)[0]),
    'ops rows must carry the client id');
  assert.ok(/__wlClickWired/.test(page), 'one delegated handler, bound once');
  assert.ok(/window\.pvOpenClient\)window\.pvOpenClient\(id\)/.test(page),
    'checked at click time, since production.js may load later');
});

test('the simplified cards lead with the one number that matters', () => {
  const page = read('index.html');
  const onb = page.split('gs-id="onboarding"')[1].split('</div></div>')[0];
  assert.ok(/id="onbFlagged"[^>]*font-size:26px/.test(onb),
    'overdue count is the headline, not one of three equal tiles');
  const ops = page.split('gs-id="ops"')[1].split('</div></div>')[0];
  assert.ok(/id="opsNever"[^>]*font-size:26px/.test(ops));
});
