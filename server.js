// Ms. Financial Solutions — Business Command Center
// GHL (clients, pipeline, SMS) + Fanbasis (payments via webhook/GHL sync)
// + DisputeFox (rounds via GHL tags + webhook) + Meta (IG/FB followers)
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const store = require('./lib/store');
const ghl = require('./lib/ghl');
const meta = require('./lib/meta');
const social = require('./lib/social');
const { demoData } = require('./lib/demo');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' })); // Zapier webhooks post form-encoded
const PORT = process.env.PORT || 3000;

// ------------------------- auth -------------------------
const SALT = 'msfs-dash-v1';
function passwordNow() {
  return store.getConfig().appPassword || process.env.APP_PASSWORD || 'msfs2026';
}
function tokenFor(pw) { return crypto.createHash('sha256').update(SALT + pw).digest('hex'); }
function authed(req) {
  const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('msfs='));
  return cookie && cookie.slice(5) === tokenFor(passwordNow());
}

app.post('/api/login', (req, res) => {
  if ((req.body.password || '') === passwordNow()) {
    res.setHeader('Set-Cookie', `msfs=${tokenFor(passwordNow())}; Path=/; HttpOnly; Max-Age=2592000; SameSite=Lax`);
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false, error: 'Wrong password' });
});
app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'msfs=; Path=/; Max-Age=0');
  res.json({ ok: true });
});

