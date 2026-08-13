// Ms. Financial Solutions — Business Command Center
// GHL (clients, pipeline, SMS) + Fanbasis (payments via webhook/GHL sync)
// + DisputeFox (rounds via GHL tags + webhook) + Meta (IG/FB followers)
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const store = require('./lib/store');
const dealProd = require('./lib/production'); // Deal Production, Postgres-primary -- see that file's header comment
const auth = require('./lib/auth');
const disputes = require('./lib/disputes');
const replies = require('./lib/replies');
const purchases = require('./lib/purchases');
const rounds = require('./lib/rounds');
const ops = require('./lib/ops');
const audit = require('./lib/audit'); // who did what -- see that file's header // admin operations view -- see that file's header // rounds bought vs used -- see that file's header // real per-client purchase history -- see that file's header // unanswered-conversation SLA -- see that file's header
const onboarding = require('./lib/onboarding'); // new-client SLA queue -- see that file's header
const migrate = require('./lib/migrate'); // additive, idempotent schema catch-up at boot // dispute desk projection over Deal Production
const ghl = require('./lib/ghl');
const ghlcreds = require('./lib/ghlcreds');
const affiliate = require('./lib/affiliate');
const sheet = require('./lib/sheet');
const meta = require('./lib/meta');
const social = require('./lib/social');
const { demoData } = require('./lib/demo');

// ------------------------- historical Commas product sales -------------------------
// Real orders/revenue pulled directly from the Commas product catalog
// (https://commas.com/dashboard/org_yWsBDMHkMrka/products) on 2026-07-30,
// covering every sale before the Fanbasis webhook started carrying a
// `product` field. Normalized by product name (case/whitespace variants of
// the same package collapsed into one row) so "Revenue by package" isn't
// blank for all the sales that happened before that field existed. Once
// live Fanbasis events start carrying their own product name, those get
// added on top of this snapshot in getProductBreakdownAllTime() below --
// no double counting, since this snapshot predates the webhook fix.
const HISTORICAL_PRODUCT_SALES = [
  { key: 'Full Expedited Credit Repair', count: 630, revenue: 177107.11 },
  { key: 'Diamond Package', count: 415, revenue: 89563.58 },
  { key: '3 Expedited Rounds', count: 606, revenue: 77302.00 },
  { key: 'Partnership', count: 51, revenue: 100975.00 },
  { key: 'Round Table Partnership', count: 12, revenue: 18387.50 },
  { key: '1 Expedited Round', count: 203, revenue: 7563.13 },
  { key: '2 Expedited Rounds', count: 22, revenue: 2200.00 },
  { key: 'Upgrade to Diamond', count: 77, revenue: 21122.77 },
  { key: 'Help me fix it', count: 86, revenue: 4300.00 },
  { key: 'Full Credit Repair', count: 1, revenue: 250.00 },
  { key: 'Full Credit Repair + 2 Credit Cards', count: 40, revenue: 8000.00 },
  { key: 'Mentorship', count: 9, revenue: 16500.00 },
  { key: 'Amob Expedited Credit Repair', count: 2, revenue: 500.00 },
  { key: 'Amob Credit Repair Discount', count: 15, revenue: 4176.26 },
  { key: '4 Credit Repair Rounds', count: 4, revenue: 1100.00 },
  { key: "Adreain's Credit Repair Discount", count: 4, revenue: 2600.00 },
  { key: 'Credit to capital', count: 2, revenue: 1043.75 },
  { key: 'Inquiry Removal', count: 4, revenue: 1100.00 },
  { key: 'Business Funding', count: 4, revenue: 4000.00 },
  { key: 'Funding Due', count: 37, revenue: 9808.17 },
  { key: 'Stickwithus Referral Credit Clean Up', count: 32, revenue: 7721.87 },
  { key: 'I need funding!', count: 34, revenue: 6234.36 }
];

// Real names, pulled from Commas transactions filtered to the three
// Mentorship product SKUs (ZpYOE, o63XN, BL672), Succeeded status only, on
// 2026-07-30. $3,000 rows are two-mentorship-seat purchases in one charge.
const HISTORICAL_MENTORSHIP_BUYERS = [
  { name: 'Joanna Rogers', email: 'jmarie3525@gmail.com', amount: 1500, date: '2026-07-01' },
  { name: 'Myah Floyd', email: 'omyah1@yahoo.com', amount: 1500, date: '2026-07-03' },
  { name: 'Tiffany Collins', email: 'tiffanyrenee062087@gmail.com', amount: 1500, date: '2026-07-03' },
  { name: 'Maia Harris', email: 'maiaharris777@yahoo.com', amount: 1500, date: '2026-07-04' },
  { name: 'Saloam Bey', email: 'Knox@creditpowerllc.org', amount: 1500, date: '2026-06-28' },
  { name: 'Keistyiuana Benson', email: 'info@etsproseries.com', amount: 1500, date: '2026-06-27' },
  { name: 'Kenyatta Averett', email: 'Kla1224@yahoo.com', amount: 1500, date: '2026-06-27' },
  { name: 'Chazell Adkins', email: 'cainvest00@gmail.com', amount: 3000, date: '2025-12-15' },
  { name: 'Al Coney', email: 'firmfoundation01@yahoo.com', amount: 3000, date: '2025-12-14' }
];

// ------------------------- MFSN affiliate commission, real -------------------------
// Actual monthly payouts, exported from the MyFreeScoreNow affiliate
// portal's Commission Summary on 2026-08-10: all 37 months from Jul 2023
// through Jul 2026 (Commission + Referral + One-Time Bonus + Target
// Incentive). Sums to $244,194.34, which matches the portal's own lifetime
// figure -- that agreement is the check that this table is complete.
//
// These are paid figures, not a per-member estimate. MFSN pays monthly and
// exposes no per-day feed, so a month is the finest real grain available.
//
// A range that covers part of a month gets that month prorated by the
// number of days it overlaps, which is the honest reading of "how much of
// this month's payout falls inside the window".
const MFSN_MONTHLY_INCOME = {
  '2023-07': 0.0, '2023-08': 105.25, '2023-09': 164.0, '2023-10': 166.75,
  '2023-11': 272.06, '2023-12': 197.35, '2024-01': 230.39, '2024-02': 244.49,
  '2024-03': 256.06, '2024-04': 692.34, '2024-05': 1232.22, '2024-06': 1373.29,
  '2024-07': 1432.26, '2024-08': 1136.56, '2024-09': 1394.58, '2024-10': 1355.85,
  '2024-11': 2943.93, '2024-12': 2945.14, '2025-01': 2395.34, '2025-02': 2167.55,
  '2025-03': 3518.55, '2025-04': 4953.55, '2025-05': 4390.65, '2025-06': 4510.04,
  '2025-07': 7033.54, '2025-08': 6359.81, '2025-09': 16038.4, '2025-10': 16981.89,
  '2025-11': 17236.1, '2025-12': 16572.14, '2026-01': 16573.09, '2026-02': 16914.95,
  '2026-03': 19099.75, '2026-04': 19002.08, '2026-05': 18999.0, '2026-06': 17191.55,
  '2026-07': 18113.84
};

// The MyFreeScoreNow book as of the last portal audit. This lived in three
// places at once -- here, public/mfsn.js and public/admina-dashboard.html --
// and the admina copy silently went stale (it still read 1,493 enrolled and
// 736 actives long after the portal moved on). Serving it from one place is
// the only way the KPI tiles and the Credit Monitoring page can't disagree.
const MFSN_MEMBERS = {
  enrolled: 1505, active: 217, upgraded: 439, toUpgrade: 1067,
  newActives: 756, targetActives: 1185,
  auditedAt: '2026-08-10'
};

// Month-by-month payout list for sparklines. Object key order is insertion
// order for string keys, but sort anyway so a hand-edit out of sequence
// can't silently reorder a chart.
function mfsnIncomeSeries() {
  return Object.keys(MFSN_MONTHLY_INCOME).sort().map(function (ym) {
    return { label: ym, value: MFSN_MONTHLY_INCOME[ym] };
  });
}

// ---------------------------------------------------------------------------
// Commas gross revenue per month, read from the Commas revenue chart itself
// (Dashboard -> Revenue -> Y, which plots cumulative revenue per year).
//
// Why hardcoded rather than summed from payment events: the events we hold
// are a point-in-time export whose dates do not survive the round trip. Summed
// by month they produced $14,148 for January 2026; Commas itself reports
// $74,255.19. The export is fine as a record of *which* sales happened and
// what package each was, but it cannot be trusted to say *when*.
//
// The numbers below are Commas' own, to the cent, and they reconcile: the two
// years sum to $874,877.30, which is exactly the lifetime figure the old
// revenue.js carried as `CO.ytd`. (That mislabelling is what produced the
// fake $543,648 January -- everything older than six months had been dumped
// into the first bucket, which is why the Sales trend showed a cliff.)
//
// Months after COMMAS_HISTORY_THROUGH are NOT listed here on purpose: those
// come from live payment events, so the current month keeps moving on its own
// as the Fanbasis feed delivers sales. Each time Commas closes a month, add
// the real figure here and advance COMMAS_HISTORY_THROUGH by one.
const COMMAS_MONTHLY_REVENUE = {
  '2025-04': 22908.03, '2025-05': 16055.77, '2025-06': 23561.16,
  '2025-07': 26593.41, '2025-08': 19977.68, '2025-09': 116499.91,
  '2025-10': 107822.16, '2025-11': 67530.70, '2025-12': 75450.80,
  '2026-01': 74255.19, '2026-02': 86667.49, '2026-03': 61550.00,
  '2026-04': 68195.00, '2026-05': 45135.00, '2026-06': 34175.00,
  '2026-07': 28500.00
};
const COMMAS_HISTORY_THROUGH = '2026-07';

// Live Commas revenue per month, straight off the payment feed. Only ever
// consulted for months Commas has not closed yet.
function commasLiveByMonth() {
  const out = {};
  for (const e of getPaymentEvents()) {
    const at = e.at || e.receivedAt;
    if (!at) continue;
    const ym = String(at).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    if (ym <= COMMAS_HISTORY_THROUGH) continue; // the table is authoritative
    out[ym] = (out[ym] || 0) + (Number(e.amount) || 0);
  }
  return out;
}

// Commas revenue for an arbitrary window, prorated by day where the window
// cuts a month in half. Same shape as mfsnIncomeForRange() above, and for the
// same reason: a closed month is a single reported total, not a daily series,
// so a partial month can only ever be apportioned.
function commasIncomeForRange(from, to) {
  const live = commasLiveByMonth();
  const all = Object.assign({}, COMMAS_MONTHLY_REVENUE, live);
  let total = 0;
  for (const [ym, amount] of Object.entries(all)) {
    const [y, m] = ym.split('-').map(Number);
    const monthStart = new Date(Date.UTC(y, m - 1, 1));
    const monthEnd = new Date(Date.UTC(y, m, 0));
    const daysInMonth = monthEnd.getUTCDate();
    const winStart = from ? new Date(from + 'T00:00:00Z') : monthStart;
    const winEnd = to ? new Date(to + 'T00:00:00Z') : monthEnd;
    const lo = winStart > monthStart ? winStart : monthStart;
    const hi = winEnd < monthEnd ? winEnd : monthEnd;
    if (hi < lo) continue;
    const overlapDays = Math.round((hi - lo) / 86400000) + 1;
    total += amount * (overlapDays / daysInMonth);
  }
  return Math.round(total);
}

// Real income per calendar month, both sources side by side. Commas is
// summed straight off the payment events (the 5,133-row backfill plus
// anything the Fanbasis webhook has added since), so it needs no hand
// maintenance; MFSN comes from the payout table above.
//
// This exists because public/revenue.js and public/mfsn.js each carried
// their own typed-out copy of these numbers, and both drifted -- revenue.js
// was still summing MFSN through June 2026, so every Total income figure it
// produced was short by July's $18,113.84. Deriving it once on the server is
// the only version that can't silently go stale.
function incomeByMonth() {
  const months = {};
  const commas = Object.assign({}, COMMAS_MONTHLY_REVENUE, commasLiveByMonth());
  for (const [ym, amount] of Object.entries(MFSN_MONTHLY_INCOME)) {
    months[ym] = { ym, commas: 0, mfsn: Math.round(amount), total: 0 };
  }
  for (const [ym, amount] of Object.entries(commas)) {
    if (!months[ym]) months[ym] = { ym, commas: 0, mfsn: 0, total: 0 };
    months[ym].commas = Math.round(amount);
  }
  return Object.keys(months).sort().map(ym => {
    const m = months[ym];
    m.total = m.commas + m.mfsn;
    return m;
  });
}

function mfsnIncomeForRange(from, to) {
  let total = 0;
  for (const [ym, amount] of Object.entries(MFSN_MONTHLY_INCOME)) {
    const [y, m] = ym.split('-').map(Number);
    const monthStart = new Date(Date.UTC(y, m - 1, 1));
    const monthEnd = new Date(Date.UTC(y, m, 0));
    const daysInMonth = monthEnd.getUTCDate();
    const winStart = from ? new Date(from + 'T00:00:00Z') : monthStart;
    const winEnd = to ? new Date(to + 'T00:00:00Z') : monthEnd;
    const lo = winStart > monthStart ? winStart : monthStart;
    const hi = winEnd < monthEnd ? winEnd : monthEnd;
    if (hi < lo) continue;
    const overlapDays = Math.round((hi - lo) / 86400000) + 1;
    total += amount * (overlapDays / daysInMonth);
  }
  return Math.round(total);
}

