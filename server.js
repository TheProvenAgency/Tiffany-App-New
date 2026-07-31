// Ms. Financial Solutions — Business Command Center
// GHL (clients, pipeline, SMS) + Fanbasis (payments via webhook/GHL sync)
// + DisputeFox (rounds via GHL tags + webhook) + Meta (IG/FB followers)
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const store = require('./lib/store');
const auth = require('./lib/auth');
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

// Merges the historical Commas snapshot with any live Fanbasis payment
// events that carry a `product` field (real sales since the webhook secret
// got fixed on 2026-07-30) so the card grows on its own from here.
function getProductBreakdownAllTime(allPayments) {
  const m = {};
  for (const h of HISTORICAL_PRODUCT_SALES) m[h.key] = { count: h.count, revenue: h.revenue };
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
  try {
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions.serialize()));
  } catch (e) { /* sessions survive in memory even if the disk is read-only */ }
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
  store.setConfig({ users });
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
  const open = req.path.startsWith('/webhooks/') || req.path === '/api/login' || req.path === '/api/sso'
    || req.path === '/login.html' || req.path === '/favicon.ico'
    || req.path === '/set-password.html' || req.path === '/api/set-password';
  if (open) return next();

  const session = sessions.resolve(cookieToken(req));
  if (!session) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
    return res.sendFile(path.join(__dirname, 'public', 'login.html'));
  }
  req.user = session;

  const permitted = req.path.startsWith('/api/')
    ? auth.canAccess(session.role, req.method, req.path)
    : auth.canAccessAsset(session.role, req.path);
  if (!permitted) return res.status(403).json({ error: 'forbidden' });
  next();
});

app.get('/api/me', (req, res) => {
  const u = getUsers().find(x => x.id === req.user.userId);
  res.json({ id: req.user.userId, name: u ? u.name : 'User', username: u ? u.username : null, role: req.user.role, viaSso: !!req.user.viaSso });
});

// user management (admin only — employees are blocked by canAccess)
app.get('/api/users', (req, res) => {
  res.json(getUsers().map(u => ({ id: u.id, username: u.username, name: u.name, role: u.role, disabled: !!u.disabled, mustSetPassword: !!u.mustSetPassword })));
});