// webhooks + login page are public; everything else requires the cookie
app.use((req, res, next) => {
  const open = req.path.startsWith('/webhooks/') || req.path === '/api/login' || req.path === '/login.html' || req.path === '/favicon.ico';
  if (open || authed(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
  return res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.use(express.static(path.join(__dirname, 'public')));

// ------------------------- mode + data assembly -------------------------
function liveMode() {
  const cfg = store.getConfig();
  return Boolean(cfg.ghlToken && cfg.ghlLocationId);
}

async function getClients() {
  let clients;
  if (!liveMode()) clients = demoData().clients;
  else {
    const cfg = store.getConfig();
    clients = await store.cached('clients', 10 * 60 * 1000, () => ghl.fetchAllContacts(cfg));
  }
  return decorateClients(clients);
}

// ---- active status computed from what each client PAID FOR ----
// Service window (days after last payment) per package, mirroring the audit's
// refined logic, plus a rounds cap: a fixed-round package is done once that
// many dispute rounds went out after the payment (fed by the DisputeFox webhook).
const DEAL_WINDOWS = {
  'full-repair': 150, 'unlimited': 120, '3-rounds': 110, '3-round': 110,
  '1-month': 45, '1-round': 40, 'quick-fix': 30, 'sweeps': 60
};
const DEAL_ROUNDS = { '1-round': 1, 'quick-fix': 1, 'sweeps': 1, '1-month': 1, '3-rounds': 3, '3-round': 3 };
function decorateClients(clients) {
  const disputes = store.getEvents().filter(e => e.type === 'dispute');
  const byEmail = {};
  for (const d of disputes) {
    const em = (d.email || '').toLowerCase();
    if (em) (byEmail[em] = byEmail[em] || []).push(d);
  }
  const now = Date.now();
  return clients.map(c => {
    const out = { ...c, tagStatus: c.status };
    if (c.lastPaymentDate && !isNaN(new Date(c.lastPaymentDate))) {
      const days = (now - new Date(c.lastPaymentDate)) / 86400000;
      let active = days <= (DEAL_WINDOWS[c.deal] ?? 120);
      const included = DEAL_ROUNDS[c.deal];
      if (active && included) {
        const used = (byEmail[(c.email || '').toLowerCase()] || [])
          .filter(d => new Date(d.at || d.receivedAt) >= new Date(c.lastPaymentDate)).length;
        if (used >= included) active = false; // package used up (e.g. 3-round deal, 3 rounds in)
      }
      out.status = active ? 'active' : 'inactive';
    }
    return out;
  });
}

function getPaymentEvents() {
  if (!liveMode()) return demoData().payments;
  return store.getEvents().filter(e => e.type === 'payment');
}

async function getSmsSeries() {
  if (!liveMode()) return demoData().sms;
  const cfg = store.getConfig();
  const fromApi = await store.cached('sms', 30 * 60 * 1000, () => ghl.smsByDay(cfg).catch(() => ({})));
  // merge webhook-fed sms events on top
  const days = { ...fromApi };
  for (const e of store.getEvents()) {
    if (e.type !== 'sms_in' && e.type !== 'sms_out') continue;
    const d = (e.at || e.receivedAt).slice(0, 10);
    days[d] = days[d] || { in: 0, out: 0 };
    days[d][e.type === 'sms_in' ? 'in' : 'out']++;
  }
  return Object.entries(days).map(([date, v]) => ({ date, in: v.in || 0, out: v.out || 0 })).sort((a, b) => a.date.localeCompare(b.date));
}

function getFollowerSeries() {
  const real = store.getSnapshots().filter(s => s.igFollowers != null || s.fbFollowers != null);
  if (real.length >= 2) return real;
  if (!liveMode()) return demoData().snapshots;
  return real;
}

// ------------------------- bucketing -------------------------
// All date math uses the business timezone so "Today" on the filter bar,
// the KPI cards, and the chart buckets all agree.
const BIZ_TZ = process.env.BIZ_TZ || 'America/Chicago'; // Birmingham, AL = Central
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: BIZ_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
function localDay(dateStr) { // -> 'YYYY-MM-DD' in business tz
  const d = new Date(dateStr);
  if (isNaN(d)) return String(dateStr).slice(0, 10);
  return dayFmt.format(d);
}
function bucketKey(dateStr, granularity) {
  const day = localDay(dateStr);
  if (granularity === 'year') return day.slice(0, 4);
  if (granularity === 'month') return day.slice(0, 7);
  if (granularity === 'week') {
    const [y, m, dd] = day.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, dd));
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); // Monday
    return t.toISOString().slice(0, 10);
  }
  return day;
}

function seriesFrom(items, granularity, valueFn, dateFn) {
  const buckets = {};
  for (const it of items) {
    const k = bucketKey(dateFn(it), granularity);
    buckets[k] = (buckets[k] || 0) + valueFn(it);
  }
  return Object.entries(buckets).sort((a, b) => a[0].localeCompare(b[0])).map(([label, value]) => ({ label, value: Math.round(value * 100) / 100 }));
}

function inRange(dateStr, from, to) {
  if (!dateStr) return false;
  const d = localDay(dateStr);
  return (!from || d >= from) && (!to || d <= to);
}

// ------------------------- main dashboard API -------------------------
app.get('/api/dashboard', async (req, res) => {
  try {
    const { from, to, granularity = 'day' } = req.query;
    const [clients, smsSeries] = await Promise.all([getClients(), getSmsSeries()]);
    const payments = getPaymentEvents();

    const paysIn = payments.filter(p => inRange(p.at, from, to));
    const smsIn = smsSeries.filter(s => inRange(s.date, from, to));
    const newClients = clients.filter(c => inRange(c.createdAt, from, to));
    const active = clients.filter(c => c.status === 'active');
    const inactive = clients.filter(c => c.status === 'inactive');

    // Revenue = Fanbasis sale events (each sale carries its exact timestamp).
    // Day-by-day accurate: range totals and charts are sums of individual sales.
    const FANBASIS_TRUSTED = payments.length >= 20; // backfill has landed
    let revenueSeries = seriesFrom(paysIn, granularity, p => p.amount || 0, p => p.at);
    let paymentsCount = paysIn.length;
    let revenueTotal = paysIn.reduce((s, p) => s + (p.amount || 0), 0);
    let revenueApprox = false;
    let revenueSource = 'fanbasis';
    if (liveMode() && !FANBASIS_TRUSTED && payments.length === 0) {
      const lastPays = clients.filter(c => inRange(c.lastPaymentDate, from, to));
      revenueSeries = seriesFrom(lastPays, granularity, c => c.numberOfPayments ? c.totalSpent / c.numberOfPayments : c.totalSpent, c => c.lastPaymentDate);
      paymentsCount = lastPays.length;
      revenueTotal = revenueSeries.reduce((s, b) => s + b.value, 0);
      revenueApprox = true;
      revenueSource = 'ghl-approx';
    }
    // Lifetime: sum of all Fanbasis sales once backfilled; GHL field sum until then.
    const fanbasisLifetime = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const ghlLifetime = clients.reduce((s, c) => s + (c.totalSpent || 0), 0);
    const lifetimeRevenue = FANBASIS_TRUSTED ? fanbasisLifetime : ghlLifetime;

    const by = (list, keyFn) => {
      const m = {};
      for (const c of list) { const k = keyFn(c) || '(none)'; m[k] = m[k] || { count: 0, revenue: 0 }; m[k].count++; m[k].revenue += c.totalSpent || 0; }
      return Object.entries(m).map(([key, v]) => ({ key, count: v.count, revenue: Math.round(v.revenue) })).sort((a, b) => b.revenue - a.revenue);
    };

    // churn recency for inactive clients
    const now = new Date();
    const churnBuckets = { '0-30d': 0, '31-90d': 0, '91-180d': 0, '181-365d': 0, '1yr+': 0 };
    for (const c of inactive) {
      if (!c.lastPaymentDate) { churnBuckets['1yr+']++; continue; }
      const days = (now - new Date(c.lastPaymentDate)) / 86400000;
      if (days <= 30) churnBuckets['0-30d']++;
      else if (days <= 90) churnBuckets['31-90d']++;
      else if (days <= 180) churnBuckets['91-180d']++;
      else if (days <= 365) churnBuckets['181-365d']++;
      else churnBuckets['1yr+']++;
    }

    // social
    const followerSeries = getFollowerSeries();
    const latestSnap = followerSeries[followerSeries.length - 1] || {};
    const followersInRange = followerSeries.filter(s => inRange(s.date, from, to));
    const followerDelta = followersInRange.length >= 2 ? {
      ig: (followersInRange.at(-1).igFollowers || 0) - (followersInRange[0].igFollowers || 0),
      fb: (followersInRange.at(-1).fbFollowers || 0) - (followersInRange[0].fbFollowers || 0)
    } : { ig: 0, fb: 0 };

    // dispute events (from DisputeFox webhook feed)
    const disputes = store.getEvents().filter(e => e.type === 'dispute' && inRange(e.at || e.receivedAt, from, to));

    // previous equal-length period comparison (for hero vs-% )
    let prevRevenue = null;
    if (from && to) {
      const f = new Date(from), t = new Date(to);
      const days = Math.round((t - f) / 86400000) + 1;
      const pf = new Date(f); pf.setDate(pf.getDate() - days);
      const pt = new Date(f); pt.setDate(pt.getDate() - 1);
      const pfs = pf.toISOString().slice(0, 10), pts = pt.toISOString().slice(0, 10);
      prevRevenue = payments.filter(p => inRange(p.at, pfs, pts)).reduce((s, p) => s + (p.amount || 0), 0);
      prevRevenue = Math.round(prevRevenue * 100) / 100;
    }

    // client-base segments + value metrics + system health
    const unclassified = clients.filter(c => c.status !== 'active' && c.status !== 'inactive').length;
    const payers = new Set(payments.map(p => p.email).filter(Boolean));
    const perEmailCount = {};
    for (const p of payments) if (p.email) perEmailCount[p.email] = (perEmailCount[p.email] || 0) + 1;
    const repeatRevenue = payments.filter(p => perEmailCount[p.email] > 1).reduce((s, p) => s + (p.amount || 0), 0);
    const allEvents = store.getEvents();
    const lastOf = t => { const es = allEvents.filter(e => e.type === t); return es.length ? (es[es.length - 1].at || es[es.length - 1].receivedAt) : null; };
    const snaps = store.getSnapshots();
    const health = {
      lastPaymentEventAt: lastOf('payment'),
      lastDisputeAt: lastOf('dispute'),
      lastSnapshotAt: snaps.length ? snaps[snaps.length - 1].date : null,
      unclassified,
      paymentFeedOk: (() => { const l = lastOf('payment'); return l ? (Date.now() - new Date(l)) < 48 * 3600e3 : false; })(),
      disputeFeedOk: (() => { const l = lastOf('dispute'); return l ? (Date.now() - new Date(l)) < 7 * 86400e3 : false; })(),
      socialOk: (() => { const l = snaps.length ? snaps[snaps.length - 1].date : null; return l ? (Date.now() - new Date(l)) < 48 * 3600e3 : false; })()
    };

    res.json({
      mode: liveMode() ? 'live' : 'demo',
      generatedAt: new Date().toISOString(),
      kpis: {
        revenueTotal: Math.round(revenueTotal * 100) / 100,
        revenueApprox,
        revenueSource,
        paymentsCount,
        avgPayment: paymentsCount ? Math.round(revenueTotal / paymentsCount * 100) / 100 : 0,
        lifetimeRevenue: Math.round(lifetimeRevenue),
        ghlLifetime: Math.round(ghlLifetime),
        totalClients: clients.length,
        activeClients: active.length,
        inactiveClients: inactive.length,
        newClients: newClients.length,
        textsIn: smsIn.reduce((s, d) => s + d.in, 0),
        textsOut: smsIn.reduce((s, d) => s + d.out, 0),
        igFollowers: latestSnap.igFollowers ?? null,
        fbFollowers: latestSnap.fbFollowers ?? null,
        igDelta: followerDelta.ig,
        fbDelta: followerDelta.fb,
        disputesSent: disputes.length,
        prevRevenue,
        unclassified,
        distinctPayers: payers.size,
        ltv: payers.size ? Math.round(payments.reduce((s, p) => s + (p.amount || 0), 0) / payers.size) : 0,
        repeatRevenue: Math.round(repeatRevenue)
      },
      health,
      series: {
        revenue: revenueSeries,
        payments: seriesFrom(paysIn, granularity, () => 1, p => p.at),
        newClients: seriesFrom(newClients, granularity, () => 1, c => c.createdAt),
        smsIn: seriesFrom(smsIn, granularity, d => d.in, d => d.date),
        smsOut: seriesFrom(smsIn, granularity, d => d.out, d => d.date),
        igFollowers: followersInRange.map(s => ({ label: bucketKey(s.date, granularity), value: s.igFollowers })).filter((v, i, a) => a.findIndex(x => x.label === v.label) === i),
        fbFollowers: followersInRange.map(s => ({ label: bucketKey(s.date, granularity), value: s.fbFollowers })).filter((v, i, a) => a.findIndex(x => x.label === v.label) === i)
      },
      breakdowns: {
        byDeal: by(clients, c => c.deal),
        byRound: by(active, c => c.round ? 'Round ' + c.round : null).sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true })),
        activeByDeal: by(active, c => c.deal),
        churnRecency: Object.entries(churnBuckets).map(([key, count]) => ({ key, count }))
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ------------------------- clients table -------------------------
app.get('/api/clients', async (req, res) => {
  try {
    const { q = '', status = '', deal = '', round = '', sort = 'totalSpent', dir = 'desc', page = '1', pageSize = '25' } = req.query;
    let list = await getClients();
    const ql = q.toLowerCase();
    if (ql) list = list.filter(c => (c.name || '').toLowerCase().includes(ql) || (c.email || '').toLowerCase().includes(ql) || (c.phone || '').includes(ql));
    if (status) list = list.filter(c => c.status === status);
    if (deal) list = list.filter(c => c.deal === deal);
    if (round) list = list.filter(c => c.round === round);
    list = [...list].sort((a, b) => {
      const av = a[sort] ?? '', bv = b[sort] ?? '';
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return dir === 'asc' ? cmp : -cmp;
    });
    const p = Math.max(1, parseInt(page)), ps = Math.min(100, parseInt(pageSize));
    res.json({ total: list.length, page: p, pageSize: ps, clients: list.slice((p - 1) * ps, p * ps) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ------------------------- client detail + management -------------------------
app.get('/api/clients/:id', async (req, res) => {
  try {
    const clients = await getClients();
    const c = clients.find(x => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    const email = (c.email || '').toLowerCase();
    const events = liveMode() ? store.getEvents() : demoData().payments;
    const payments = events.filter(e => e.type === 'payment' && (e.email || '').toLowerCase() === email)
      .sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    const disputes = store.getEvents().filter(e => e.type === 'dispute' && (e.email || '').toLowerCase() === email)
      .sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    res.json({
      client: c,
      payments: payments.slice(0, 50),
      disputes: disputes.slice(0, 50),
      notes: store.getNotes(c.id).sort((a, b) => b.at.localeCompare(a.at)),
      tasks: store.getTasks().filter(t => t.clientId === c.id && !t.done),
      worked: store.getWorked()[c.id] || null
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clients/:id/notes', (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'empty note' });
  res.json(store.addNote(req.params.id, text));
});
app.delete('/api/notes/:id', (req, res) => { store.deleteNote(req.params.id); res.json({ ok: true }); });

// set active/inactive — updates GHL tags in live mode
app.post('/api/clients/:id/status', async (req, res) => {
  try {
    const status = req.body.status === 'active' ? 'active' : 'inactive';
    if (liveMode()) {
      await ghl.setStatus(store.getConfig(), req.params.id, status);
      store.clearCache();
    } else {
      const c = demoData().clients.find(x => x.id === req.params.id);
      if (c) { c.status = status; c.tags = c.tags.filter(t => !t.startsWith('status:')).concat(['status:' + status]); }
    }
    res.json({ ok: true, status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// send SMS via GHL (live mode only)
app.post('/api/clients/:id/sms', async (req, res) => {
  try {
    const message = (req.body.message || '').trim();
    if (!message) return res.status(400).json({ error: 'empty message' });
    if (!liveMode()) return res.json({ ok: true, demo: true, note: 'Demo mode — no SMS actually sent. Connect GHL to enable.' });
    const r = await ghl.sendSMS(store.getConfig(), req.params.id, message);
    store.addEvent({ type: 'sms_out', at: new Date().toISOString(), clientId: req.params.id });
    res.json({ ok: true, id: r.messageId || r.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// tasks / follow-ups
app.get('/api/tasks', (req, res) => {
  const t = store.getTasks().sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  res.json({ open: t.filter(x => !x.done), done: t.filter(x => x.done).slice(-30).reverse() });
});
app.post('/api/tasks', (req, res) => {
  const { title, clientId, clientName, due } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });
  res.json(store.addTask({ title: title.trim(), clientId: clientId || null, clientName: clientName || null, due: due || null }));
});
app.patch('/api/tasks/:id', (req, res) => {
  const t = store.updateTask(req.params.id, req.body);
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json(t);
});
app.delete('/api/tasks/:id', (req, res) => { store.deleteTask(req.params.id); res.json({ ok: true }); });

// reactivation queue: inactive clients, most recently lapsed first (hottest leads)
app.get('/api/reactivation', async (req, res) => {
  try {
    const clients = await getClients();
    const worked = store.getWorked();
    const list = clients.filter(c => c.status === 'inactive')
      .map(c => ({ ...c, daysLapsed: c.lastPaymentDate ? Math.round((Date.now() - new Date(c.lastPaymentDate)) / 86400000) : null, worked: worked[c.id] || null }))
      .sort((a, b) => (a.daysLapsed ?? 1e9) - (b.daysLapsed ?? 1e9));
    const page = Math.max(1, parseInt(req.query.page || '1')), ps = 25;
    const filtered = req.query.hideWorked === '1' ? list.filter(c => !c.worked) : list;
    res.json({ total: filtered.length, page, pageSize: ps, clients: filtered.slice((page - 1) * ps, page * ps),
      stats: { total: list.length, worked: list.filter(c => c.worked).length, hot30_90: list.filter(c => c.daysLapsed >= 31 && c.daysLapsed <= 90).length } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/reactivation/:id/worked', (req, res) => {
  res.json({ ok: true, worked: store.setWorked(req.params.id, req.body.worked ? { outcome: req.body.outcome || '' } : false) });
});

// merged activity feed: latest sales, disputes, new clients
app.get('/api/activity', async (req, res) => {
  try {
    const clients = await getClients();
    const events = store.getEvents();
    const items = [];
    for (const p of events.filter(e => e.type === 'payment').slice(-40))
      items.push({ kind: 'sale', at: p.at || p.receivedAt, title: p.name || p.email, sub: (p.product || 'payment'), amount: p.amount });
    for (const d of events.filter(e => e.type === 'dispute').slice(-20))
      items.push({ kind: 'dispute', at: d.at || d.receivedAt, title: d.name || d.email, sub: (d.action || 'dispute') + (d.round ? ' · R' + d.round : '') });
    for (const c of clients.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 15))
      items.push({ kind: 'client', at: c.createdAt, title: c.name, sub: 'new client' });
    items.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    res.json({ items: items.slice(0, 30) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// pipeline board: active clients grouped by round (mirrors GHL Credit Repair Delivery)
app.get('/api/pipeline', async (req, res) => {
  try {
    const clients = await getClients();
    const active = clients.filter(c => c.status === 'active');
    const cols = {};
    for (const c of active) {
      const key = c.round ? 'Round ' + c.round : 'New / Onboarding';
      cols[key] = cols[key] || { clients: [], revenue: 0 };
      cols[key].clients.push({ id: c.id, name: c.name, deal: c.deal, totalSpent: c.totalSpent, lastPaymentDate: c.lastPaymentDate });
      cols[key].revenue += c.totalSpent || 0;
    }
    const order = k => k === 'New / Onboarding' ? 0 : parseInt(k.replace('Round ', '')) || 99;
    const columns = Object.entries(cols)
      .sort((a, b) => order(a[0]) - order(b[0]))
      .map(([name, v]) => ({
        name, count: v.clients.length, revenue: Math.round(v.revenue),
        clients: v.clients.sort((a, b) => (b.totalSpent || 0) - (a.totalSpent || 0)).slice(0, 30)
      }));
    res.json({ totalActive: active.length, totalRevenue: Math.round(active.reduce((s, c) => s + (c.totalSpent || 0), 0)), columns });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ------------------------- settings -------------------------
const mask = v => (v ? v.slice(0, 4) + '••••' + v.slice(-4) : '');
app.get('/api/config', (req, res) => {
  const c = store.getConfig();
  res.json({
    ghlToken: mask(c.ghlToken), ghlLocationId: c.ghlLocationId,
    metaPageToken: mask(c.metaPageToken), fbPageId: c.fbPageId, igUserId: c.igUserId,
    webhookSecret: c.webhookSecret ? '(set)' : '', appPassword: c.appPassword ? '(set)' : '(default)',
    mode: liveMode() ? 'live' : 'demo'
  });
});
app.post('/api/config', (req, res) => {
  const allowed = ['ghlToken', 'ghlLocationId', 'metaPageToken', 'fbPageId', 'igUserId', 'igHandle', 'fbPageUrl', 'webhookSecret', 'appPassword'];
  const patch = {};
  for (const k of allowed) if (typeof req.body[k] === 'string' && req.body[k] !== '' && !req.body[k].includes('••••')) patch[k] = req.body[k].trim();
  store.setConfig(patch);
  store.clearCache();
  res.json({ ok: true, mode: liveMode() ? 'live' : 'demo' });
});
app.post('/api/test/ghl', async (req, res) => {
  try { res.json(await ghl.testConnection(store.getConfig())); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
app.post('/api/test/meta', async (req, res) => {
  try { res.json({ ok: true, ...(await meta.getFollowers(store.getConfig())) }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
app.post('/api/refresh', (req, res) => { store.clearCache(); res.json({ ok: true }); });

// social profile info for the Social tab (+ manual snapshot trigger)
app.get('/api/social', async (req, res) => {
  const cfg = store.getConfig();
  const snaps = store.getSnapshots();
  res.json({
    igHandle: cfg.igHandle, fbPageUrl: cfg.fbPageUrl,
    igUrl: 'https://www.instagram.com/' + cfg.igHandle + '/',
    latest: snaps[snaps.length - 1] || null
  });
});
app.post('/api/social/refresh', async (req, res) => {
  await takeSnapshot();
  const snaps = store.getSnapshots();
  res.json({ ok: true, latest: snaps[snaps.length - 1] || null });
});
// manual count entry (e.g. read straight off the public profiles)
app.post('/api/social/seed', (req, res) => {
  const snap = { date: localDay(new Date()) };
  if (req.body.igFollowers != null) snap.igFollowers = parseInt(req.body.igFollowers);
  if (req.body.fbFollowers != null) snap.fbFollowers = parseInt(req.body.fbFollowers);
  store.upsertSnapshot(snap);
  res.json({ ok: true, snap });
});

// ------------------------- webhooks (Zapier: Fanbasis, DisputeFox, GHL SMS) -------------------------
function checkSecret(req, res) {
  const cfg = store.getConfig();
  if (!cfg.webhookSecret) return true; // open until a secret is set
  if ((req.query.secret || req.headers['x-webhook-secret']) === cfg.webhookSecret) return true;
  res.status(401).json({ error: 'bad secret' });
  return false;
}
app.post('/webhooks/fanbasis', (req, res) => {
  if (!checkSecret(req, res)) return;
  const b = req.body || {};
  const ev = {
    type: 'payment',
    at: b.sale_date || b.date || b.created_at || new Date().toISOString(),
    amount: parseFloat(String(b.amount || b.total || b.price || '').replace(/[$,]/g, '')) || 0,
    email: (b.email || b.customer_email || '').toLowerCase(),
    name: b.name || b.customer_name || '',
    product: b.product || b.product_name || b.offer || ''
  };
  // dedupe: same email + amount + same day = same sale (protects webhook+backfill overlap)
  const day = localDay(ev.at);
  const dup = store.getEvents().find(e => e.type === 'payment' && e.email === ev.email
    && Math.abs((e.amount || 0) - ev.amount) < 0.01 && localDay(e.at || e.receivedAt) === day);
  if (dup) return res.json({ ok: true, id: dup.id, deduped: true });
  const saved = store.addEvent(ev);
  res.json({ ok: true, id: saved.id });
});

// admin cleanup: remove payment events by email (test data etc.) — login-gated like all /api routes
app.post('/api/events/cleanup', (req, res) => {
  const emails = (req.body.emails || []).map(e => String(e).toLowerCase());
  if (!emails.length) return res.status(400).json({ error: 'emails required' });
  const before = store.getEvents().length;
  store.removeEvents(e => e.type === 'payment' && emails.includes((e.email || '').toLowerCase()));
  res.json({ ok: true, removed: before - store.getEvents().length });
});
app.post('/webhooks/disputefox', (req, res) => {
  if (!checkSecret(req, res)) return;
  const b = req.body || {};
  const ev = store.addEvent({
    type: 'dispute',
    at: b.date || b.created_at || new Date().toISOString(),
    email: (b.email || b.client_email || '').toLowerCase(),
    name: b.client_name || b.name || '',
    round: b.round || b.round_number || null,
    action: b.action || b.event || 'dispute_sent'
  });
  res.json({ ok: true, id: ev.id });
});
app.post('/webhooks/sms', (req, res) => {
  if (!checkSecret(req, res)) return;
  const b = req.body || {};
  const dir = (b.direction || '').toLowerCase() === 'outbound' ? 'sms_out' : 'sms_in';
  const ev = store.addEvent({ type: dir, at: b.date || new Date().toISOString(), phone: b.phone || '' });
  res.json({ ok: true, id: ev.id });
});

// ------------------------- daily snapshot job -------------------------
async function takeSnapshot() {
  try {
    const cfg = store.getConfig();
    const snap = { date: localDay(new Date()) };
    if (cfg.metaPageToken) {
      const f = await meta.getFollowers(cfg);
      if (f.igFollowers != null) snap.igFollowers = f.igFollowers;
      if (f.fbFollowers != null) snap.fbFollowers = f.fbFollowers;
    }
    if (snap.igFollowers == null || snap.fbFollowers == null) {
      const p = await social.publicCounts(cfg);
      if (snap.igFollowers == null && p.igFollowers != null) snap.igFollowers = p.igFollowers;
      if (snap.fbFollowers == null && p.fbFollowers != null) snap.fbFollowers = p.fbFollowers;
    }
    if (liveMode()) {
      const clients = await getClients();
      snap.activeClients = clients.filter(c => c.status === 'active').length;
      snap.inactiveClients = clients.filter(c => c.status === 'inactive').length;
      snap.totalClients = clients.length;
    }
    if (Object.keys(snap).length > 1) store.upsertSnapshot(snap);
  } catch (e) { console.error('snapshot failed:', e.message); }
}
setInterval(takeSnapshot, 6 * 60 * 60 * 1000); // every 6h
setTimeout(takeSnapshot, 15 * 1000); // shortly after boot

// ------------------------- Deal Production (client work desk) — shared team persistence -------------------------
const fs = require('fs');
const PROD_FILE = path.join(process.env.DATA_DIR || __dirname, 'production.json');
function readProd() { try { return JSON.parse(fs.readFileSync(PROD_FILE, 'utf8')); } catch (e) { return null; } }
function writeProd(d) { try { fs.writeFileSync(PROD_FILE, JSON.stringify(d)); return true; } catch (e) { return false; } }
app.get('/api/production', (req, res) => { res.json({ clients: readProd(), mode: liveMode() ? 'live' : 'demo' }); });
app.post('/api/production', (req, res) => {
  const c = req.body && req.body.clients;
  if (!Array.isArray(c)) return res.status(400).json({ error: 'clients array required' });
  writeProd(c);
  res.json({ ok: true, count: c.length });
});

app.listen(PORT, () => console.log(`MSFS Command Center running on port ${PORT} (${liveMode() ? 'LIVE' : 'DEMO'} mode)`));