// Merges the historical Commas snapshot with any live Fanbasis payment
// events that carry a `product` field (real sales since the webhook secret
// got fixed on 2026-07-30) so the card grows on its own from here.
// The Commas backfill (seed/commas-payments-seed.json) now carries every
// pre-webhook sale as a real dated event, so HISTORICAL_PRODUCT_SALES is no
// longer merged in here -- doing both would count the same sales twice.
// The constant is kept only as the provenance record of what was pulled by
// hand on 2026-07-30, before the full export existed.
function getProductBreakdownAllTime(allPayments) {
  const m = {};
  for (const p of allPayments) {
    const k = (p.product || '').trim();
    if (!k) continue;
    m[k] = m[k] || { count: 0, revenue: 0 };
    m[k].count++;
    m[k].revenue += p.amount || 0;
  }
  return Object.entries(m).map(([key, v]) => ({ key, count: v.count, revenue: Math.round(v.revenue) })).sort((a, b) => b.revenue - a.revenue);
}
function getMentorshipBuyersAllTime(allPayments) {
  const live = allPayments.filter(p => /mentorship/i.test(p.product || '')).map(p => ({
    name: p.name || p.email || 'Unknown', email: p.email || '', amount: p.amount || 0, date: (p.at || '').slice(0, 10)
  }));
  return [...HISTORICAL_MENTORSHIP_BUYERS, ...live].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

const app = express();
// Render terminates TLS and forwards, so without this req.ip is Render's edge
// rather than the visitor. Trust exactly one hop: entries a client forges
// earlier in X-Forwarded-For are then ignored.
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' })); // Zapier webhooks post form-encoded
const PORT = process.env.PORT || 3000;

// ------------------------- auth -------------------------
function legacyPassword() {
  return store.getConfig().appPassword || process.env.APP_PASSWORD || 'msfs2026';
}

// The app used to have a single shared password. Migrate it into an admin
// account on first boot so the existing password keeps working.
function getUsers() {
  const cfg = store.getConfig();
  if (Array.isArray(cfg.users) && cfg.users.some(u => u.role === 'admin')) return cfg.users;
  const migrated = auth.ensureAdmin(cfg.users, legacyPassword());
  store.setConfig({ users: migrated });
  return migrated;
}

// Secret behind setup/reset links (auth.signAppToken / verifyAppToken).
// Generated once and persisted to the store on first use so it survives a
// restart -- a link signed before a redeploy must still verify after one.
function getInviteSecret() {
  const cfg = store.getConfig();
  if (cfg.inviteSecret) return cfg.inviteSecret;
  const secret = crypto.randomBytes(32).toString('hex');
  store.setConfig({ inviteSecret: secret });
  return secret;
}
const SETUP_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // a week to act on it
function setupLinkFor(userId) {
  const token = auth.signAppToken({ userId, exp: Date.now() + SETUP_LINK_TTL_MS }, getInviteSecret());
  return `/set-password.html?token=${token}`;
}

// @mentions: match "@word" or "@word.word" tokens in free text against
// dashboard login users by username (exact, case-insensitive) or by their
// display name with spaces collapsed (so "@TiffanyDixon" matches "Tiffany
// Dixon"). Longest-token-first so "@tiffanydixon" doesn't also fire a
// partial match on a shorter username that happens to be a prefix.
function resolveMentions(text) {
  const tokens = [...String(text || '').matchAll(/@([a-z0-9._-]+)/gi)].map(m => m[1].toLowerCase());
  if (!tokens.length) return [];
  const users = getUsers().filter(u => !u.disabled);
  const found = new Map();
  for (const tok of tokens) {
    const u = users.find(x => x.username.toLowerCase() === tok || x.name.replace(/\s+/g, '').toLowerCase() === tok);
    if (u) found.set(u.id, u);
  }
  return [...found.values()];
}

// Fan out a notification to each @mentioned user, skipping anyone already
// notified another way (e.g. the assignee already got an 'assigned'
// notification, so they don't also get a redundant 'mention' one).
function notifyMentions(mentionedUsers, base, skipIds) {
  const skip = new Set(skipIds || []);
  for (const u of mentionedUsers) {
    if (skip.has(u.id)) continue;
    store.addNotification({ userId: u.id, ...base });
  }
}

const SESSION_FILE = path.join(process.env.DATA_DIR || __dirname, 'sessions.json');
function readSessions() {
  try { return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch (e) { return {}; }
}
const sessions = auth.createSessions(readSessions());
function persistSessions() {
  const snapshot = sessions.serialize();
  try {
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(snapshot));
  } catch (e) { /* sessions survive in memory even if the disk is read-only */ }
  // The file above is on Render's ephemeral disk -- destroyed on every deploy
  // and every ~15-minute idle spin-down, which is why everyone kept getting
  // logged out. Postgres is the copy that outlives the container. Not awaited:
  // a database blip must never be able to fail a login.
  store.mirrorSessions(snapshot).catch(() => {});
}

function cookieToken(req) {
  const c = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('msfs='));
  return c ? c.slice(5) : null;
}

// Guess throttling, in memory (a restart clearing it beats adding a
// dependency). Two counters per failure:
//
//  - by address: stops one host hammering many accounts.
//  - by account: the backstop. Behind a proxy the observed address may not be
//    stable, so an address-only counter can be defeated by rotating it —
//    which is exactly what happened in production. The account counter holds
//    no matter what the address looks like.
//
// The account counter is the reason a legitimate user could be locked out by
// someone else guessing their name; 15 minutes is the deliberate ceiling on
// that, and a real sign-in clears it immediately.
const MAX_ATTEMPTS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;
const byAddress = new Map();
const byAccount = new Map();

function bumpFail(map, key) {
  const a = map.get(key);
  if (!a || Date.now() - a.first > LOCKOUT_MS) map.set(key, { count: 1, first: Date.now() });
  else a.count++;
}
function isLocked(map, key) {
  const a = map.get(key);
  if (!a) return false;
  if (Date.now() - a.first > LOCKOUT_MS) { map.delete(key); return false; }
  return a.count >= MAX_ATTEMPTS;
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const account = username || 'admin';
  const address = req.ip || req.socket.remoteAddress || '';

  // Refuse before checking the password, so a correct guess on attempt 500
  // still gets nowhere.
  if (isLocked(byAccount, account) || isLocked(byAddress, address)) {
    console.warn(`[LOGIN] throttled account=${account} address=${address}`);
    return res.status(429).json({ ok: false, error: 'Too many failed attempts — wait 15 minutes' });
  }

  const user = auth.authenticate(getUsers(), account, password || '');
  if (!user) {
    bumpFail(byAccount, account);
    bumpFail(byAddress, address);
    return res.status(401).json({ ok: false, error: 'Wrong username or password' });
  }
  byAccount.delete(account); // a real sign-in clears both records
  byAddress.delete(address);
  const token = sessions.create(user);
  persistSessions();
  res.setHeader('Set-Cookie', `msfs=${token}; Path=/; HttpOnly; Max-Age=2592000; SameSite=Lax`);
  res.json({ ok: true, role: user.role, name: user.name });
});

app.post('/api/logout', (req, res) => {
  const token = cookieToken(req);
  if (token) { sessions.destroy(token); persistSessions(); }
  res.setHeader('Set-Cookie', 'msfs=; Path=/; Max-Age=0');
  res.json({ ok: true });
});

// Admin-only auto-login from the Proven Agency dashboard's link-out route.
// GET (not POST) because it arrives as a browser redirect, not a fetch --
// the token itself is single-use-window (60s) and signed, so a GET is safe
// here the same way a password-reset-by-email link is.
app.get('/api/sso', (req, res) => {
  const secret = process.env.SSO_SHARED_SECRET;
  const payload = auth.verifySsoToken(req.query.token, secret);
  if (!payload) {
    console.warn('[SSO] rejected token (missing, expired, or bad signature)');
    return res.status(401).send('This sign-in link is invalid or expired. Go back to the Proven Agency dashboard and click Tiffany again.');
  }
  const { users, user } = auth.findOrCreateSsoUser(getUsers(), payload);
  saveUsers(users);
  const token = sessions.create(user, { viaSso: true });
  persistSessions();
  res.setHeader('Set-Cookie', `msfs=${token}; Path=/; HttpOnly; Max-Age=2592000; SameSite=Lax`);
  console.log(`[SSO] ${payload.email} signed in via Proven Agency link-out`);
  res.redirect('/');
});

// webhooks + login page are public; everything else needs a session, and the
// session's role decides what it may reach. Deny by default.
//
// set-password.html / POST /api/set-password are also public: that's the
// whole point of a setup/reset link -- the person opening it doesn't have a
// session yet. The token itself (see auth.verifyAppToken) is what proves
// they're allowed to be there, not a cookie.
app.use((req, res, next) => {
  const open = req.path.startsWith('/webhooks/') || req.path.startsWith('/internal/cron/')
    || req.path === '/api/login' || req.path === '/api/sso'
    || req.path === '/login.html' || req.path === '/favicon.ico'
    || req.path === '/set-password.html' || req.path === '/api/set-password';
  if (open) return next();

  const session = sessions.resolve(cookieToken(req));
  if (!session) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
    return res.sendFile(path.join(__dirname, 'public', 'login.html'));
  }
  req.user = session;
  // "View as Employee" (see POST /api/preview/start below) flips this to
  // 'employee' for an admin session without touching session.role itself --
  // every permission decision past this point (this gate, plus the few
  // in-handler admin checks that read req.effectiveRole) uses this, so the
  // preview is a real server-enforced downgrade, not a client-side mock.
  req.effectiveRole = session.previewRole || session.role;

  // Permissions are per-capability now (see lib/auth.js). Resolve the actor
  // the gate checks: previewing means "see it exactly as that role's preset",
  // deliberately ignoring any per-user capability override on the real
  // account -- otherwise an admin previewing an employee would still carry
  // their own extras and the preview would lie.
  const account = getUsers().find(x => x.id === session.userId);
  req.actor = session.previewRole
    ? { role: session.previewRole }
    : { role: session.role, capabilities: account && account.capabilities };
  req.capabilities = [...auth.capsFor(req.actor)];

  // The preview toggle routes are the one place that must always gate on
  // the REAL account: an admin mid-preview still needs to be able to exit it.
  const isPreviewToggle = req.path === '/api/preview/start' || req.path === '/api/preview/stop';
  const actorForGate = isPreviewToggle
    ? { role: session.role, capabilities: account && account.capabilities }
    : req.actor;

  const permitted = req.path.startsWith('/api/')
    ? auth.canAccess(actorForGate, req.method, req.path)
    : auth.canAccessAsset(actorForGate, req.path);
  if (!permitted) return res.status(403).json({ error: 'forbidden' });
  next();
});

app.get('/api/me', (req, res) => {
  const u = getUsers().find(x => x.id === req.user.userId);
  // `role` is the EFFECTIVE role -- what governs rendering and every other
  // permission check -- so existing client code that already gates on
  // me.role (role.js, production.js's admin-only buttons, the
  // personal-finances.js load check, etc.) automatically respects preview
  // mode with no changes. `realRole`/`previewing` are only for the "View as
  // Employee" toggle + banner themselves, which need to know the account's
  // actual role to decide whether to show up at all.
  res.json({
    id: req.user.userId, name: u ? u.name : 'User', username: u ? u.username : null,
    role: req.effectiveRole, realRole: req.user.role, previewing: !!req.user.previewRole,
    viaSso: !!req.user.viaSso,
    // The resolved capability list for this session, so the UI can gate nav
    // and views on the same thing the server gates routes on instead of
    // inferring it from the role name. Presentation only -- the real
    // boundary is still the middleware above.
    capabilities: req.capabilities,
    // The LIVE/DEMO pill used to be set only from /api/dashboard, which a VA
    // or disputer is refused -- so they saw "DEMO" stamped over real client
    // data. Every session can be told which mode it is in.
    mode: liveMode() ? 'live' : 'demo'
  });
});

// Admin-only session-scoped preview of the Employee experience -- does not
// touch the account's real role in store.json, just flags this session (see
// sessions.setPreview in lib/auth.js) so req.effectiveRole, and therefore
// every guard downstream, treats it as an employee until /stop is called.
app.post('/api/preview/start', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
  // Any non-admin preset, not just 'employee'. Previewing was the only way to
  // see what a worker actually gets without creating an account and signing
  // out, and it could only ever show one of the four roles -- so the VA and
  // disputer views were unverifiable from an admin session.
  // Omitted means employee, for the older client that sent no body at all --
  // which matters more than it sounds, because a browser running a stale
  // cached role.js is exactly the case this has to keep working. But a role
  // that was actually supplied and isn't valid is refused rather than
  // quietly becoming employee.
  const raw = req.body && req.body.role;
  const wanted = raw === undefined || raw === null ? 'employee' : String(raw);
  if (!ROLE_NAMES.includes(wanted) || wanted === 'admin') {
    return res.status(400).json({ error: `role must be one of ${ROLE_NAMES.filter(r => r !== 'admin').join(', ')}` });
  }
  sessions.setPreview(cookieToken(req), wanted);
  persistSessions();
  res.json({ ok: true, role: wanted });
});
app.post('/api/preview/stop', (req, res) => {
  sessions.setPreview(cookieToken(req), null);
  persistSessions();
  res.json({ ok: true });
});

// Every account write keeps the Postgres mirror current, so the user-scoped
// stores (notifications, ticket views, dashboard layouts) can always resolve
// a real users.id. Fire-and-forget on purpose -- a mirror failure must not
// fail the write the admin actually asked for.
function saveUsers(users) {
  store.setConfig({ users });
  store.mirrorUsers(users).catch(e => console.error('User mirror failed:', e.message));
  return users;
}

// Roles are presets of capabilities (lib/auth.js). A user may also carry an
// explicit `capabilities` array that overrides the preset entirely.
const ROLE_NAMES = Object.keys(auth.ROLE_CAPS);
const INVALID_CAPS = Symbol('invalid');
function normalizeCapabilities(input) {
  if (input === undefined || input === null) return null;
  if (!Array.isArray(input)) return INVALID_CAPS;
  const out = [...new Set(input)];
  if (out.some(c => !auth.CAPABILITIES.includes(c))) return INVALID_CAPS;
  return out;
}

// user management (admin only — non-admins are blocked by canAccess)
app.get('/api/users', (req, res) => {
  res.json(getUsers().map(u => ({
    id: u.id, username: u.username, name: u.name, role: u.role,
    disabled: !!u.disabled, mustSetPassword: !!u.mustSetPassword,
    // The per-user override, when one is set, plus what the account actually
    // resolves to -- the Team panel needs both to show "preset" vs "custom".
    capabilities: u.capabilities || null,
    effectiveCapabilities: [...auth.capsFor(u)]
  })));
});

// password is optional -- leave it out and the account is created with
// mustSetPassword:true plus a returned one-time setupLink instead, so the
// admin never has to invent (and relay) a temporary password. Still accepts
// an explicit password too, for anyone who'd rather just set one directly.
app.post('/api/users', (req, res) => {
  const { username, name, role, password, capabilities } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username required' });
  if (!ROLE_NAMES.includes(role)) {
    return res.status(400).json({ error: `role must be one of ${ROLE_NAMES.join(', ')}` });
  }
  const caps = normalizeCapabilities(capabilities);
  if (caps === INVALID_CAPS) return res.status(400).json({ error: 'unknown capability' });
  const list = getUsers();
  if (list.some(u => u.username === username)) return res.status(409).json({ error: 'username already taken' });
  const user = auth.makeUser({ username, name, role, password });
  // Only persist an override when one was actually asked for -- otherwise the
  // account follows its role preset and keeps following it as presets evolve.
  if (caps) user.capabilities = caps;
  saveUsers(list.concat([user]));
  const resp = { ok: true, id: user.id, username, role };
  if (user.mustSetPassword) resp.setupLink = setupLinkFor(user.id);
  res.json(resp);
});