// password is optional -- leave it out and the account is created with
// mustSetPassword:true plus a returned one-time setupLink instead, so the
// admin never has to invent (and relay) a temporary password. Still accepts
// an explicit password too, for anyone who'd rather just set one directly.
app.post('/api/users', (req, res) => {
  const { username, name, role, password } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username required' });
  if (role !== 'admin' && role !== 'employee') return res.status(400).json({ error: 'role must be admin or employee' });
  const list = getUsers();
  if (list.some(u => u.username === username)) return res.status(409).json({ error: 'username already taken' });
  const user = auth.makeUser({ username, name, role, password });
  store.setConfig({ users: list.concat([user]) });
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
  if (req.body.role === 'admin' || req.body.role === 'employee') u.role = req.body.role;
  if (typeof req.body.disabled === 'boolean') u.disabled = req.body.disabled;
  if (req.body.password) { Object.assign(u, auth.hashPassword(req.body.password)); u.mustSetPassword = false; }
  // Revoking access must take effect immediately, not at cookie expiry.
  if (u.disabled || req.body.password || req.body.role) { sessions.destroyForUser(u.id); persistSessions(); }
  store.setConfig({ users: list });
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
  store.setConfig({ users: list });
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
  store.setConfig({ users: list });
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
  store.setConfig({ users: list.filter(x => x.id !== req.params.id) });
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

app.use(express.static(path.join(__dirname, 'public')));

// ------------------------- read-only guard -------------------------
// Set READ_ONLY=1 when developing against Tiffany's real GoHighLevel keys.
// Only two routes can change anything there: status write-back (which edits
// tags on a real contact) and sending an SMS (which texts a real client).
//
// The refusal is deliberately loud. Returning a fake success would leave you
// believing a tag changed when it did not.
const READ_ONLY = process.env.READ_ONLY === '1' || process.env.READ_ONLY === 'true';
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
        activeByDeal: by(active, c => c.deal),
        churnRecency: Object.entries(churnBuckets).map(([key, count]) => ({ key, count }))
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
    if (deal) list = list.filter(c => c.deal === deal);
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
    res.json({ total: list.length, page: p, pageSize: ps, clients: list.slice((p - 1) * ps, p * ps) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ------------------------- client detail + management -------------------------
app.get('/api/clients/:id', async (req, res) => {
  try {
    const clients = withAffiliateTags(await getClients());
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
    if (READ_ONLY && liveMode()) return refuseWrite(res, 'setStatus', `${req.params.id} -> ${status}`);
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
    if (READ_ONLY && liveMode()) return refuseWrite(res, 'setTags', `${req.params.id} +[${add}] -[${remove}]`);
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

// send SMS via GHL (live mode only)
app.post('/api/clients/:id/sms', async (req, res) => {
  try {
    const message = (req.body.message || '').trim();
    if (!message) return res.status(400).json({ error: 'empty message' });
    if (READ_ONLY && liveMode()) return refuseWrite(res, 'sendSMS', `${req.params.id} (${message.length} chars)`);
    if (!liveMode()) return res.json({ ok: true, demo: true, note: 'Demo mode — no SMS actually sent. Connect GHL to enable.' });
    const r = await ghl.sendSMS(store.getConfig(), req.params.id, message);
    store.addEvent({ type: 'sms_out', at: new Date().toISOString(), clientId: req.params.id });
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
    if (READ_ONLY && liveMode()) return refuseWrite(res, 'createClient', `${name} (${email || phone})`);

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
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
  const layout = req.body && req.body.layout;
  if (!layout || !Array.isArray(layout.nodes)) return res.status(400).json({ error: 'layout.nodes (array) is required' });
  store.setDefaultDashboardLayout(layout);
  res.json({ ok: true });
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
  // Let the user paste the whole sub-account URL into the Location ID field.
  if (patch.ghlLocationId) patch.ghlLocationId = ghlcreds.extractLocationId(patch.ghlLocationId);
  store.setConfig(patch);
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

  const prod = readProd() || [];
  const already = prod.some(c => c.ghlId === contact.id
    || (ev.email && c.email && c.email.toLowerCase() === ev.email.toLowerCase()));
  if (!already) {
    const rec = makeProdRecordFromGhl(contact);
    rec.stage = 'Onboarding'; // a brand-new payer always starts here, regardless of any stale round/deal tag
    rec.notes = [{
      when: new Date().toISOString().slice(0, 10), who: 'System',
      text: `Auto-added from a Commas/Fanbasis payment ($${ev.amount}${ev.product ? ' · ' + ev.product : ''}) — verify package, stage, and documents.`
    }];
    writeProd(prod.concat([rec]));
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
  if (liveMode() && !READ_ONLY && (ev.email || ev.phone)) {
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
const PROD_FILE = path.join(process.env.DATA_DIR || __dirname, 'production.json');
// Held outside public/ on purpose: 3,578 real client records must not be
// downloadable from a browser.
const PROD_SEED = path.join(__dirname, 'seed', 'production-seed.json');

function readProd() {
  try { return JSON.parse(fs.readFileSync(PROD_FILE, 'utf8')); } catch (e) { /* fall through to seed */ }

  // First run on a fresh disk. Without this the tracker comes up empty and
  // looks broken rather than new.
  try {
    const seed = JSON.parse(fs.readFileSync(PROD_SEED, 'utf8'));
    if (!Array.isArray(seed)) return null;
    writeProd(seed);
    console.log(`Seeded Deal Production with ${seed.length} clients`);
    return seed;
  } catch (e) { return null; }
}
function writeProd(d) { try { fs.writeFileSync(PROD_FILE, JSON.stringify(d)); return true; } catch (e) { return false; } }
// Which clients are on MyFreeScoreNow under her affiliate link
// ("affiliate"), on MyFreeScoreNow but not under her link ("notAffiliate"
// -- the group worth reaching out to), or not on MyFreeScoreNow at all
// ("notOnMfsn"). Admin-only (not in the employee allowlist, so denied by
// default).
app.get('/api/affiliate-gap', async (req, res) => {
  try {
    const clients = await getClients();
    const gap = affiliate.affiliateGap(clients, store.getMfsnMembers(), store.getAffiliateOverrides());
    const brief = c => ({ id: c.id, name: c.name, email: c.email || null, phone: c.phone || null });
    res.json({
      counts: gap.counts,
      revenue: gap.revenue, // $ figures per box, see lib/affiliate.js affiliateGap()
      notAffiliate: gap.notAffiliate.map(brief), // on MFSN, not under her link
      notOnMfsn: gap.notOnMfsn.map(brief), // no match on MFSN at all
      prospects: gap.prospects, // [{email, name}] on MFSN, matching no GHL contact by email or name
      syncedAt: store.getMfsnSyncedAt(),
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
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
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
app.get('/api/mfsn-gap', (req, res) => {
  try {
    const clients = readProd() || [];
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

app.get('/api/production', (req, res) => { res.json({ clients: withMfsnTags(readProd()), mode: liveMode() ? 'live' : 'demo' }); });

// One lead, for an open drawer to poll cheaply instead of pulling all 3,578.
app.get('/api/production/:id', (req, res) => {
  const list = readProd();
  const lead = Array.isArray(list) ? list.find(c => c.id === req.params.id) : null;
  if (!lead) return res.status(404).json({ error: 'no such lead' });
  const [tagged] = Array.isArray(list) ? withMfsnTags([lead]) : [lead];
  // Stable shape: a never-edited lead still reports updatedAt, so pollers can
  // rely on the field existing.
  res.json({ client: { updatedAt: null, updatedBy: null, ...tagged } });
});
app.post('/api/production', (req, res) => {
  const c = req.body && req.body.clients;
  if (!Array.isArray(c)) return res.status(400).json({ error: 'clients array required' });
  writeProd(c);
  res.json({ ok: true, count: c.length });
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
    const prod = readProd() || [];
    const { updates, toCreate, unmatched, duplicateNames } = sheet.reconcileSheet(sheetRows, clients, prod);

    if (apply) {
      const byId = new Map(prod.map(c => [c.id, c]));
      for (const u of updates) {
        const rec = byId.get(u.id);
        if (!rec) continue;
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
      writeProd(prod.concat(created));
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

app.post('/api/production/reconcile', async (req, res) => {
  try {
    const clients = await getClients();
    const prod = readProd() || [];
    const { toAdd, notInGhl } = affiliate.reconcileProduction(clients, prod);
    const newRecords = toAdd.map(makeProdRecordFromGhl);
    if (newRecords.length) writeProd(prod.concat(newRecords));
    res.json({
      ok: true,
      addedCount: newRecords.length,
      added: newRecords.map(r => ({ id: r.id, name: r.name, email: r.email })),
      notInGhlCount: notInGhl.length,
      notInGhl: notInGhl.map(c => ({ id: c.id, name: c.name }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update one lead. The UI used to POST all 3,578 records on every keystroke,
// so whoever saved last silently erased everyone else's work. Patching a single
// record means two people on different leads never collide.
//
// readProd/writeProd are synchronous, so this read-modify-write cannot be
// interleaved by another request. No lock is needed.
app.patch('/api/production/:id', (req, res) => {
  const list = readProd();
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
  const { allowed, denied } = auth.filterEditable(req.user.role, patch);
  if (denied.length) {
    return res.status(403).json({ error: 'not allowed to change: ' + denied.join(', ') });
  }

  const note = allowed.note;
  delete allowed.note;

  // Deep-merge the sub-objects so a partial patch (one document, one round
  // field) does not replace the whole object and undo a colleague's edit.
  const lead = { ...list[idx] };
  for (const k of Object.keys(allowed)) {
    if (['tu', 'eq', 'ex', 'docs'].includes(k) && allowed[k] && typeof allowed[k] === 'object') {
      lead[k] = { ...(lead[k] || {}), ...allowed[k] };
    } else {
      lead[k] = allowed[k];
    }
  }
  if (note && String(note).trim()) {
    const me = getUsers().find(u => u.id === req.user.userId);
    lead.notes = (lead.notes || []).concat([{
      when: new Date().toISOString().slice(0, 10),
      who: me ? me.name : 'Unknown',
      text: String(note).trim()
    }]);
  }

  // A monotonic stamp so an open drawer elsewhere can tell the lead moved.
  lead.updatedAt = new Date().toISOString();
  lead.updatedBy = (getUsers().find(u => u.id === req.user.userId) || {}).name || null;
  list[idx] = lead;
  writeProd(list);
  res.json({ ok: true, client: lead });
});

// Only listen when run directly, so tests can mount the app on a free port.
if (require.main === module) {
  app.listen(PORT, () => console.log(`MSFS Command Center running on port ${PORT} (${liveMode() ? 'LIVE' : 'DEMO'} mode)`));
}

module.exports = app;
