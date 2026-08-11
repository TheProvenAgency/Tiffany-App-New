// Accounts, sessions and the role permission boundary.
//
// The rule that matters: a role the client holds is a role the client can
// forge. Session tokens here are random and opaque; the role is looked up
// server-side and never travels in the cookie.
const crypto = require('crypto');

const KEYLEN = 64;

// ------------------------- passwords -------------------------

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, KEYLEN).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, cred) {
  if (!cred || !cred.hash || !cred.salt) return false;
  const attempt = crypto.scryptSync(String(password), cred.salt, KEYLEN);
  const stored = Buffer.from(cred.hash, 'hex');
  if (attempt.length !== stored.length) return false;
  return crypto.timingSafeEqual(attempt, stored);
}

// ------------------------- accounts -------------------------

// password is optional now: an admin can add someone without inventing a
// temporary password. When omitted, the account gets an unguessable random
// password (never surfaced) plus mustSetPassword:true, and the caller is
// expected to hand the person a signed setup link (see signAppToken /
// POST /api/users/:id/invite in server.js) so they set their own on first
// login instead.
function makeUser({ username, name, role, password }) {
  const hasPassword = password != null && password !== '';
  return {
    id: crypto.randomUUID(),
    username,
    name: name || username,
    role,
    ...hashPassword(hasPassword ? password : crypto.randomBytes(32).toString('hex')),
    mustSetPassword: !hasPassword,
    disabled: false,
    createdAt: new Date().toISOString()
  };
}

// Migration: the app previously had one shared password. Turn it into an admin
// account so the current password keeps working and nobody is locked out.
function ensureAdmin(users, legacyPassword) {
  const list = Array.isArray(users) ? users.slice() : [];
  if (list.some(u => u.role === 'admin')) return list;
  list.push(makeUser({ username: 'admin', name: 'Admin', role: 'admin', password: legacyPassword }));
  return list;
}

function authenticate(users, username, password) {
  const u = (users || []).find(x => x.username === username);
  // ssoOnly accounts (provisioned by /api/sso for a Proven Agency admin) never
  // authenticate through the password form -- only a validly-signed SSO
  // token can start a session for them, no matter what their random,
  // never-surfaced password happens to be.
  if (!u || u.disabled || u.ssoOnly) return null;
  return verifyPassword(password, u) ? u : null;
}

// ------------------------- sessions -------------------------

const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // matches the cookie Max-Age

function createSessions(initial, opts) {
  const maxAgeMs = (opts && opts.maxAgeMs) || DEFAULT_MAX_AGE_MS;
  const map = new Map(Object.entries(initial || {}));
  const expired = s => !s || (Date.now() - (s.createdAt || 0)) > maxAgeMs;
  // Drop anything already past its life when the store loads from disk.
  for (const [token, s] of map) if (expired(s)) map.delete(token);
  return {
    create(user, extra) {
      const token = crypto.randomBytes(32).toString('hex');
      map.set(token, { userId: user.id, role: user.role, createdAt: Date.now(), ...(extra || {}) });
      return token;
    },
    resolve(token) {
      if (!token) return null;
      const s = map.get(token);
      if (!s) return null;
      if (expired(s)) { map.delete(token); return null; } // a leaked token must not live past 30 days
      return s;
    },
    destroy(token) { map.delete(token); },
    destroyForUser(userId) {
      for (const [token, s] of map) if (s.userId === userId) map.delete(token);
    },
    // Admin-only "View as Employee" preview: flips what a session's requests
    // are gated as (see req.effectiveRole in server.js) without touching the
    // account's real role. previewRole=null clears it. Returns false if the
    // token has no live session (already logged out / expired), so the
    // caller can tell the difference from a no-op success.
    setPreview(token, previewRole) {
      const s = map.get(token);
      if (!s) return false;
      if (previewRole) s.previewRole = previewRole; else delete s.previewRole;
      return true;
    },
    // Re-admit a session persisted by a previous process. Goes through the
    // same expiry check as resolve() rather than writing to the map blindly,
    // so a restart can't resurrect a token that had already aged out.
    restore(token, s) {
      if (!token || expired(s)) return false;
      map.set(token, s);
      return true;
    },
    serialize() { return Object.fromEntries(map); }
  };
}