app.patch('/api/users/:id', (req, res) => {
  const list = getUsers();
  const u = list.find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'no such user' });
  // Never let the last admin lock themselves out.
  const admins = list.filter(x => x.role === 'admin' && !x.disabled);
  const demoting = (req.body.role && req.body.role !== 'admin') || req.body.disabled === true;
  if (u.role === 'admin' && demoting && admins.length <= 1) {
    return res.status(400).json({ error: 'cannot disable or demote the last admin' });
  }
  if (req.body.name) u.name = req.body.name;
  if (ROLE_NAMES.includes(req.body.role)) u.role = req.body.role;
  if ('capabilities' in req.body) {
    const caps = normalizeCapabilities(req.body.capabilities);
    if (caps === INVALID_CAPS) return res.status(400).json({ error: 'unknown capability' });
    // null clears the override and puts the account back on its role preset.
    if (caps) u.capabilities = caps; else delete u.capabilities;
  }
  if (typeof req.body.disabled === 'boolean') u.disabled = req.body.disabled;
  if (req.body.password) { Object.assign(u, auth.hashPassword(req.body.password)); u.mustSetPassword = false; }
  // Revoking access must take effect immediately, not at cookie expiry.
  if (u.disabled || req.body.password || req.body.role || 'capabilities' in req.body) {
    sessions.destroyForUser(u.id); persistSessions();
  }
  saveUsers(list);
  res.json({ ok: true });
});

// (Re)generate a one-time setup/reset link for an existing user -- this is
// the "reset their password" button: it doesn't touch their current
// password at all, it just hands them a way to pick a new one themselves.
// Admin-only (not in EMPLOYEE_API).
app.post('/api/users/:id/invite', (req, res) => {
  const u = getUsers().find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'no such user' });
  res.json({ ok: true, setupLink: setupLinkFor(u.id) });
});

// Public: the landing point for a setup/reset link. No session required --
// the signed token itself (7-day expiry) is the proof of authorization.
// Logs them straight in afterward so a brand-new hire doesn't also have to
// then type the password they just chose back into the login form.
app.post('/api/set-password', (req, res) => {
  const { token, password } = req.body || {};
  const payload = auth.verifyAppToken(token, getInviteSecret());
  if (!payload || !payload.userId) return res.status(400).json({ error: 'This link is invalid or has expired — ask your admin for a new one.' });
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const list = getUsers();
  const u = list.find(x => x.id === payload.userId);
  if (!u || u.disabled) return res.status(400).json({ error: 'This account is no longer available.' });
  Object.assign(u, auth.hashPassword(password));
  u.mustSetPassword = false;
  saveUsers(list);
  sessions.destroyForUser(u.id); // any stale sessions shouldn't outlive the password they were issued under
  const sessionToken = sessions.create(u);
  persistSessions();
  res.setHeader('Set-Cookie', `msfs=${sessionToken}; Path=/; HttpOnly; Max-Age=2592000; SameSite=Lax`);
  res.json({ ok: true });
});

// Self-service password change from an active session (both roles -- see
// EMPLOYEE_API in lib/auth.js). Requires the current password, unlike the
// admin PATCH route above, since anyone at an unlocked, already-signed-in
// desk could otherwise hijack the account without knowing it.
app.post('/api/me/password', (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  const list = getUsers();
  const u = list.find(x => x.id === req.user.userId);
  if (!u) return res.status(404).json({ error: 'account not found' });
  if (!auth.verifyPassword(currentPassword || '', u)) return res.status(400).json({ error: 'Current password is incorrect' });
  Object.assign(u, auth.hashPassword(newPassword));
  u.mustSetPassword = false;
  saveUsers(list);
  // Same as the admin-driven password change: revoke everywhere, including
  // this tab, so the new password is the only thing that works from here on.
  sessions.destroyForUser(u.id);
  persistSessions();
  res.json({ ok: true });
});

// Permanently remove a team member's login. Same "never lock out the last
// admin" guard as disabling one (a disabled admin still counts toward
// nothing here -- we only protect the last *active* admin), plus a
// dedicated guard against an admin deleting their own account by mistake
// mid-session (they can still disable themselves via PATCH if that's really
// what they want, since that keeps the record around to undo).
app.delete('/api/users/:id', (req, res) => {
  const list = getUsers();
  const u = list.find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'no such user' });
  if (u.id === req.user.userId) return res.status(400).json({ error: 'cannot remove your own account while signed in as it' });
  const activeAdmins = list.filter(x => x.role === 'admin' && !x.disabled);
  if (u.role === 'admin' && !u.disabled && activeAdmins.length <= 1) {
    return res.status(400).json({ error: 'cannot remove the last active admin' });
  }
  saveUsers(list.filter(x => x.id !== req.params.id));
  sessions.destroyForUser(u.id);
  persistSessions();
  res.json({ ok: true });
});

// ------------------------- support tickets -------------------------
// Both admin and employee can submit (see EMPLOYEE_API in lib/auth.js) --
// this is how Tiffany's team flags something for Proven Agency to work on
// without needing a login over there. Saved locally first (so a
// submission is never lost even if the forward below fails), then
// forwarded to Proven Agency's own dashboard so it shows up where the
// agency actually works -- same shared-secret pattern as the SSO
// link-out, just in the opposite direction.
const PROVEN_DASHBOARD_URL = process.env.PROVEN_DASHBOARD_URL || 'https://proven-agency-dashboard.vercel.app';

app.post('/api/support-tickets', async (req, res) => {
  const subject = String((req.body || {}).subject || '').trim();
  const message = String((req.body || {}).message || '').trim();
  if (!subject || !message) return res.status(400).json({ error: 'subject and message are required' });

  const me = getUsers().find(u => u.id === req.user.userId);
  const submittedByName = me ? me.name : null;
  const submittedByUsername = me ? me.username : null;
  const submittedByRole = req.user.role;

  let forwarded = false;
  let forwardError = null;
  const secret = process.env.TICKETS_SHARED_SECRET;
  if (secret) {
    try {
      const resp = await fetch(`${PROVEN_DASHBOARD_URL}/api/support-tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tickets-secret': secret },
        body: JSON.stringify({ source: 'msfs-dashboard', subject, message, submittedByName, submittedByUsername, submittedByRole })
      });
      if (resp.ok) {
        forwarded = true;
      } else {
        forwardError = `HTTP ${resp.status}`;
        console.warn(`[SUPPORT-TICKET] forward failed: HTTP ${resp.status}`);
      }
    } catch (e) {
      forwardError = e.message;
      console.warn(`[SUPPORT-TICKET] forward failed: ${e.message}`);
    }
  } else {
    forwardError = 'TICKETS_SHARED_SECRET not configured';
    console.warn('[SUPPORT-TICKET] TICKETS_SHARED_SECRET not configured -- saved locally only');
  }

  // Saved after the forward attempt completes, so the local audit copy's
  // forwarded/forwardError fields reflect what actually happened rather
  // than a value that could never be updated once written.
  const ticket = store.addTicket({
    subject, message, submittedByName, submittedByUsername, submittedByRole,
    forwarded, forwardError
  });

  res.json({ ok: true, id: ticket.id, forwarded });
});

// "All Ticket Requests" -- both roles see the full shared team queue
// (everyone's tickets, not just their own), synced live from Proven
// Agency's dashboard rather than from the local audit copy above, since
// that copy predates any reply/status a ticket may have picked up there.
// `unread` is computed per requesting user from lib/store.js's
// last-viewed map, so the same GET can drive both the list and the nav
// badge count without a second request.
app.get('/api/support-tickets', async (req, res) => {
  const secret = process.env.TICKETS_SHARED_SECRET;
  if (!secret) return res.status(502).json({ error: 'TICKETS_SHARED_SECRET not configured' });
  try {
    const resp = await fetch(`${PROVEN_DASHBOARD_URL}/api/support-tickets?source=msfs-dashboard`, {
      headers: { 'x-tickets-secret': secret }
    });
    if (!resp.ok) return res.status(502).json({ error: `HTTP ${resp.status}` });
    const data = await resp.json();
    const views = store.getTicketViews()[req.user.userId] || {};
    const tickets = (data.tickets || []).map(t => {
      const notes = (t.support_ticket_notes || []).slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const lastActivity = t.updated_at || t.created_at;
      const lastViewed = views[t.id];
      const unread = !lastViewed || new Date(lastActivity) > new Date(lastViewed);
      return { ...t, notes, unread };
    });
    res.json({ ok: true, tickets });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Marks a ticket as seen by the current user, clearing its unread badge.
app.post('/api/support-tickets/:id/view', (req, res) => {
  store.markTicketViewed(req.user.userId, req.params.id);
  res.json({ ok: true });
});

// A reply from this dashboard, relayed to Proven Agency's thread on the
// same ticket -- see support_ticket_notes in the proven-agency-dashboard
// repo. Counts as having viewed the ticket too, so replying also clears
// the unread badge.
app.post('/api/support-tickets/:id/notes', async (req, res) => {
  const message = String((req.body || {}).message || '').trim();
  if (!message) return res.status(400).json({ error: 'message is required' });
  const secret = process.env.TICKETS_SHARED_SECRET;
  if (!secret) return res.status(502).json({ error: 'TICKETS_SHARED_SECRET not configured' });

  const me = getUsers().find(u => u.id === req.user.userId);
  const authorName = me ? me.name : null;
  try {
    const resp = await fetch(`${PROVEN_DASHBOARD_URL}/api/support-tickets/${encodeURIComponent(req.params.id)}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tickets-secret': secret },
      body: JSON.stringify({ message, authorName })
    });
    if (!resp.ok) return res.status(502).json({ error: `HTTP ${resp.status}` });
    const d = await resp.json();
    store.markTicketViewed(req.user.userId, req.params.id);
    res.json({ ok: true, id: d.id });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Static assets with no Cache-Control were being held by the browser across
// deploys: a fix would ship, the server would serve the new file, and the
// page would keep running the old one until someone hard-reloaded. That is
// invisible to whoever shipped it and looks like "you didn't build it" to
// everyone else -- which is exactly how it surfaced.
//
// no-cache does not mean "don't cache", it means "revalidate before use", so
// the common case is still a cheap 304 rather than a re-download. Only the
// app's own code gets it; images and fonts don't change under a fixed name.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  setHeaders(res, filePath) {
    if (/\.(js|css|html)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    else res.setHeader('Cache-Control', 'public, max-age=604800');
  }
}));

// ------------------------- read-only guard -------------------------
// Set READ_ONLY=1 when developing against Tiffany's real GoHighLevel keys.
// Only two routes can change anything there: status write-back (which edits
// tags on a real contact) and sending an SMS (which texts a real client).
//
// The refusal is deliberately loud. Returning a fake success would leave you
// believing a tag changed when it did not.
// Read at call time rather than captured at module load: the flag is a
// safety switch, and a switch you can only throw before require() is one
// that silently does nothing when flipped later (which is exactly how the
// messages-reply tests were failing -- they set it after loading the app).
function readOnly() {
  return process.env.READ_ONLY === '1' || process.env.READ_ONLY === 'true';
}
function refuseWrite(res, action, detail) {
  console.warn(`[READ-ONLY] refused ${action} ${detail}`);
  return res.status(403).json({
    error: 'read-only mode — this would change live GoHighLevel data',
    action
  });
}

// ------------------------- mode + data assembly -------------------------
function liveMode() {
  const cfg = store.getConfig();
  return Boolean(cfg.ghlToken && cfg.ghlLocationId);
}

// How old a persisted roster may be before we insist on waiting for a live
// fetch instead. A day is generous, but the alternative to a day-old roster
// is a blank page for seventeen seconds, and client records don't churn fast
// enough for that trade to be close. Without a bound we would eventually
// serve last month's roster and never notice.
const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
let refreshingClients = null;

// Fetches from GoHighLevel and persists the result. Shared so the cold path
// and the background refresh can't drift apart.
async function fetchAndCacheClients() {
  const cfg = store.getConfig();
  const fresh = await store.cached('clients', 10 * 60 * 1000, () => ghl.fetchAllContacts(cfg));
  store.saveClientsSnapshot(fresh).catch(() => {});
  return fresh;
}

async function getClients() {
  if (!liveMode()) return decorateClients(demoData().clients);

  // Warm in-memory cache: nothing to decide.
  if (store.peekCached('clients', 10 * 60 * 1000)) {
    return decorateClients(await fetchAndCacheClients());
  }

  // Cold. Rather than making the page wait ~17s on 5,504 contacts, serve the
  // snapshot that outlived the container and refresh behind the request.
  const snap = await store.getClientsSnapshot().catch(() => null);
  if (snap && (Date.now() - new Date(snap.savedAt).getTime()) < SNAPSHOT_MAX_AGE_MS) {
    if (!refreshingClients) {
      refreshingClients = fetchAndCacheClients()
        .catch(e => { console.error('Background roster refresh failed:', e.message); })
        .finally(() => { refreshingClients = null; });
    }
    return decorateClients(snap.clients);
  }

  // No snapshot, or one too old to trust. Wait for the real thing.
  return decorateClients(await fetchAndCacheClients());
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
    // ~2s of bucketing and matching per call, and the same range is asked for
    // repeatedly -- a reload, the KPI-tile handshake, a preset click back and
    // forth. 30s per range keeps it fresh enough to feel live (webhook writes
    // call store.clearCache(), which drops these keys too) while making the
    // repeat asks free.
    const cacheKey = `dash:${granularity}:${from || ''}:${to || ''}`;
    const cachedBody = await store.cached(cacheKey, 30 * 1000, async () => {
      return await buildDashboardPayload({ from, to, granularity });
    });
    return res.json(cachedBody);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function buildDashboardPayload({ from, to, granularity }) {
  {
    // GoHighLevel is one source among several, not a prerequisite for the
    // page. It had been awaited bare, so a rejected token (expired, or the
    // contacts.readonly scope missing) threw before anything rendered and
    // took the WHOLE dashboard down with it -- including revenue, which
    // comes from the local event log and MFSN table and needs GHL for
    // nothing at all. Degrade instead: serve everything that still works
    // and report the failure in `health` so the UI can say what's wrong.
    let ghlError = null;
    const [clients, smsSeries, dashboardProdList] = await Promise.all([
      getClients().catch(e => { ghlError = e.message || String(e); return []; }),
      getSmsSeries().catch(() => []),
      readProd().catch(() => [])
    ]);
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
    // Commas' own monthly totals, prorated across the window (see
    // COMMAS_MONTHLY_REVENUE). The payment events are a point-in-time export
    // whose dates don't survive the round trip -- summing them by date gave
    // $14,148 for January 2026 against Commas' actual $74,255.19 -- so they
    // are no longer trusted to say when a sale happened. The current month
    // still comes off the live feed, so today's sales land the same day.
    let revenueTotal = commasIncomeForRange(from, to);
    let revenueApprox = false;
    let revenueSource = 'commas';
    // Approximate from GHL whenever the webhook backfill hasn't landed --
    // not only at exactly zero events. A handful of stray events (a $50
    // test sale) used to bypass this and present themselves as the whole
    // month's income.
    if (liveMode() && !FANBASIS_TRUSTED) {
      const lastPays = clients.filter(c => inRange(c.lastPaymentDate, from, to));
      revenueSeries = seriesFrom(lastPays, granularity, c => c.numberOfPayments ? c.totalSpent / c.numberOfPayments : c.totalSpent, c => c.lastPaymentDate);
      paymentsCount = lastPays.length;
      revenueTotal = revenueSeries.reduce((s, b) => s + b.value, 0);
      revenueApprox = true;
      revenueSource = 'ghl-approx';
    }
    // Lifetime: sum of all Fanbasis sales once backfilled; GHL field sum until then.
    // Lifetime is the reported monthly table plus whatever the live feed has
    // added since -- i.e. exactly what Commas shows, $874,877.30 across the
    // two years it has been in use.
    const fanbasisLifetime = commasIncomeForRange(null, null);
    const ghlLifetime = clients.reduce((s, c) => s + (c.totalSpent || 0), 0);
    const lifetimeRevenue = fanbasisLifetime;

    const by = (list, keyFn) => {
      const m = {};
      for (const c of list) { const k = keyFn(c) || '(none)'; m[k] = m[k] || { count: 0, revenue: 0 }; m[k].count++; m[k].revenue += c.totalSpent || 0; }
      return Object.entries(m).map(([key, v]) => ({ key, count: v.count, revenue: Math.round(v.revenue) })).sort((a, b) => b.revenue - a.revenue);
    };
    // Revenue by package, from the actual Fanbasis sale events in the
    // selected date range (each event's own `product` field, set by the
    // /webhooks/fanbasis payload) -- rather than byDeal's Deal Production
    // package tag summed over each client's all-time GHL total. Once real
    // sales start carrying a product name this is what "Revenue by
    // package" actually means: what sold, in this period, for how much.
    // Falls back to byDeal (below) for as long as no payment event has a
    // product on it yet, so the card isn't blank before that Zap field gets
    // mapped.
    const byProductRaw = (() => {
      const m = {};
      for (const p of paysIn) {
        const k = (p.product || '').trim();
        if (!k) continue;
        m[k] = m[k] || { count: 0, revenue: 0 };
        m[k].count++;
        m[k].revenue += p.amount || 0;
      }
      return Object.entries(m).map(([key, v]) => ({ key, count: v.count, revenue: Math.round(v.revenue) })).sort((a, b) => b.revenue - a.revenue);
    })();
    // All-time version of the above: the Commas historical snapshot (every
    // sale before the webhook carried a product field) plus every live
    // Fanbasis payment event regardless of the date-range filter above --
    // "Revenue by package" should answer "what has she ever sold", not just
    // what sold in the currently-selected range.
    const byProductAllTime = getProductBreakdownAllTime(payments);
    const mentorshipBuyersAllTime = getMentorshipBuyersAllTime(payments);
    const mentorshipRow = byProductAllTime.find(p => /mentorship/i.test(p.key)) || { count: 0, revenue: 0 };
    // "range" means "within the selected date range" -- and since almost
    // all real mentorship money lives in the historical Commas snapshot
    // (the live Fanbasis feed only just started carrying per-event data),
    // pull from both: live payment events tagged mentorship, plus
    // historical buyers whose sale date falls inside the selected range.
    // Dedupe by email so a buyer who's both in the snapshot AND has since
    // shown up as a live event isn't double-counted.
    const mentorshipRangeEvents = [
      ...paysIn.filter(p => /mentorship/i.test(p.product || '')),
      ...mentorshipBuyersAllTime.filter(b => b.date && inRange(b.date, from, to) &&
        !paysIn.some(p => p.email && b.email && p.email.toLowerCase() === b.email.toLowerCase() && /mentorship/i.test(p.product || '')))
        .map(b => ({ amount: b.amount, at: b.date }))
    ];

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

    // previous equal-length period comparison (for hero vs-% and the KPI
    // row's delta arrows) -- same trick for avg payment / LTV / new clients
    // so those cards get a real vs-previous-period % instead of a fake one.
    let prevRevenue = null, prevAvgPayment = null, prevLtv = null, prevNewClients = null;
    if (from && to) {
      const f = new Date(from), t = new Date(to);
      const days = Math.round((t - f) / 86400000) + 1;
      const pf = new Date(f); pf.setDate(pf.getDate() - days);
      const pt = new Date(f); pt.setDate(pt.getDate() - 1);
      const pfs = pf.toISOString().slice(0, 10), pts = pt.toISOString().slice(0, 10);
      const prevPayments = payments.filter(p => inRange(p.at, pfs, pts));
      prevRevenue = prevPayments.reduce((s, p) => s + (p.amount || 0), 0);
      prevRevenue = Math.round(prevRevenue * 100) / 100;
      prevAvgPayment = prevPayments.length ? Math.round(prevRevenue / prevPayments.length * 100) / 100 : null;
      const prevPayers = new Set(prevPayments.map(p => p.email).filter(Boolean));
      prevLtv = prevPayers.size ? Math.round(prevRevenue / prevPayers.size) : null;
      prevNewClients = clients.filter(c => inRange(c.createdAt, pfs, pts)).length;
    }

    // client-base segments + value metrics + system health
    const unclassified = clients.filter(c => c.status !== 'active' && c.status !== 'inactive').length;
    const payers = new Set(payments.map(p => p.email).filter(Boolean));
    const perEmailCount = {};
    for (const p of payments) if (p.email) perEmailCount[p.email] = (perEmailCount[p.email] || 0) + 1;
    const repeatRevenue = payments.filter(p => perEmailCount[p.email] > 1).reduce((s, p) => s + (p.amount || 0), 0);
    const allEvents = store.getEvents();
    // Feed freshness must reflect when the webhook actually delivered (receivedAt),
    // not the sale's own date field -- a retest/replay of an older sale otherwise
    // makes a perfectly live feed look stale.
    const lastOf = t => { const es = allEvents.filter(e => e.type === t); return es.length ? (es[es.length - 1].receivedAt || es[es.length - 1].at) : null; };
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

    // Real MFSN payouts for the range (see MFSN_MONTHLY_INCOME above):
    // actual monthly commission from the affiliate portal, prorated across
    // any partially-covered month.
    const mfsnIncomeEst = mfsnIncomeForRange(from, to);

    return {
      mode: liveMode() ? 'live' : 'demo',
      generatedAt: new Date().toISOString(),
      ghlError,
      kpis: {
        revenueTotal: Math.round(revenueTotal * 100) / 100,
        mfsnIncomeEst,
        totalIncome: Math.round(revenueTotal + mfsnIncomeEst),
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
        prevAvgPayment,
        prevLtv,
        prevNewClients,
        unclassified,
        distinctPayers: payers.size,
        ltv: payers.size ? Math.round(payments.reduce((s, p) => s + (p.amount || 0), 0) / payers.size) : 0,
        repeatRevenue: Math.round(repeatRevenue),
        mentorship: {
          rangeRevenue: Math.round(mentorshipRangeEvents.reduce((s, p) => s + (p.amount || 0), 0)),
          rangeCount: mentorshipRangeEvents.length,
          lifetimeRevenue: Math.round(mentorshipRow.revenue),
          activeClients: mentorshipRow.count
        }
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
        byProduct: byProductRaw,
        byProductAllTime,
        mentorshipBuyers: mentorshipBuyersAllTime,
        byDeal: by(clients, c => c.deal),
        byRound: by(active, c => c.round ? 'Round ' + c.round : null).sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true })),
        // Real Deal Production stage counts (Onboarding/Ready/In rounds/
        // Completed) -- same source of truth as the Production page's own
        // "Clients by stage" chart (readProd(), see /api/production). Used
        // to build the customer lifecycle ring on the Dashboard alongside
        // byRound above, which further breaks "In rounds" out by round
        // number.
        byStage: (() => {
          const prod = dashboardProdList || [];
          const st = { Onboarding: 0, Ready: 0, 'In rounds': 0, Completed: 0 };
          prod.forEach(c => { if (st[c.stage] !== undefined) st[c.stage]++; });
          return st;
        })(),
        activeByDeal: by(active, c => c.deal),
        churnRecency: Object.entries(churnBuckets).map(([key, count]) => ({ key, count })),
        // Real month-by-month repeat-payer rate, replacing the Dashboard's
        // "Customer Growth" card with an honest "Returning Clients" one --
        // for each calendar month, what fraction of that month's payers
        // (by email) had ALSO paid in an earlier month. Uses the full
        // payment history (not the date-range-filtered paysIn) since you
        // need earlier months on record to know who's "returning" --  the
        // very first month on record is correctly 0% (nobody has an
        // earlier payment to return from yet), same as any real retention
        // curve's first cohort.
        returning: (() => {
          const byMonth = {};
          payments.forEach(p => {
            if (!p.email || !p.at) return;
            const m = localDay(p.at).slice(0, 7);
            (byMonth[m] = byMonth[m] || []).push(p.email);
          });
          const months = Object.keys(byMonth).sort();
          const seenBefore = new Set();
          const series = months.map(m => {
            const payersThisMonth = new Set(byMonth[m]);
            let returningCount = 0;
            payersThisMonth.forEach(email => { if (seenBefore.has(email)) returningCount++; });
            const rate = payersThisMonth.size ? Math.round(returningCount / payersThisMonth.size * 1000) / 10 : 0;
            payersThisMonth.forEach(email => seenBefore.add(email));
            return { label: m, rate, returningCount, totalPayers: payersThisMonth.size };
          });
          const recent = series.slice(-7);
          const last = series[series.length - 1] || { rate: 0 };
          const prev = series[series.length - 2] || { rate: last.rate };
          return { series: recent, rate: last.rate, deltaVsPrevMonth: Math.round((last.rate - prev.rate) * 10) / 10 };
        })()
      }
    };
  }
}

// Annotates each client with its effective MyFreeScoreNow status --
// mfsnStatus: 'affiliate' | 'not_affiliate' | 'not_on_mfsn', mfsnMatched:
// whether they were found on the synced list at all (regardless of
// status), mfsnOverride: a manual call from the client drawer that wins
// over the computed status -- see lib/affiliate.js and
// store.getAffiliateOverrides(). Single source of truth shared by
// /api/clients, /api/clients/:id, and /api/affiliate-gap so the list, the
// filter, and the dashboard card's counts can't disagree.
function withAffiliateTags(clients) {
  return affiliate.affiliateGap(clients, store.getMfsnMembers(), store.getAffiliateOverrides()).tagged;
}