// ------------------------- SSO (Proven Agency admin link-out) -------------------------

// Verifies a short-lived, HMAC-signed token minted by the Proven Agency
// dashboard's /api/link-out route so an admin there never has to log in here
// too. Token shape: base64url(JSON payload) + "." + hex HMAC-SHA256 of that
// base64url string, keyed by a secret known only to both backends
// (SSO_SHARED_SECRET) and never sent to a browser. Returns the decoded
// payload ({ slug, email, name, exp }) on success, null on anything wrong --
// bad signature, expired, malformed, or no secret configured (fail closed).
function verifySsoToken(token, secret) {
  if (!token || !secret) return null;
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;

  const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
  let a, b;
  try { a = Buffer.from(signature, 'hex'); b = Buffer.from(expected, 'hex'); }
  catch (e) { return null; }
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try { payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')); }
  catch (e) { return null; }
  if (!payload || typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
  if (!payload.email) return null;
  return payload;
}

// Matched by email -- the one stable identifier the Proven Agency side has
// for its admins -- so the same person SSOing in twice reuses one account
// instead of minting a new one each time, and everything they do here (e.g.
// a Deal Production note) is consistently attributed to them, not a generic
// "SSO" bucket. New accounts are admin role, ssoOnly (see authenticate()),
// with a random 32-byte password nobody ever sees or needs.
function findOrCreateSsoUser(users, payload) {
  const username = String(payload.email).toLowerCase();
  const list = Array.isArray(users) ? users.slice() : [];
  const existing = list.find(u => u.username === username);
  if (existing) return { users: list, user: existing };
  const user = makeUser({ username, name: payload.name || username, role: 'admin', password: crypto.randomBytes(32).toString('hex') });
  user.ssoOnly = true;
  list.push(user);
  return { users: list, user };
}

// ------------------------- setup / reset links -------------------------
//
// Same signed-token shape as verifySsoToken above (base64url(JSON) + "." +
// hex HMAC-SHA256, expiring, fails closed with no secret), generalized to
// carry any payload instead of only an SSO email handshake. Used for "set
// your password" links: an admin adds someone with no password, or clicks
// Reset password for an existing person, and this signs a short-lived
// {userId, exp} token instead of anyone inventing a temporary password
// that then has to be relayed and immediately changed. The app has no
// outbound email today, so the admin copies the resulting link and sends
// it however they'd normally reach that person (text, Slack, in person).

function signAppToken(payload, secret) {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
  return payloadB64 + '.' + signature;
}

function verifyAppToken(token, secret) {
  if (!token || !secret) return null;
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;

  const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
  let a, b;
  try { a = Buffer.from(signature, 'hex'); b = Buffer.from(expected, 'hex'); }
  catch (e) { return null; }
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try { payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')); }
  catch (e) { return null; }
  if (!payload || typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
  return payload;
}

// ------------------------- capabilities -------------------------

// Permissions are per-feature, not per-role. A role is only a named preset of
// capabilities; the gate always checks the capability. Roles stayed as the
// thing you assign day-to-day because "make this person a VA" is the actual
// decision being made -- but a user row may carry an explicit `capabilities`
// array, which wins over the preset and lets one person get an unusual mix
// without inventing a new role for them.
const CAPABILITIES = [
  'production',  // Deal Production work desk
  'messages',    // unified SMS/Email/FB/IG inbox
  'disputes',    // dispute round queue + per-client bureau record
  'clients',     // client list/drawer (GHL-backed)
  'pipeline',    // revenue-by-round board
  'followups',   // shared task list
  'tickets',     // support tickets to Proven Agency
  'revenue',     // every money surface: dashboard KPIs, revenue view, affiliate $
  'assign',      // reassign a client's owner -- desk-manager work, see ASSIGN_FIELDS
  'admin'        // settings, API keys, user management
];

// `employee` is the legacy role every existing account carries. Its preset is
// exactly the surface employees already had before capabilities existed, so
// nobody's access changes on the deploy that introduces this.
const ROLE_CAPS = {
  admin: CAPABILITIES.slice(),
  employee: ['production', 'messages', 'clients', 'pipeline', 'followups', 'tickets', 'assign'],
  // VAs run the client-facing desk: the full Deal Production tracker and the
  // inbox. No money surfaces -- explicit requirement.
  va: ['production', 'messages', 'clients', 'followups', 'tickets', 'assign'],
  // Disputers only work the round queue and the bureau record behind it.
  // Deliberately narrow: no Deal Production, no inbox, no pipeline, no money.
  disputer: ['disputes', 'tickets']
};

// Accepts a bare role string (how the gate and every existing test call it) or
// a user/session object. An unrecognised role resolves to nothing rather than
// to everything -- same deny-by-default direction as the route table.
function capsFor(actor) {
  if (!actor) return new Set();
  if (typeof actor === 'string') return new Set(ROLE_CAPS[actor] || []);
  if (Array.isArray(actor.capabilities)) return new Set(actor.capabilities);
  return new Set(ROLE_CAPS[actor.role] || []);
}

function has(actor, cap) {
  const caps = capsFor(actor);
  return caps.has('admin') || caps.has(cap);
}

// ------------------------- API permission boundary -------------------------

// Routes every signed-in person reaches no matter which capabilities they
// hold: their own identity, their own password, their own notification bell,
// their own dashboard layout, and the user directory that an @mention
// autocomplete or assignee dropdown needs to resolve names. None of these
// expose anything about the business -- only about the caller themselves.
const SELF_API = [
  { method: 'GET', pattern: /^\/api\/me$/ },
  { method: 'POST', pattern: /^\/api\/logout$/ },
  { method: 'POST', pattern: /^\/api\/me\/password$/ },
  { method: 'GET', pattern: /^\/api\/notifications$/ },
  { method: 'POST', pattern: /^\/api\/notifications\/[^/]+\/read$/ },
  { method: 'POST', pattern: /^\/api\/notifications\/read-all$/ },
  // Own layout only -- POST /api/dashboard-layout/default changes what
  // everyone without an override sees, so it stays admin-only (and is also
  // re-checked inside the route handler).
  { method: 'GET', pattern: /^\/api\/dashboard-layout$/ },
  { method: 'POST', pattern: /^\/api\/dashboard-layout$/ },
  { method: 'DELETE', pattern: /^\/api\/dashboard-layout$/ },
  // Read-only directory (id/username/name/role/disabled -- no hashes, see
  // GET /api/users in server.js). User *management* is admin-only.
  { method: 'GET', pattern: /^\/api\/users$/ }
];

// Deny by default. A route with no rule here is closed to everyone but admin,
// so anything added later is shut until someone deliberately opens it.
const ROUTE_CAPS = [
  { cap: 'production', method: 'GET', pattern: /^\/api\/production$/ },
  { cap: 'production', method: 'GET', pattern: /^\/api\/production\/[^/]+$/ },
  { cap: 'production', method: 'PATCH', pattern: /^\/api\/production\/[^/]+$/ },

  // The onboarding SLA queue is a projection over the same Deal Production
  // feed, so it rides the same capability -- a VA runs onboarding.
  { cap: 'production', method: 'GET', pattern: /^\/api\/onboarding$/ },

  // The dispute desk. Its own routes rather than a filtered view of Deal
  // Production: a disputer needs the bureau/round record and nothing else on
  // that row, and giving them /api/production would hand over the whole
  // tracker including fields they must not see or write.
  { cap: 'disputes', method: 'GET', pattern: /^\/api\/disputes\/queue$/ },
  { cap: 'disputes', method: 'GET', pattern: /^\/api\/disputes\/[^/]+$/ },
  { cap: 'disputes', method: 'PATCH', pattern: /^\/api\/disputes\/[^/]+$/ },

  // Both roles can flag something for Proven Agency to work on, see the
  // shared team queue of everything submitted, and reply inside a thread.
  { cap: 'tickets', method: 'POST', pattern: /^\/api\/support-tickets$/ },
  { cap: 'tickets', method: 'GET', pattern: /^\/api\/support-tickets$/ },
  { cap: 'tickets', method: 'POST', pattern: /^\/api\/support-tickets\/[^/]+\/notes$/ },
  { cap: 'tickets', method: 'POST', pattern: /^\/api\/support-tickets\/[^/]+\/view$/ },

  // Follow-Ups is a shared team to-do list, not scoped per user -- same
  // spirit as the support-ticket queue above. Notes on a task are a thread
  // anyone can add to and @mention in.
  { cap: 'followups', method: 'GET', pattern: /^\/api\/tasks$/ },
  { cap: 'followups', method: 'POST', pattern: /^\/api\/tasks$/ },
  { cap: 'followups', method: 'PATCH', pattern: /^\/api\/tasks\/[^/]+$/ },
  { cap: 'followups', method: 'DELETE', pattern: /^\/api\/tasks\/[^/]+$/ },
  { cap: 'followups', method: 'GET', pattern: /^\/api\/tasks\/[^/]+\/notes$/ },
  { cap: 'followups', method: 'POST', pattern: /^\/api\/tasks\/[^/]+\/notes$/ },
  { cap: 'followups', method: 'DELETE', pattern: /^\/api\/task-notes\/[^/]+$/ },

  // The unified inbox (SMS/Email/FB/IG via GHL Conversations). Replying is
  // open alongside reading -- routine client contact, not configuration.
  { cap: 'messages', method: 'GET', pattern: /^\/api\/messages$/ },

  // Who is still waiting on a reply. A projection over the same conversation
  // feed, so it rides the same capability.
  { cap: 'messages', method: 'GET', pattern: /^\/api\/replies-due$/ },
  { cap: 'messages', method: 'GET', pattern: /^\/api\/messages\/[^/]+$/ },
  { cap: 'messages', method: 'POST', pattern: /^\/api\/messages\/[^/]+\/reply$/ },

  // Clients. mfsnCommission is redacted from these routes for anyone without
  // the revenue capability (see redactClient below) regardless of this rule.
  // Contact edit and the generic tags route stay admin-only -- everything
  // else on this record (status, affiliate override, SMS, notes) was opened
  // to employees on 2026-08-05 at explicit request for parity with Admin's
  // own drawer.
  { cap: 'clients', method: 'GET', pattern: /^\/api\/clients$/ },
  { cap: 'clients', method: 'GET', pattern: /^\/api\/clients\/[^/]+$/ },
  { cap: 'clients', method: 'POST', pattern: /^\/api\/clients\/[^/]+\/notes$/ },
  { cap: 'clients', method: 'POST', pattern: /^\/api\/clients\/[^/]+\/status$/ },
  { cap: 'clients', method: 'POST', pattern: /^\/api\/clients\/[^/]+\/affiliate$/ },
  { cap: 'clients', method: 'POST', pattern: /^\/api\/clients\/[^/]+\/sms$/ },
  // Moving a client to a different round -- a narrow, dedicated tag swap
  // (see the route itself), not the generic /tags route which stays
  // admin-only.
  { cap: 'clients', method: 'POST', pattern: /^\/api\/clients\/[^/]+\/round$/ },

  // The Pipeline board (revenue by round, per-client total spent) -- opened
  // to Employees identical to Admin's own view, unredacted, on 2026-08-05.
  { cap: 'pipeline', method: 'GET', pattern: /^\/api\/pipeline$/ }
];

function canAccess(actor, method, path) {
  const caps = capsFor(actor);
  if (caps.has('admin')) return true;
  if (caps.size === 0) return false;
  if (SELF_API.some(r => r.method === method && r.pattern.test(path))) return true;
  return ROUTE_CAPS.some(r =>
    r.method === method && r.pattern.test(path) && caps.has(r.cap));
}

// ------------------------- static asset boundary -------------------------

// Gating the API is not enough: personal-finances.js carries balances in its
// own source, so the file itself is the data. Each view module is therefore
// tied to the capability it serves, not handed out with a blanket allowlist.
const ASSET_CAPS = {
  '/production.js': 'production',
  '/messages.js': 'messages',
  '/disputes.js': 'disputes',
  '/revenue.js': 'revenue',
  '/personal-finances.js': 'revenue',
  '/mfsn.js': 'revenue'
};

// The shell, the role script, branding, and the login page: needed by anyone
// who can sign in at all, and carry no business data themselves.
// team.js is here rather than behind 'admin' on purpose: role.js's gateNav()
// polls for the #teamNavBtn it injects before it can finish hiding nav items
// (HANDOFF.md §6). Denying the file makes every non-admin wait out that ~3s
// retry window on every load. The button it adds is hidden by role.js, and
// user *management* is admin-only at the API, so nothing leaks.
const COMMON_ASSETS = new Set([
  '/', '/index.html', '/role.js', '/team.js', '/logo.png', '/mfsn-logo.png',
  '/login.html', '/set-password.html', '/favicon.ico'
]);

function canAccessAsset(actor, path) {
  const caps = capsFor(actor);
  if (caps.has('admin')) return true;
  if (caps.size === 0) return false;
  if (COMMON_ASSETS.has(path)) return true;
  const needed = ASSET_CAPS[path];
  if (needed) return caps.has(needed);
  return path.endsWith('.css');
}

// ------------------------- field-level permissions -------------------------

// Which keys of a Deal Production PATCH each capability may write.
//
// `note` (append one) rather than `notes` (rewrite the array): a writable
// notes array would let one person delete or forge a colleague's note, which
// makes server-side attribution meaningless.
//
// `va` (ownership reassignment) stays admin-only under every preset.
//
// `stage` was admin-only until 2026-08-05, when moving a client between
// stages/columns from the Pipeline detail panel was explicitly opened.
const PRODUCTION_FIELDS = new Set(['tu', 'eq', 'ex', 'docs', 'note', 'cfpb', 'stage']);

// Reassigning ownership was admin-only on purpose. The team now needs a desk
// manager to assign a disputer per client without being made an admin, so it
// becomes its own capability rather than being folded into `production` --
// which would have quietly handed reassignment to every employee at once.
// As a named capability it can also be unticked per person in the Team form.
const ASSIGN_FIELDS = new Set(['va']);

// A disputer touches the three bureau columns, the round's CFPB login, and
// can append a note -- the record of the dispute work itself. Not `stage`
// (that's the Deal Production pipeline position, someone else's job) and not
// `docs` (the onboarding document checklist, likewise).
const DISPUTE_FIELDS = new Set(['tu', 'eq', 'ex', 'cfpb', 'note']);

// Kept as a named export because tests and older call sites refer to it.
const EMPLOYEE_FIELDS = PRODUCTION_FIELDS;

function filterEditable(actor, patch) {
  const keys = Object.keys(patch || {});
  const caps = capsFor(actor);
  if (caps.has('admin')) return { allowed: { ...patch }, denied: [] };
  const writable = new Set();
  if (caps.has('production')) for (const f of PRODUCTION_FIELDS) writable.add(f);
  if (caps.has('disputes')) for (const f of DISPUTE_FIELDS) writable.add(f);
  if (caps.has('assign')) for (const f of ASSIGN_FIELDS) writable.add(f);
  const allowed = {};
  const denied = [];
  for (const k of keys) {
    if (writable.has(k)) allowed[k] = patch[k];
    else denied.push(k);
  }
  return { allowed, denied };
}

// A client record mixes money in with the operational fields (name, contact,
// package, status, round, notes, MFSN affiliate status) that the work desk
// legitimately needs. Strip it here, server-side, rather than trusting the
// browser not to render it -- same reasoning as ASSET_CAPS above.
//
// As of 2026-08-05, totalSpent/numberOfPayments/mfsnStatus/mfsnMatched/
// mfsnOverride are no longer redacted -- the Clients table shows Total
// Spent/# Pays to the work desk now, and the drawer's Mark affiliate/not
// action needs the current status to render correctly. What's left is
// mfsnCommission -- a literal dollar figure -- which the drawer deliberately
// never shows (its stat tiles and the Payment history list are gated
// client-side on `moneyVisible` instead, see openClient() in index.html):
// the explicit request that day was "actions, not numbers."
const MONEY_CLIENT_FIELDS = new Set(['mfsnCommission']);
function redactClient(actor, client) {
  if (!client) return client;
  if (has(actor, 'revenue')) return client;
  const out = { ...client };
  for (const k of MONEY_CLIENT_FIELDS) delete out[k];
  return out;
}

module.exports = {
  hashPassword, verifyPassword, makeUser, ensureAdmin, authenticate,
  createSessions, canAccess, canAccessAsset, filterEditable,
  verifySsoToken, findOrCreateSsoUser,
  signAppToken, verifyAppToken,
  redactClient,
  CAPABILITIES, ROLE_CAPS, capsFor, has,
  PRODUCTION_FIELDS, DISPUTE_FIELDS, ASSIGN_FIELDS,
  EMPLOYEE_FIELDS
};