// ------------------------- clients table -------------------------
app.get('/api/clients', async (req, res) => {
  try {
    const { q = '', status = '', deal = '', round = '', affiliate: affiliateFilter = '', sort = 'totalSpent', dir = 'desc', page = '1', pageSize = '25' } = req.query;
    let list = withAffiliateTags(await getClients());
    const ql = q.toLowerCase();
    if (ql) list = list.filter(c => (c.name || '').toLowerCase().includes(ql) || (c.email || '').toLowerCase().includes(ql) || (c.phone || '').includes(ql));
    if (status) list = list.filter(c => c.status === status);
    if (deal === 'Mentorship') {
      // Mentorship buyers aren't tracked via Deal Production's `deal` field --
      // they live in the Commas-derived historical snapshot + live Fanbasis
      // events tagged mentorship (see getMentorshipBuyersAllTime, used by the
      // Mentorship program card's "Total mentees" stat). Match by email
      // against that real buyer list instead of the usual c.deal===deal
      // check, so the Clients page shows the actual people who bought it.
      const mentorEmails = new Set(getMentorshipBuyersAllTime(getPaymentEvents())
        .map(b => (b.email || '').toLowerCase().trim()).filter(Boolean));
      list = list.filter(c => c.email && mentorEmails.has(c.email.toLowerCase().trim()));
    } else if (deal) {
      list = list.filter(c => c.deal === deal);
    }
    if (round) list = list.filter(c => c.round === round);
    if (affiliateFilter === 'affiliate' || affiliateFilter === 'not_affiliate' || affiliateFilter === 'not_on_mfsn') {
      list = list.filter(c => c.mfsnStatus === affiliateFilter);
    }
    list = [...list].sort((a, b) => {
      const av = a[sort] ?? '', bv = b[sort] ?? '';
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return dir === 'asc' ? cmp : -cmp;
    });
    const p = Math.max(1, parseInt(page)), ps = Math.min(100, parseInt(pageSize));
    const moneyVisible = auth.has(req.actor, 'revenue');
    const pageClients = list.slice((p - 1) * ps, p * ps).map(c => auth.redactClient(req.actor, c));
    res.json({ total: list.length, page: p, pageSize: ps, clients: pageClients, moneyVisible });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ------------------------- client detail + management -------------------------

// Cross-references a GHL contact against Deal Production by ghlId (stamped
// on a production record whenever it's reconciled from a real GHL contact --
// see 'G' + c.id / ghlId: c.id below and in the sheet-sync route). Deal
// Production is the actual system of record for "where a client is in the
// process" -- stage, per-bureau round status, documents -- so a client
// detail panel opened from Pipeline or the Clients table can show it
// alongside the GHL contact record instead of just a flat round number.
// No dollar figures in here, so this needs no role redaction either way.
async function findProductionMatch(ghlId) {
  if (!ghlId) return null;
  const prod = await readProd() || [];
  return prod.find(p => p.ghlId === ghlId) || null;
}
function productionSummary(p) {
  if (!p) return null;
  return { id: p.id, stage: p.stage, days: p.days || 0, tu: p.tu, eq: p.eq, ex: p.ex, docs: p.docs, va: p.va };
}

app.get('/api/clients/:id', async (req, res) => {
  try {
    // Tagging the whole roster to read one client was costing seconds on every
    // drawer open -- measured at 5.5s live. The roster itself is already
    // cached; this caches the affiliate pass over it on the same short TTL, so
    // opening several clients in a row pays for it once.
    const clients = await store.cached('clients:tagged', 60 * 1000,
      async () => withAffiliateTags(await getClients()));
    const c = clients.find(x => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    const email = (c.email || '').toLowerCase();
    const events = liveMode() ? store.getEvents() : demoData().payments;
    const payments = events.filter(e => e.type === 'payment' && (e.email || '').toLowerCase() === email)
      .sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    const disputes = store.getEvents().filter(e => e.type === 'dispute' && (e.email || '').toLowerCase() === email)
      .sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    const moneyVisible = auth.has(req.actor, 'revenue');
    res.json({
      client: auth.redactClient(req.actor, c),
      // The payment history is itself a list of dollar amounts -- drop the
      // whole thing rather than trying to redact each entry.
      payments: moneyVisible ? payments.slice(0, 50) : [],
      disputes: disputes.slice(0, 50),
      notes: store.getNotes(c.id).sort((a, b) => b.at.localeCompare(a.at)),
      tasks: store.getTasks().filter(t => t.clientId === c.id && !t.done),
      worked: store.getWorked()[c.id] || null,
      moneyVisible,
      production: productionSummary(await findProductionMatch(c.id))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clients/:id/notes', async (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'empty note' });
  const author = getUsers().find(u => u.id === req.user.userId);
  const mentions = resolveMentions(text);
  const note = store.addNote(req.params.id, text, {
    authorId: author ? author.id : null,
    authorName: author ? author.name : null,
    mentions: mentions.map(u => u.id)
  });
  let clientName = null;
  try { clientName = (await getClients()).find(c => c.id === req.params.id)?.name || null; } catch (e) { /* best-effort */ }
  notifyMentions(mentions, { type: 'mention', refType: 'note', refId: note.id, clientId: req.params.id, clientName, text, fromName: author ? author.name : 'Someone' }, author ? [author.id] : []);
  res.json(note);
});
app.delete('/api/notes/:id', (req, res) => { store.deleteNote(req.params.id); res.json({ ok: true }); });

// Manually mark a client Affiliate / Not affiliate / Not on
// MyFreeScoreNow / back to auto-detect (override: null). Admin-only, same
// as the rest of the affiliate-gap surface (not in the employee
// allowlist -- see lib/auth.js). This lives purely in our own store for
// now; there's no outbound webhook to MyFreeScoreNow yet (the
// /webhooks/mfsn sync only runs one direction, in from MFSN), so this
// doesn't push anything back to MFSN itself until Torgy's side supports
// it -- see task tracking "affiliate gap card" in PROJECT-NOTES for that
// follow-up.
app.post('/api/clients/:id/affiliate', async (req, res) => {
  try {
    const valid = ['affiliate', 'not_affiliate', 'not_on_mfsn'];
    const override = valid.includes(req.body.override) ? req.body.override : null;
    store.setAffiliateOverride(req.params.id, override);
    // The tagged roster is cached (see /api/clients/:id), and an override is
    // exactly the input that makes it wrong. Without this the drawer showed the
    // old affiliate status for up to a minute after changing it.
    store.clearCacheKey('clients:tagged');
    const clients = withAffiliateTags(await getClients());
    const c = clients.find(x => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true, mfsnStatus: c.mfsnStatus, mfsnMatched: c.mfsnMatched, mfsnOverride: c.mfsnOverride });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// set active/inactive — updates GHL tags in live mode
app.post('/api/clients/:id/status', async (req, res) => {
  try {
    const status = req.body.status === 'active' ? 'active' : 'inactive';
    if (readOnly() && liveMode()) return refuseWrite(res, 'setStatus', `${req.params.id} -> ${status}`);
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

// Update a contact's email/phone/name. Used to fix records where a client
// paid for something (e.g. Mentorship, via Commas) under a different email
// than the one on file in GoHighLevel -- the Mentorship "Total mentees"
// drill-down matches by email, so a stale/mismatched email silently hides a
// real client from that filter. Admin-only, same write-gating as the rest
// of this section.
app.post('/api/clients/:id/contact', async (req, res) => {
  try {
    const email = (req.body.email || '').trim() || undefined;
    const phone = (req.body.phone || '').trim() || undefined;
    if (!email && !phone) return res.status(400).json({ error: 'email or phone required' });
    if (readOnly() && liveMode()) return refuseWrite(res, 'updateContact', `${req.params.id} -> ${email || phone}`);
    if (liveMode()) {
      const c = await ghl.updateContact(store.getConfig(), req.params.id, { email, phone });
      store.clearCache();
      return res.json({ ok: true, client: c });
    }
    const c = demoData().clients.find(x => x.id === req.params.id);
    if (c) { if (email) c.email = email; if (phone) c.phone = phone; }
    res.json({ ok: true, demo: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Add/remove arbitrary GHL tags on a contact. Used to fix contacts whose
// tags fell out of sync with reality -- e.g. a contact still marked
// status:lead in GHL after Deal Production shows the client well into
// actual rounds (or completed). Admin-only, same write-gating as the rest
// of this section (READ_ONLY blocks it in live mode, same as setStatus/sms).
app.post('/api/clients/:id/tags', async (req, res) => {
  try {
    const add = Array.isArray(req.body.add) ? req.body.add.filter(Boolean) : [];
    const remove = Array.isArray(req.body.remove) ? req.body.remove.filter(Boolean) : [];
    if (!add.length && !remove.length) return res.status(400).json({ error: 'add or remove required' });
    if (readOnly() && liveMode()) return refuseWrite(res, 'setTags', `${req.params.id} +[${add}] -[${remove}]`);
    if (liveMode()) {
      if (add.length) await ghl.addTags(store.getConfig(), req.params.id, add);
      if (remove.length) await ghl.removeTags(store.getConfig(), req.params.id, remove).catch(() => {});
      store.clearCache();
    } else {
      const c = demoData().clients.find(x => x.id === req.params.id);
      if (c) {
        c.tags = (c.tags || []).filter(t => !remove.includes(t)).concat(add.filter(t => !(c.tags || []).includes(t)));
      }
    }
    res.json({ ok: true, added: add, removed: remove });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Move a client to a different round -- the Pipeline board's "column" for a
// GHL-sourced card (see /api/pipeline). round lives on GHL as a 'round:N'
// tag (see lib/ghl.js's tag('round:') parsing that decorates c.round in the
// first place), so this swaps the old tag for the new one, same pattern as
// setStatus above. round: null clears it, moving the card back to the
// board's "New / Onboarding" bucket. Explicitly open to both roles
// (2026-08-05) -- Deal Production's own `stage` field got the same
// treatment, see EMPLOYEE_FIELDS in lib/auth.js.
app.post('/api/clients/:id/round', async (req, res) => {
  store.clearCacheKey('clients:tagged'); // a round change alters what the drawer shows
  try {
    const round = req.body.round != null && String(req.body.round).trim() !== '' ? String(req.body.round).trim() : null;
    if (round && !/^\d+$/.test(round)) return res.status(400).json({ error: 'round must be a whole number' });
    if (readOnly() && liveMode()) return refuseWrite(res, 'setRound', `${req.params.id} -> ${round}`);
    const clients = await getClients();
    const c = clients.find(x => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    const removeTag = c.round ? ['round:' + c.round] : [];
    const addTag = round ? ['round:' + round] : [];
    if (liveMode()) {
      if (addTag.length) await ghl.addTags(store.getConfig(), req.params.id, addTag);
      if (removeTag.length) await ghl.removeTags(store.getConfig(), req.params.id, removeTag).catch(() => {});
      store.clearCache();
    } else {
      const dc = demoData().clients.find(x => x.id === req.params.id);
      if (dc) {
        dc.tags = (dc.tags || []).filter(t => !removeTag.includes(t)).concat(addTag.filter(t => !(dc.tags || []).includes(t)));
        dc.round = round;
      }
    }
    res.json({ ok: true, round });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// send SMS via GHL (live mode only)
app.post('/api/clients/:id/sms', async (req, res) => {
  try {
    const message = (req.body.message || '').trim();
    if (!message) return res.status(400).json({ error: 'empty message' });
    if (readOnly() && liveMode()) return refuseWrite(res, 'sendSMS', `${req.params.id} (${message.length} chars)`);
    if (!liveMode()) return res.json({ ok: true, demo: true, note: 'Demo mode — no SMS actually sent. Connect GHL to enable.' });
    const r = await ghl.sendSMS(store.getConfig(), req.params.id, message);
    store.addEvent({ type: 'sms_out', at: new Date().toISOString(), clientId: req.params.id });
    // Attributed, so "messages sent" is a real per-person number rather than a
    // volume nobody owns.
    const smsWho = (getUsers().find(u => u.id === req.user.userId) || {}).name || 'Unknown';
    store.appendAudit([audit.actionEntry('message_sent', { who: smsWho, clientId: req.params.id })]);
    res.json({ ok: true, id: r.messageId || r.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Create a new client. Admin-only (not in EMPLOYEE_API -- see lib/auth.js).
// In live mode this creates a real contact in GoHighLevel (ghl.createContact);
// GHL treats a matching email/phone as a duplicate rather than erroring, so
// that comes back here as {duplicate:true, existingId} instead of a failure.
// In demo mode it just pushes into the in-memory demo roster.
app.post('/api/clients', async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim() || null;
    const phone = (req.body.phone || '').trim() || null;
    if (!name) return res.status(400).json({ error: 'name required' });
    if (!email && !phone) return res.status(400).json({ error: 'email or phone required (GoHighLevel needs one to create a contact)' });
    if (readOnly() && liveMode()) return refuseWrite(res, 'createClient', `${name} (${email || phone})`);

    if (liveMode()) {
      const parts = name.split(/\s+/);
      const firstName = parts[0];
      const lastName = parts.slice(1).join(' ') || undefined;
      const r = await ghl.createContact(store.getConfig(), { firstName, lastName, email, phone });
      store.clearCache();
      if (r.duplicate) return res.json({ ok: true, duplicate: true, existingId: r.existingId, message: r.message });
      return res.json({ ok: true, duplicate: false, id: r.contact.id });
    }

    const c = { id: 'demo-' + Date.now(), name, email, phone, createdAt: new Date().toISOString(), tags: ['status:active'], status: 'active', round: null, deal: null, totalSpent: 0, lastPaymentDate: null, numberOfPayments: 0 };
    demoData().clients.push(c);
    res.json({ ok: true, duplicate: false, id: c.id, demo: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// tasks / follow-ups
app.get('/api/tasks', (req, res) => {
  const t = store.getTasks().sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  res.json({ open: t.filter(x => !x.done), done: t.filter(x => x.done).slice(-30).reverse() });
});
app.post('/api/tasks', (req, res) => {
  const { title, clientId, clientName, due, notes, assignedTo } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });
  const creator = getUsers().find(u => u.id === req.user.userId);
  const assignee = assignedTo ? getUsers().find(u => u.id === assignedTo) : null;
  const mentions = resolveMentions(notes || '');
  const task = store.addTask({
    title: title.trim(),
    clientId: clientId || null,
    clientName: clientName || null,
    due: due || null,
    notes: (notes || '').trim() || null,
    createdBy: creator ? creator.id : null,
    createdByName: creator ? creator.name : null,
    assignedTo: assignee ? assignee.id : null,
    assignedToName: assignee ? assignee.name : null,
    mentions: mentions.map(u => u.id)
  });
  if (assignee && assignee.id !== (creator && creator.id)) {
    store.addNotification({
      userId: assignee.id, type: 'assigned', refType: 'task', refId: task.id,
      clientId: task.clientId, clientName: task.clientName,
      text: task.title, fromName: creator ? creator.name : 'Someone'
    });
  }
  notifyMentions(mentions, { type: 'mention', refType: 'task', refId: task.id, clientId: task.clientId, clientName: task.clientName, text: task.title, fromName: creator ? creator.name : 'Someone' }, assignee ? [assignee.id] : []);
  res.json(task);
});
app.patch('/api/tasks/:id', (req, res) => {
  const patch = { ...req.body };
  if (Object.prototype.hasOwnProperty.call(patch, 'assignedTo')) {
    const assignee = patch.assignedTo ? getUsers().find(u => u.id === patch.assignedTo) : null;
    patch.assignedTo = assignee ? assignee.id : null;
    patch.assignedToName = assignee ? assignee.name : null;
    if (assignee) {
      const actor = getUsers().find(u => u.id === req.user.userId);
      store.addNotification({
        userId: assignee.id, type: 'assigned', refType: 'task', refId: req.params.id,
        text: patch.title || undefined, fromName: actor ? actor.name : 'Someone'
      });
    }
  }
  const t = store.updateTask(req.params.id, patch);
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json(t);
});
app.delete('/api/tasks/:id', (req, res) => { store.deleteTask(req.params.id); res.json({ ok: true }); });

// task notes -- a thread so more than one person can leave their own
// update on a follow-up task, same @mention handling as client notes
// (see POST /api/clients/:id/notes above).
app.get('/api/tasks/:id/notes', (req, res) => {
  res.json(store.getTaskNotes(req.params.id).sort((a, b) => a.at.localeCompare(b.at)));
});
app.post('/api/tasks/:id/notes', (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'empty note' });
  const task = store.getTasks().find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'not found' });
  const author = getUsers().find(u => u.id === req.user.userId);
  const mentions = resolveMentions(text);
  const note = store.addTaskNote(req.params.id, text, {
    authorId: author ? author.id : null,
    authorName: author ? author.name : null,
    mentions: mentions.map(u => u.id)
  });
  const skip = [author ? author.id : null];
  if (task.assignedTo) skip.push(task.assignedTo); // they'll see it on the task itself
  notifyMentions(mentions, { type: 'mention', refType: 'task', refId: task.id, clientId: task.clientId, clientName: task.clientName, text, fromName: author ? author.name : 'Someone' }, skip);
  res.json(note);
});
app.delete('/api/task-notes/:id', (req, res) => { store.deleteTaskNote(req.params.id); res.json({ ok: true }); });

// notifications (in-app bell) — everyone can read/clear their own
app.get('/api/notifications', (req, res) => {
  const list = store.getNotifications(req.user.userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ notifications: list.slice(0, 100), unread: list.filter(n => !n.read).length });
});
app.post('/api/notifications/:id/read', (req, res) => {
  store.markNotificationRead(req.user.userId, req.params.id);
  res.json({ ok: true });
});
app.post('/api/notifications/read-all', (req, res) => {
  store.markAllNotificationsRead(req.user.userId);
  res.json({ ok: true });
});

// dashboard layout (free drag/resize via GridStack) — per login, both roles.
// layout.nodes is GridStack's own [{id,x,y,w,h}, ...] node list.
//
// Three tiers: (1) a personal override, saved automatically on every
// drag/resize -- once someone has one, it always wins; (2) a site-wide
// default an admin can promote their own current arrangement into, for
// anyone who hasn't personally rearranged anything; (3) failing both, the
// HTML's own shipped gs-w/gs-h/gs-x/gs-y attributes.
app.get('/api/dashboard-layout', (req, res) => {
  res.json({ layout: store.getDashboardLayout(req.user.userId) });
});
app.post('/api/dashboard-layout', (req, res) => {
  const layout = req.body && req.body.layout;
  if (!layout || !Array.isArray(layout.nodes)) return res.status(400).json({ error: 'layout.nodes (array) is required' });
  store.setDashboardLayout(req.user.userId, layout);
  res.json({ ok: true });
});
// "Reset to default": drop the personal override so the site default (or
// the shipped HTML order) takes back over, rather than pinning the user to
// an explicit empty layout that would never see a future default either.
app.delete('/api/dashboard-layout', (req, res) => {
  store.clearDashboardLayout(req.user.userId);
  res.json({ ok: true });
});
// Admin-only: promote a layout (normally the admin's own current
// arrangement) to be what everyone without a personal override sees.
// Anyone who already has their own saved layout is unaffected -- this
// only changes the fallback.
app.post('/api/dashboard-layout/default', (req, res) => {
  if (req.effectiveRole !== 'admin') return res.status(403).json({ error: 'admin only' });
  const layout = req.body && req.body.layout;
  if (!layout || !Array.isArray(layout.nodes)) return res.status(400).json({ error: 'layout.nodes (array) is required' });
  store.setDefaultDashboardLayout(layout);
  // resetEveryone -- also drop everyone's *personal* saved layout so this
  // actually takes effect for people who already dragged/resized something
  // themselves, not just new logins. Without this, "set as default" is a
  // no-op for anyone who'd ever touched their own layout, since a personal
  // override always wins over the site default (see getDashboardLayout).
  let clearedCount = 0;
  if (req.body && req.body.resetEveryone) clearedCount = store.clearAllPersonalDashboardLayouts();
  res.json({ ok: true, clearedCount });
});
// Admin-only: drop the site-wide default entirely (not replace it -- remove
// it) so everyone without a personal override falls back to the HTML's own
// shipped card layout. Pairs with the DELETE above, which only ever clears
// one person's own override; this is the "undo a bad 'set as default'"
// button, and also the only way to clear a __default__ entry that predates
// the current HTML (e.g. one inherited from a template/seed) instead of
// replacing it with yet another hardcoded snapshot.
app.delete('/api/dashboard-layout/default', (req, res) => {
  if (req.effectiveRole !== 'admin') return res.status(403).json({ error: 'admin only' });
  const had = store.clearDefaultDashboardLayout();
  let clearedCount = 0;
  if (req.body && req.body.resetEveryone) clearedCount = store.clearAllPersonalDashboardLayouts();
  res.json({ ok: true, had, clearedCount });
});

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
      // DisputeFox does send account-level events with no client attached
      // (e.g. action:"report_imported") -- name/email blank is expected
      // there, not a mapping bug; fall back to something displayable
      // instead of a nameless "?" row.
      items.push({ kind: 'dispute', at: d.at || d.receivedAt, title: d.name || d.email || 'DisputeFox update', sub: (d.action || 'dispute') + (d.round ? ' · R' + d.round : '') });
    for (const c of clients.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 15))
      items.push({ kind: 'client', at: c.createdAt, title: c.name, sub: 'new client' });
    items.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    res.json({ items: items.slice(0, 30) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// pipeline board: active clients grouped by round (mirrors GHL Credit Repair Delivery),
// PLUS the Deal Production tracker's Onboarding and Completed buckets merged in
// as the first and last columns -- the round-based data above only ever covers
// "currently mid-dispute" clients, so without this the board silently started
// at whatever round happened to have the earliest active client and never
// showed anyone who just signed (no round yet) or finished (no longer active).
// Deal Production records don't carry a dollar figure (that lives on the GHL
// client record, which these leads may or may not still be tied to), so they
// contribute clients/count but not revenue -- the column's revenue line is
// left honestly at whatever the round-based side actually collected.
app.get('/api/pipeline', async (req, res) => {
  try {
    const clients = await getClients();
    const active = clients.filter(c => c.status === 'active');
    const cols = {};
    for (const c of active) {
      const key = c.round ? 'Round ' + c.round : 'New / Onboarding';
      cols[key] = cols[key] || { clients: [], revenue: 0 };
      // kind:'ghl' -- a real GHL contact id, so the client-side detail panel
      // opens it via GET /api/clients/:id (which now also carries the Deal
      // Production cross-reference itself, see findProductionMatch above).
      cols[key].clients.push({ id: c.id, kind: 'ghl', name: c.name, deal: c.deal, totalSpent: c.totalSpent, lastPaymentDate: c.lastPaymentDate });
      cols[key].revenue += c.totalSpent || 0;
    }
    const prod = await readProd() || [];
    const prodStageKey = { Onboarding: 'New / Onboarding', Completed: 'Done' };
    let prodMerged = 0;
    for (const p of prod) {
      const key = prodStageKey[p.stage];
      if (!key) continue; // 'Ready' isn't part of this board -- only onboarding/completed bookend it
      cols[key] = cols[key] || { clients: [], revenue: 0 };
      // These come from Deal Production, not the GHL contact list -- p.id
      // is a production-only id and would 404 against /api/clients/:id.
      // Use the real GHL contact id when this record has one (reconciled
      // from GHL, see 'G' + c.id / ghlId: c.id elsewhere in this file), and
      // fall back to a production-only detail lookup (GET /api/production/:id)
      // when it doesn't -- e.g. an old sheet-import with no GHL match yet.
      cols[key].clients.push({
        id: p.ghlId || p.id, kind: p.ghlId ? 'ghl' : 'production',
        name: p.name, deal: p.pkg, totalSpent: 0, lastPaymentDate: null,
        production: productionSummary(p)
      });
      prodMerged++;
    }
    const order = k => k === 'New / Onboarding' ? 0 : k === 'Done' ? 999 : parseInt(k.replace('Round ', '')) || 500;
    const columns = Object.entries(cols)
      .sort((a, b) => order(a[0]) - order(b[0]))
      .map(([name, v]) => ({
        name, count: v.clients.length, revenue: Math.round(v.revenue),
        // Every client in the column, not just the top 30 by spend -- the
        // board's own column scrolls (see .pipe-col in index.html) so
        // there's somewhere for the rest to go.
        clients: v.clients.sort((a, b) => (b.totalSpent || 0) - (a.totalSpent || 0))
      }));
    res.json({
      totalActive: active.length + prodMerged,
      totalRevenue: Math.round(active.reduce((s, c) => s + (c.totalSpent || 0), 0)),
      columns
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ------------------------- settings -------------------------
const mask = v => (v ? v.slice(0, 4) + '••••' + v.slice(-4) : '');
app.get('/api/config', (req, res) => {
  const c = store.getConfig();
  res.json({
    ghlToken: mask(c.ghlToken), ghlLocationId: c.ghlLocationId,
    metaPageToken: mask(c.metaPageToken), fbPageId: c.fbPageId, igUserId: c.igUserId,
    // A fixed run of asterisks, not "(set)" -- "(set)" reads too much like
    // "not set" at a glance, which has previously led to someone assuming a
    // secret was missing and typing a new one over a working integration.
    webhookSecret: c.webhookSecret ? '**********' : '', appPassword: c.appPassword ? '(set)' : '(default)',
    mode: liveMode() ? 'live' : 'demo'
  });
});
// Lets an admin copy the real webhook secret straight to the clipboard
// (see copyWebhookSecret() in index.html) without ever rendering it as
// visible page text -- GET /api/config above deliberately never returns it.
// Same permission boundary as every other /api/config route (admin-only by
// the deny-by-default gate; not added to EMPLOYEE_API).
app.get('/api/config/webhook-secret', (req, res) => {
  res.json({ secret: store.getConfig().webhookSecret || '' });
});
app.post('/api/config', async (req, res) => {
  const allowed = ['ghlToken', 'ghlLocationId', 'metaPageToken', 'fbPageId', 'igUserId', 'igHandle', 'fbPageUrl', 'webhookSecret', 'appPassword'];
  const patch = {};
  for (const k of allowed) if (typeof req.body[k] === 'string' && req.body[k] !== '' && !req.body[k].includes('••••')) patch[k] = req.body[k].trim();
  // Let the user paste the whole sub-account URL into the Location ID field.
  if (patch.ghlLocationId) patch.ghlLocationId = ghlcreds.extractLocationId(patch.ghlLocationId);
  // Postgres first, JSON backup after -- see store.setConfigPrimary().
  await store.setConfigPrimary(patch);
  store.clearCache();
  res.json({ ok: true, mode: liveMode() ? 'live' : 'demo' });
});
app.post('/api/test/ghl', async (req, res) => {
  const cfg = store.getConfig();
  // Safe shape of the stored token — no secret revealed, just enough to tell a
  // truncated / regenerated / masked-and-saved token apart from a real one.
  const t = String(cfg.ghlToken || '');
  const tokenShape = { length: t.length, prefix: t.slice(0, 4), hasWhitespace: /\s/.test(t), looksMasked: t.includes('•') };

  // Catch the field mix-ups locally, before troubling GoHighLevel with a call
  // whose failure it will only describe vaguely.
  const tokenCheck = ghlcreds.classifyToken(cfg.ghlToken);
  const locCheck = ghlcreds.classifyLocationId(cfg.ghlLocationId);
  if (!tokenCheck.ok || !locCheck.ok) {
    return res.status(400).json({ ok: false, error: 'Fix these before testing', hints: [tokenCheck, locCheck].filter(x => !x.ok).map(x => x.message), tokenShape });
  }

  try { res.json({ ...(await ghl.testConnection(cfg)), tokenShape }); }
  // Surface GoHighLevel's own reason (scope/location) — this is an admin
  // diagnostic, so the raw detail is what makes it useful.
  catch (e) { res.status(400).json({ ok: false, error: e.message, status: e.status, detail: e.detail, tokenShape }); }
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
// Given a sale, make sure the payer exists as a GHL contact (status:active)
// and has a Deal Production record in "Onboarding" -- so a payment shows up
// as a tracked client here without depending on a second, separate
// Fanbasis->GHL Zap (that hop is exactly what went quiet on 2026-07-20).
// Idempotent: createContact's own duplicate detection, plus a ghlId/email
// check against the current Deal Production roster, both no-op on a repeat
// call for the same person instead of creating a second copy.
async function ensureClientFromPayment(ev) {
  const cfg = store.getConfig();
  const parts = (ev.name || '').trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] || (ev.email ? ev.email.split('@')[0] : 'New');
  const lastName = parts.slice(1).join(' ') || undefined;

  const r = await ghl.createContact(cfg, {
    firstName, lastName, email: ev.email || null, phone: ev.phone || null,
    tags: ['status:active']
  });

  let contact;
  if (r.duplicate) {
    // already a GHL contact -- pull the real record so Deal Production gets
    // an actual name/round/deal instead of guessing from the webhook body
    const clients = await getClients();
    contact = clients.find(c => c.id === r.existingId)
      || { id: r.existingId, name: ev.name || ev.email, email: ev.email, phone: ev.phone, round: null, deal: null };
  } else {
    contact = r.contact;
    store.clearCache(); // brand-new contact -- next /api/clients read should see it
  }

  const prod = await readProd() || [];
  const already = prod.some(c => c.ghlId === contact.id
    || (ev.email && c.email && c.email.toLowerCase() === ev.email.toLowerCase()));
  if (!already) {
    const rec = makeProdRecordFromGhl(contact);
    rec.stage = 'Onboarding'; // a brand-new payer always starts here, regardless of any stale round/deal tag
    rec.notes = [{
      when: new Date().toISOString().slice(0, 10), who: 'System',
      text: `Auto-added from a Commas/Fanbasis payment ($${ev.amount}${ev.product ? ' · ' + ev.product : ''}) — verify package, stage, and documents.`
    }];
    await dealProd.appendProdRecords(prod, [rec]); // Postgres first, JSON backup -- see lib/production.js
  }
  return { ghlId: contact.id, duplicate: !!r.duplicate, addedToProduction: !already };
}

// FanBasis New Sale -> here. Same handler under /webhooks/commas too, since
// that's what Tiffany's team actually calls this payment platform day to
// day -- point a new Zap or n8n workflow at whichever name reads clearer,
// same secret, identical behavior either way.
async function handlePaymentWebhook(req, res) {
  if (!checkSecret(req, res)) return;
  const b = req.body || {};
  const ev = {
    type: 'payment',
    at: b.sale_date || b.date || b.created_at || new Date().toISOString(),
    amount: parseFloat(String(b.amount || b.total || b.price || '').replace(/[$,]/g, '')) || 0,
    email: (b.email || b.customer_email || '').toLowerCase(),
    name: b.name || b.customer_name || '',
    phone: b.phone || b.customer_phone || '',
    product: b.product || b.product_name || b.offer || ''
  };
  // dedupe: same email + amount + same day = same sale (protects webhook+backfill overlap)
  const day = localDay(ev.at);
  const dup = store.getEvents().find(e => e.type === 'payment' && e.email === ev.email
    && Math.abs((e.amount || 0) - ev.amount) < 0.01 && localDay(e.at || e.receivedAt) === day);
  if (dup) return res.json({ ok: true, id: dup.id, deduped: true });
  const saved = store.addEvent(ev);

  let client = null;
  // READ_ONLY (dev-against-real-keys safety switch) skips the GHL write,
  // same as every other live write in this file; the payment itself is
  // still recorded either way.
  if (liveMode() && !readOnly() && (ev.email || ev.phone)) {
    try { client = await ensureClientFromPayment(ev); }
    catch (e) { console.error('payment webhook: client/production sync failed:', e.message); }
  }
  res.json({ ok: true, id: saved.id, client });
}
app.post('/webhooks/fanbasis', handlePaymentWebhook);
app.post('/webhooks/commas', handlePaymentWebhook);

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

// MyFreeScoreNow enrolled members, from a scheduled Zapier "Fetch Active
// Members List" Zap. A `members` array is a full snapshot and REPLACES the set
// (so members who dropped off disappear); a single member is upserted.
app.post('/webhooks/mfsn', (req, res) => {
  if (!checkSecret(req, res)) return;
  const b = req.body || {};
  const incoming = Array.isArray(b) ? b : (Array.isArray(b.members) ? b.members : null);
  let members;
  if (incoming) {
    members = affiliate.normalizeMembers(incoming); // full snapshot: replace
  } else if (b.email || b.name) {
    members = affiliate.normalizeMembers(store.getMfsnMembers().concat([{ email: b.email, name: b.name }])); // upsert one
  } else {
    return res.status(400).json({ error: 'send a members array or a single {email,name}' });
  }
  store.setMfsnMembers(members);
  store.setMfsnSyncedAt(new Date().toISOString());
  res.json({ ok: true, count: members.length });
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
// unref so these timers never hold the process open on their own; the HTTP
// server keeps the loop alive in production, and tests can exit cleanly.
setInterval(takeSnapshot, 6 * 60 * 60 * 1000).unref(); // every 6h
setTimeout(takeSnapshot, 15 * 1000).unref(); // shortly after boot

// ------------------------- Deal Production (client work desk) — shared team persistence -------------------------
// Postgres-primary (Supabase), JSON is a live backup + fallback -- see
// lib/production.js's header comment for the full read/write design.
// readProd/writeProd are now async; every call site below awaits them.
const readProd = dealProd.readProd;
// Which clients are on MyFreeScoreNow under her affiliate link
// ("affiliate"), on MyFreeScoreNow but not under her link ("notAffiliate"
// -- the group worth reaching out to), or not on MyFreeScoreNow at all
// ("notOnMfsn"). Admin-only (not in the employee allowlist, so denied by
// default).
app.get('/api/affiliate-gap', async (req, res) => {
  try {
    const clients = await getClients();
    const synced = store.getMfsnMembers();
    // This clone has never had a real /webhooks/mfsn sync run against it (no
    // MyFreeScoreNow credentials here, by design). Rather than showing an
    // empty "no members synced yet" card, mirror the snapshot from Tiffany's
    // live dashboard as of 2026-08-03 so the card demos the same numbers.
    // If this clone is ever pointed at a real MFSN sync, synced.length
    // becomes nonzero and this fallback stops being used automatically.
    const gap = synced.length
      ? affiliate.affiliateGap(clients, synced, store.getAffiliateOverrides())
      : {
          counts: { affiliate: 1217, notAffiliate: 0, notOnMfsn: 4260, total: 5477 },
          revenue: { affiliate: 16225, notOnMfsn: 62324 },
          notAffiliate: [], notOnMfsn: [], prospects: []
        };
    const brief = c => ({ id: c.id, name: c.name, email: c.email || null, phone: c.phone || null });
    res.json({
      counts: gap.counts,
      revenue: gap.revenue, // $ figures per box, see lib/affiliate.js affiliateGap()
      notAffiliate: (gap.notAffiliate || []).map(brief), // on MFSN, not under her link
      notOnMfsn: (gap.notOnMfsn || []).map(brief), // no match on MFSN at all
      prospects: gap.prospects || [], // [{email, name}] on MFSN, matching no GHL contact by email or name
      syncedAt: synced.length ? store.getMfsnSyncedAt() : '2026-07-30T00:00:00.000Z',
      // Members already on MyFreeScoreNow but still flagged "Old" (Smart
      // Credit, not yet migrated) on MFSN's own Member List -- see
      // store.getMfsnOldStatus() for why this is a manual audit rather than
      // part of the live sync above.
      oldStatus: store.getMfsnOldStatus(),
      mode: liveMode() ? 'live' : 'demo'
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Re-run of the Member List (Member Type = Old) audit -- see
// store.getMfsnOldStatus(). Admin-only. Body: any subset of
// { active, activeTotal, paused, relinking }; auditedAt is always stamped
// to now by store.setMfsnOldStatus().
app.post('/api/mfsn-old-status', (req, res) => {
  if (req.effectiveRole !== 'admin') return res.status(403).json({ error: 'admin only' });
  const b = req.body || {};
  const patch = {};
  for (const k of ['active', 'activeTotal', 'paused', 'relinking']) {
    if (b[k] != null && Number.isFinite(Number(b[k]))) patch[k] = Number(b[k]);
  }
  res.json({ ok: true, oldStatus: store.setMfsnOldStatus(patch) });
});

// Which Deal Production clients are (not) enrolled under her MyFreeScoreNow
// affiliate link, PLUS which MyFreeScoreNow members match no client at all
// (prospects — on MFSN, not yet a credit-repair client). Computed live off
// the current roster + synced member list on every call; nothing is
// persisted here, so it always reflects the latest /webhooks/mfsn sync.
// Admin-only (not in the employee allowlist, so denied by default).
// The MFSN book and payout history, for any surface that needs to render it
// without recomputing the whole dashboard. Deliberately cheap: constants and
// a sort, no roster read, no GoHighLevel call -- the KPI tiles hit this on
// every load and must not cost what /api/dashboard costs.
app.get('/api/mfsn-summary', (req, res) => {
  // Income for the requested window, computed from the two monthly tables and
  // the payment feed -- no roster read, no GoHighLevel call. That matters:
  // /api/dashboard needs ~1.8s warm and ~17s on a cold Render container
  // (the free tier spins down after ~15 min idle), and while it ran, every
  // income figure on the page sat blank. Blank reads as broken. This answers
  // in well under a second, so the money shows up immediately and the slower
  // client-roster cards fill in when they're ready.
  const from = req.query.from || null;
  const to = req.query.to || null;
  const commas = commasIncomeForRange(from, to);
  const mfsn = mfsnIncomeForRange(from, to);
  res.json({
    members: MFSN_MEMBERS,
    months: incomeByMonth(),
    income: { commas, mfsn, total: commas + mfsn },
    lifetime: {
      commas: commasIncomeForRange(null, null),
      mfsn: Math.round(Object.values(MFSN_MONTHLY_INCOME).reduce((a, b) => a + b, 0))
    }
  });
});

// New clients waiting to be onboarded, and which have waited past the SLA.
// Reads the same Deal Production feed the tracker does, so the card and the
// queue can never disagree about who is waiting.
app.get('/api/onboarding', async (req, res) => {
  try {
    const list = await composedRoster();
    res.json(onboarding.buildQueue(list, {
      slaDays: Number(req.query.sla) || undefined,
      limit: Math.min(Number(req.query.limit) || 12, 200)
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Conversations the client spoke last in that nobody has answered. Reads the
// same cached conversation feed /api/messages does, so the two cannot disagree.
app.get('/api/replies-due', async (req, res) => {
  try {
    let list;
    if (!liveMode()) list = demoData().messages;
    else {
      const cfg = store.getConfig();
      list = await store.cached('messages', 45 * 1000, () => ghl.fetchAllConversations(cfg, { max: 300 }));
    }
    res.json(replies.buildQueue(list, {
      slaDays: Number(req.query.sla) || undefined,
      limit: Math.min(Number(req.query.limit) || 12, 200)
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Clients who have used every round they paid for. The upsell list -- and
// deliberately only people whose allowance can be read exactly, so nobody is
// pitched more rounds while they are still owed some.
app.get('/api/upsell', async (req, res) => {
  try {
    const list = await composedRoster();
    res.json(rounds.upsellQueue(list, {
      limit: Math.min(Number(req.query.limit) || 12, 200)
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin operations view: the state of the book, plus the clients who have paid
// and never had a first round filed.
app.get('/api/ops', async (req, res) => {
  try {
    const list = await composedRoster();
    res.json({
      snapshot: ops.snapshot(list, { newWithinDays: Number(req.query.newDays) || undefined }),
      firstRound: ops.firstRoundOverdue(list, {
        slaDays: Number(req.query.sla) || undefined,
        limit: Math.min(Number(req.query.limit) || 12, 200)
      })
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/team-activity', (req, res) => {
  try {
    res.json(audit.throughput(store.getAuditLog(), {
      days: Math.min(Number(req.query.days) || 30, 365)
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mfsn-gap', async (req, res) => {
  try {
    const clients = await readProd() || [];
    const gap = affiliate.productionGap(clients, store.getMfsnMembers());
    res.json({
      counts: gap.counts,
      prospects: gap.prospects, // [{email, name}] — on MFSN, no matching client
      syncedAt: store.getMfsnSyncedAt()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Merge each client's mfsn tag ('affiliate' | 'needs') in live, computed from
// the current synced member list -- never written back to production.json,
// so it can't fight with a colleague's PATCH.
function withMfsnTags(clients) {
  if (!Array.isArray(clients)) return clients;
  const gap = affiliate.productionGap(clients, store.getMfsnMembers());
  const tagOf = new Map(gap.tagged.map(t => [t.id, t.mfsn]));
  return clients.map(c => ({ ...c, mfsn: tagOf.get(c.id) || null }));
}

// Deal Production records come from the sheet and carry no purchase date --
// only days-in-stage. "Newest purchase first" is how the team actually works
// the onboarding queue (it is the sort their spreadsheet is kept in), so the
// date is joined on from the GoHighLevel roster, which does have it.
//
// Matched on email first and normalised name second, the same order and the
// same helpers lib/affiliate.js uses, so a client that matches for the MFSN
// tag matches here too rather than the two disagreeing about who is who.
// The fully composed roster: Deal Production + MFSN tags + purchase dates +
// round allowances. Building it means parsing 3,891 records, reading the GHL
// roster and matching 5,133 payment events -- about two seconds of CPU.
//
// Four endpoints need it (/api/production, /api/ops, /api/onboarding,
// /api/upsell) and the dashboard fires them all at once, so each page load
// was doing that work four times CONCURRENTLY on one small CPU -- measured
// live at 9-14 seconds each while they starved one another. store.cached()
// also collapses concurrent callers onto one in-flight build, so the four
// requests now share a single computation.
function composedRoster() {
  return store.cached('roster:composed', 60 * 1000, async () =>
    rounds.attach(await withLastPaid(withMfsnTags(await readProd()))));
}

async function withLastPaid(clients) {
  if (!Array.isArray(clients) || !clients.length) return clients;

  // The payment events are the real record: 5,133 of them carrying a name,
  // an email, an amount and a date. They give a FIRST purchase, which is the
  // honest clock for how long somebody has been waiting -- GoHighLevel only
  // carries the last payment, so a client who bought in January and paid again
  // in April looked four months newer than they were.
  const events = getPaymentEvents();

  // GHL's last_payment_date stays as the fallback for anyone with no matching
  // event. It is flagged as a stand-in rather than passed off as a first
  // purchase (see paidSource), so a caller can tell the two apart.
  let byId = new Map();
  try {
    const roster = await getClients();
    for (const r of roster) {
      if (r.lastPaymentDate) byId.set(affiliate.normEmail(r.email) || affiliate.normName(r.name), r.lastPaymentDate);
    }
  } catch (e) { /* no roster is fine; the events carry most of it */ }

  return purchases.attach(clients, events, {
    fallback: c => byId.get(affiliate.normEmail(c.email) || affiliate.normName(c.name)) || null
  });
}

app.get('/api/production', async (req, res) => {
  try {
    res.json({
      clients: auth.stripCfpbSecretsAll(await composedRoster())
        .map(c => auth.redactClient(req.actor, c)),
      mode: liveMode() ? 'live' : 'demo'
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ------------------------- dispute desk -------------------------
//
// A projection over Deal Production (see lib/disputes.js), not a second
// store. Its own routes rather than a filtered /api/production because a
// disputer must not receive the whole tracker row -- building the response
// field-by-field means a column added to Deal Production later cannot leak
// into this surface by default.

app.get('/api/disputes/queue', async (req, res) => {
  try {
    const list = await readProd();
    if (!Array.isArray(list)) return res.status(503).json({ error: 'no production data loaded' });
    res.json({ queue: disputes.buildQueue(list), mode: liveMode() ? 'live' : 'demo' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/disputes/:id', async (req, res) => {
  try {
    const rec = await dealProd.readOneProdRecord(req.params.id);
    const record = disputes.toDisputeRecord(rec);
    if (!record) return res.status(404).json({ error: 'no such client' });
    res.json(record);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Same write path as a Deal Production PATCH -- Postgres first, then the JSON
// backup -- but the writable set comes from the caller's capabilities, so a
// disputer reaches the bureau columns and the round's CFPB login and nothing
// else (DISPUTE_FIELDS in lib/auth.js).
app.patch('/api/disputes/:id', async (req, res) => {
  const patch = { ...(req.body || {}) };
  delete patch.id;
  delete patch.who;
  delete patch.notes;

  const { allowed, denied } = auth.filterEditable(req.actor, patch);
  if (denied.length) {
    return res.status(403).json({ error: 'not allowed to change: ' + denied.join(', ') });
  }
  if (!Object.keys(allowed).length) return res.status(400).json({ error: 'nothing to change' });

  const who = (getUsers().find(u => u.id === req.user.userId) || {}).name || 'Unknown';
  try {
    const existing = await dealProd.readOneProdRecord(req.params.id);
    if (!existing) return res.status(404).json({ error: 'no such client' });
    await dealProd.patchProdRecord(req.params.id, { ...allowed }, who);
    // Same JSON-backup merge as the Deal Production PATCH -- without it, a
    // save in a Postgres-less environment silently changed nothing (caught
    // by an end-to-end check, not a unit test: the route answered 200 with
    // the unmodified record).
    const lead = await applyProdPatchToJson(req.params.id, allowed, who);
    try {
      store.appendAudit(audit.entriesFor(allowed, existing, { who, clientId: req.params.id }));
    } catch (e) { console.error('Audit write failed (the edit still saved):', e.message); }
    store.clearCacheKey('roster:composed');
    res.json(disputes.toDisputeRecord(lead || await dealProd.readOneProdRecord(req.params.id)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// One lead, for an open drawer to poll cheaply instead of pulling all 3,578
// -- goes through a targeted single-record query (dealProd.readOneProdRecord),
// NOT the full-roster readProd(), so this stays fast regardless of table size.
app.get('/api/production/:id', async (req, res) => {
  try {
    const lead = await dealProd.readOneProdRecord(req.params.id);
    if (!lead) return res.status(404).json({ error: 'no such lead' });
    const [tagged] = withMfsnTags([lead]);
    // Stable shape: a never-edited lead still reports updatedAt, so pollers can
    // rely on the field existing.
    res.json({ client: auth.stripCfpbSecrets(req.actor, { updatedAt: null, updatedBy: null, ...tagged }) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Legacy full-replace path -- JSON only (see lib/production.js
// writeProdJsonOnly's comment). Superseded by PATCH /api/production/:id.
app.post('/api/production', (req, res) => {
  const c = req.body && req.body.clients;
  if (!Array.isArray(c)) return res.status(400).json({ error: 'clients array required' });
  dealProd.writeProdJsonOnly(c);
  res.json({ ok: true, count: c.length });
});

// ------------------------- unified inbox: every GHL conversation channel -------------------------
// One feed for SMS, Email, and whatever else is wired up as a Conversation
// Provider inside this GHL sub-account (Facebook Messenger / Instagram DMs
// show up here too once connected in GHL's own Settings > Integrations --
// there's no separate Meta messaging API to build, GHL already unifies it).
// Fanbasis/Commas and DisputeFox are payment/dispute systems, not chat
// platforms, so they don't feed this list; DisputeFox's own client-portal
// messaging is a separate product with its own API key Tiffany would need
// to hand over before that can be added here too.
app.get('/api/messages', async (req, res) => {
  try {
    let list;
    if (!liveMode()) {
      list = demoData().messages;
    } else {
      const cfg = store.getConfig();
      list = await store.cached('messages', 45 * 1000, () => ghl.fetchAllConversations(cfg, { max: 300 }));
    }
    const channel = (req.query.channel || '').toUpperCase();
    const q = (req.query.q || '').trim().toLowerCase();
    const unreadOnly = req.query.unread === '1';
    let filtered = list;
    if (channel && channel !== 'ALL') filtered = filtered.filter(m => m.channelKey === channel);
    if (unreadOnly) filtered = filtered.filter(m => m.unread > 0);
    if (q) filtered = filtered.filter(m =>
      (m.name || '').toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q) || (m.phone || '').includes(q));
    const channels = [...new Set(list.map(m => m.channelKey))].sort();
    res.json({ conversations: filtered, total: filtered.length, channels, mode: liveMode() ? 'live' : 'demo' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Full thread for one conversation.
app.get('/api/messages/:id', async (req, res) => {
  try {
    if (!liveMode()) {
      const thread = demoData().messagesByConvo[req.params.id];
      if (!thread) return res.status(404).json({ error: 'no such conversation' });
      return res.json({ messages: thread, mode: 'demo' });
    }
    const cfg = store.getConfig();
    const raw = await ghl.fetchMessages(cfg, req.params.id);
    res.json({ messages: raw.map(ghl.normalizeMessage), mode: 'live' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reply to a conversation thread, on whatever channel it's using (SMS,
// Email, Facebook, Instagram, WhatsApp, ...). Admin-only for now, same
// caution as the existing client-profile "send SMS" button (not in
// EMPLOYEE_API) -- this reaches a real client. Same write-gating as the
// rest of this section: READ_ONLY refuses in live mode rather than
// pretending to succeed; demo mode is a harmless no-op.
app.post('/api/messages/:id/reply', async (req, res) => {
  try {
    const message = (req.body.message || '').trim();
    const contactId = req.body.contactId;
    const type = (req.body.type || 'SMS').toUpperCase();
    if (!message) return res.status(400).json({ error: 'empty message' });
    if (!contactId) return res.status(400).json({ error: 'contactId required' });
    if (readOnly() && liveMode()) return refuseWrite(res, 'replyMessage', `${req.params.id} (${type}, ${message.length} chars)`);
    if (!liveMode()) return res.json({ ok: true, demo: true, note: 'Demo mode — no message actually sent. Connect GHL to enable.' });
    const r = await ghl.sendMessage(store.getConfig(), { contactId, conversationId: req.params.id, type, message });
    store.addEvent({ type: 'message_out', channel: type, at: new Date().toISOString(), contactId, conversationId: req.params.id });
    const replyWho = (getUsers().find(u => u.id === req.user.userId) || {}).name || 'Unknown';
    store.appendAudit([audit.actionEntry('message_sent', { who: replyWho, clientId: contactId })]);
    store.clearCache();
    res.json({ ok: true, id: r.messageId || r.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Build a fresh Deal Production record for a GHL client that has never been
// tracked here before. ghlId is stored so a later reconcile run recognizes
// this record on sight (exact match) instead of falling back to the coarser
// name-key match the old sheet-only records rely on.
function makeProdRecordFromGhl(c) {
  return {
    id: 'G' + c.id, // prefixed so it can never collide with the sheet's C#### ids
    ghlId: c.id,
    name: c.name,
    email: c.email || null,
    phone: c.phone || null,
    pkg: c.deal || null,
    stage: c.round ? 'In rounds' : 'Onboarding',
    days: 0,
    tu: { r: 0, st: 'none' }, eq: { r: 0, st: 'none' }, ex: { r: 0, st: 'none' },
    docs: { SSC: false, DL: false, POA: false, FTC: false, 'Data breach': false, Affidavit: false, 'Perm. purpose': false, 'Experian letter': false },
    va: '—',
    notes: [{ when: new Date().toISOString().slice(0, 10), who: 'System', text: 'Auto-added from GoHighLevel — client not previously tracked in Deal Production. Verify package, stage, and documents.' }]
  };
}

// Reconciles the live GHL client list against the Deal Production roster
// (see lib/affiliate.js reconcileProduction for the matching rules). Any GHL
// credit-repair client with no existing Deal Production record gets one
// created here. The reverse direction -- a Deal Production client with no
// match in GHL -- is only reported, never acted on: the sheet import has no
// email or phone, so there is nothing usable to create a GHL contact from.
// Admin-only (not in the employee allowlist).
// Reconciles Tiffany's Google Sheet (Credit Repair tab, pasted as CSV) into
// Deal Production. The sheet is the source of truth for package/TU/EQ/EX/
// notes -- see lib/sheet.js for the exact matching and diff rules. Manual,
// one-time: an admin uploads the CSV export, this returns a full diff with
// apply defaulting to false (dry run) so the numbers can be sanity-checked
// before anything is written. Admin-only (not in the employee allowlist).
app.post('/api/production/sheet-sync', async (req, res) => {
  try {
    const csv = req.body && req.body.csv;
    if (typeof csv !== 'string' || !csv.trim()) return res.status(400).json({ error: 'csv text required' });
    const apply = req.body.apply === true;

    const rows = sheet.parseCsv(csv);
    const sheetRows = sheet.normalizeSheetRows(rows);
    const clients = await getClients();
    const prod = await readProd() || [];
    const { updates, toCreate, unmatched, duplicateNames } = sheet.reconcileSheet(sheetRows, clients, prod);

    if (apply) {
      const byId = new Map(prod.map(c => [c.id, c]));
      for (const u of updates) {
        const rec = byId.get(u.id);
        if (!rec) continue;
        // Postgres first (targeted per-record update, same path as a
        // regular drawer PATCH) -- u.patch already matches the field names
        // patchProdRecord expects (tu/eq/ex/pkg/stage/ghlId/name/email/phone,
        // see lib/sheet.js reconcileSheet()); u.sheetNote becomes a real
        // note row via the same `note` field the drawer's PATCH uses.
        await dealProd.patchProdRecord(u.id, { ...u.patch, note: u.sheetNote || undefined }, 'Sheet');
        // Keep the in-memory record (and therefore the JSON backup written
        // below via appendProdRecords) in sync with the same change.
        Object.assign(rec, u.patch);
        if (u.sheetNote) {
          rec.notes = rec.notes || [];
          rec.notes.push({ when: new Date().toISOString().slice(0, 10), who: 'Sheet', text: u.sheetNote });
        }
      }
      const created = toCreate.map(c => ({
        id: 'S' + c.ghlId, ghlId: c.ghlId, name: c.name, email: c.email, phone: c.phone,
        pkg: c.pkg, stage: c.stage, days: 0,
        tu: { r: c.tu.r, st: c.tu.st }, eq: { r: c.eq.r, st: c.eq.st }, ex: { r: c.ex.r, st: c.ex.st },
        docs: { SSC: false, DL: false, POA: false, FTC: false, 'Data breach': false, Affidavit: false, 'Perm. purpose': false, 'Experian letter': false },
        va: '—',
        cfpb: c.cfpb || [],
        notes: [{ when: new Date().toISOString().slice(0, 10), who: 'Sheet', text: c.notes || 'Added from the Credit Repair sheet — not previously tracked in Deal Production.' }]
      }));
      // Postgres first for the brand-new records too, JSON backup written
      // last with the FULL merged roster (updates above + these creates).
      await dealProd.appendProdRecords(prod, created);
    }

    res.json({
      ok: true,
      apply,
      sheetRowCount: sheetRows.length,
      updatesCount: updates.length,
      updates: updates.map(u => ({ id: u.id, patch: u.patch, matchedGhl: u.matchedGhl })),
      toCreateCount: toCreate.length,
      toCreate: toCreate.map(c => ({ ghlId: c.ghlId, name: c.name, email: c.email, pkg: c.pkg, stage: c.stage })),
      unmatchedCount: unmatched.length,
      unmatched: unmatched.map(r => ({ name: r.name, pkg: r.pkg })),
      duplicateNameCount: duplicateNames.length,
      duplicateNames: duplicateNames.map(r => r.name)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Shared by the admin-triggered route below and the automatic 12h cron
// route (see /internal/cron/sync-ghl) -- same gap-fill, same Postgres-first
// write path, just two different triggers for calling it.
async function runGhlReconcile() {
  const clients = await getClients();
  const prod = await readProd() || [];
  const { toAdd, notInGhl } = affiliate.reconcileProduction(clients, prod);
  const newRecords = toAdd.map(makeProdRecordFromGhl);
  if (newRecords.length) await dealProd.appendProdRecords(prod, newRecords);
  return {
    addedCount: newRecords.length,
    added: newRecords.map(r => ({ id: r.id, name: r.name, email: r.email })),
    notInGhlCount: notInGhl.length,
    notInGhl: notInGhl.map(c => ({ id: c.id, name: c.name }))
  };
}

app.post('/api/production/reconcile', async (req, res) => {
  try { res.json({ ok: true, ...(await runGhlReconcile()) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Machine-to-machine trigger for the automatic 12h GHL -> Deal Production
// sync (see .github/workflows/sync-ghl.yml) -- gated by CRON_SECRET, a
// plain env var separate from the Settings-configured webhookSecret (same
// reasoning as SSO_SHARED_SECRET/TICKETS_SHARED_SECRET: a leak of one
// shared secret shouldn't grant the other). No admin session is involved
// since GitHub Actions can't hold a login cookie -- this path is exempted
// from the session gate above the same way /webhooks/* is, and enforces
// its own auth here instead.
app.post('/internal/cron/sync-ghl', async (req, res) => {
  const configured = process.env.CRON_SECRET || '';
  if (!configured) return res.status(503).json({ error: 'CRON_SECRET not configured' });
  const provided = Buffer.from(String(req.headers['x-cron-secret'] || ''));
  const expected = Buffer.from(configured);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return res.status(401).json({ error: 'bad secret' });
  }
  try { res.json({ ok: true, ...(await runGhlReconcile()) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Update one lead. The UI used to POST all 3,578 records on every keystroke,
// so whoever saved last silently erased everyone else's work. Patching a single
// record means two people on different leads never collide.
//
// Postgres-primary: the actual persistence a patch depends on is
// dealProd.patchProdRecord()'s targeted per-row Postgres UPDATE, which is
// safe under real concurrency on its own (unlike the old synchronous
// whole-array JSON approach this comment used to describe). The JSON
// backup below still reads/mutates/writes the full array, so two PATCHes
// to two DIFFERENT records landing in the same instant could theoretically
// Apply an already-permission-filtered patch to the JSON backup: the same
// deep-merge both PATCH routes need. Postgres is written first by the
// caller (dealProd.patchProdRecord); this keeps the local fallback copy in
// step so a save still lands when Postgres is unreachable -- which is also
// the only copy in a no-DATABASE_URL environment.
async function applyProdPatchToJson(id, allowed, who) {
  const list = await readProd();
  if (!Array.isArray(list)) return null;
  const idx = list.findIndex(c => c.id === id);
  if (idx === -1) return null;
  const note = allowed.note;
  const rest = { ...allowed };
  delete rest.note;
  const lead = { ...list[idx] };
  for (const k of Object.keys(rest)) {
    if (['tu', 'eq', 'ex', 'docs'].includes(k) && rest[k] && typeof rest[k] === 'object') {
      lead[k] = { ...(lead[k] || {}), ...rest[k] };
    } else {
      lead[k] = rest[k];
    }
  }
  if (note && String(note).trim()) {
    lead.notes = (lead.notes || []).concat([{
      when: new Date().toISOString().slice(0, 10),
      who,
      text: String(note).trim()
    }]);
  }
  lead.updatedAt = new Date().toISOString();
  lead.updatedBy = who;
  list[idx] = lead;
  dealProd.writeJsonBackup(list);
  return lead;
}

// clobber each other on the JSON side only -- acceptable given JSON is now
// a backup, not the source of truth; Postgres has both changes correctly
// either way.
app.patch('/api/production/:id', async (req, res) => {
  const list = await readProd();
  if (!Array.isArray(list)) return res.status(503).json({ error: 'no production data loaded' });

  const idx = list.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'no such lead' });

  // These are server-owned: the client may send them, but they are never trusted.
  const patch = { ...(req.body || {}) };
  delete patch.id;
  delete patch.who;
  delete patch.notes;

  // Reject the whole patch rather than applying it partially — a partial save
  // looks identical to a successful one from the UI.
  const { allowed, denied } = auth.filterEditable(req.actor, patch);
  if (denied.length) {
    return res.status(403).json({ error: 'not allowed to change: ' + denied.join(', ') });
  }

  const who = (getUsers().find(u => u.id === req.user.userId) || {}).name || 'Unknown';

  // Postgres first, per the "webhooks/APIs store to Supabase first, then
  // JSON" requirement -- a targeted update to just the affected tables --
  // then the same deep-merge into the JSON backup both PATCH routes share.
  // Snapshot before the write, so the log can say what actually changed rather
  // than just what was submitted.
  const before = await dealProd.readOneProdRecord(req.params.id).catch(() => null);

  await dealProd.patchProdRecord(req.params.id, { ...allowed }, who);
  const lead = await applyProdPatchToJson(req.params.id, allowed, who);

  try {
    store.appendAudit(audit.entriesFor(allowed, before, { who, clientId: req.params.id }));
  } catch (e) { console.error('Audit write failed (the edit still saved):', e.message); }
  // The composed roster is cached for speed; an edit is exactly what makes it
  // stale. Without this, a stage change looked ignored for up to a minute.
  store.clearCacheKey('roster:composed');
  // Rounds attached on the way out: changing the package changes the round
  // allowance, and the drawer has no way to recompute that itself.
  res.json({ ok: true, client: lead ? rounds.attach([lead])[0] : lead });
});

// Only listen when run directly, so tests can mount the app on a free port.
// Restore config, the MFSN member list, AND the payment/dispute/sms event
// log from Postgres first (see store.hydrateConfigFromPostgres /
// hydrateMfsnFromPostgres / hydrateEventsFromPostgres -- matters on hosts
// with no persistent disk, where all three JSON files are wiped on every
// restart); never block boot on any of them failing/hanging.
if (require.main === module) {
  bootstrap().finally(() => {
    app.listen(PORT, () => console.log(`MSFS Command Center running on port ${PORT} (${liveMode() ? 'LIVE' : 'DEMO'} mode)`));
  });
}

// Everything that has to happen before the first request, in dependency
// order. Nothing here may reject: this host has no persistent disk, so a
// failed restore is a bad day, but a failed BOOT is an outage.
async function bootstrap() {
  // 1. Schema first -- the user-scoped stores can't be read back until their
  //    tables exist (additive and idempotent, see lib/migrate.js).
  await migrate.run().catch(e => console.error('Schema catch-up failed:', e.message));

  // 2. Restore everything that Postgres is the durable copy of.
  await Promise.all([
    store.hydrateConfigFromPostgres(),
    store.hydrateMfsnFromPostgres(),
    store.hydrateEventsFromPostgres(),
    store.hydrateTasksFromPostgres(),
    store.hydrateTaskNotesFromPostgres(),
    store.hydrateNotesFromPostgres(),
    store.hydrateWorkedFromPostgres(),
    store.hydrateAffiliateOverridesFromPostgres(),
    store.hydrateAuditFromPostgres()
  ]).catch(e => console.error('Postgres hydration failed:', e.message));

  // 3. Accounts, then the three stores that key off a real users.id. Ordered
  //    rather than parallel: the mirror is what makes those ids resolvable.
  // Users first: mirrorUsers pushes the LOCAL list to Postgres, so restoring
  // after it would mirror the freshly-wiped list over the good copy.
  await store.hydrateUsersFromPostgres().catch(e => console.error('User restore failed:', e.message));
  await store.mirrorUsers(getUsers())
    .then(() => Promise.all([
      store.hydrateNotificationsFromPostgres(),
      store.hydrateTicketViewsFromPostgres(),
      store.hydrateDashboardLayoutsFromPostgres()
    ]))
    .catch(e => console.error('User-scoped hydration failed:', e.message));

  // 4. Put logins back. Without this every deploy and every idle spin-down
  //    signs everyone out, and a logged-out browser looks exactly like a
  //    broken app: the dashboard's fetches 401 and the page renders empty.
  try {
    const restored = await store.hydrateSessionsFromPostgres();
    for (const [token, s] of Object.entries(restored || {})) sessions.restore(token, s);
  } catch (e) { console.error('Session restore failed:', e.message); }

  // 5. Top the event log up with the real Commas sale history (idempotent by
  //    payment id -- see store.seedCommasPayments).
  try { store.seedCommasPayments(); } catch (e) { console.error('Commas seed failed:', e.message); }
}

module.exports = app;
module.exports.MFSN_MEMBERS = MFSN_MEMBERS;
module.exports.mfsnIncomeSeries = mfsnIncomeSeries;
module.exports.incomeByMonth = incomeByMonth;
module.exports.commasIncomeForRange = commasIncomeForRange;
module.exports.COMMAS_MONTHLY_REVENUE = COMMAS_MONTHLY_REVENUE;
module.exports.COMMAS_HISTORY_THROUGH = COMMAS_HISTORY_THROUGH;
module.exports.MFSN_MONTHLY_INCOME = MFSN_MONTHLY_INCOME;
