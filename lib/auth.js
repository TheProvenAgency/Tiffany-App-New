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

// ------------------------- API permission boundary -------------------------

// Deny by default. An employee reaches only what is listed here, so any route
// added later is closed until someone deliberately opens it.
const EMPLOYEE_API = [
  { method: 'GET', pattern: /^\/api\/me$/ },
  { method: 'GET', pattern: /^\/api\/production$/ },
  { method: 'GET', pattern: /^\/api\/production\/[^/]+$/ },
  { method: 'PATCH', pattern: /^\/api\/production\/[^/]+$/ },
  { method: 'POST', pattern: /^\/api\/logout$/ },
  // Both roles can flag something for Proven Agency to work on -- see the
  // "Submit a Support Ticket" button in the Account nav (visible to
  // employees too, unlike Settings).
  { method: 'POST', pattern: /^\/api\/support-tickets$/ },
  // Both roles can also see the shared team queue of everything ever
  // submitted (synced live from Proven Agency's dashboard) and reply
  // inside a thread -- see the "Ticket Requests" nav item.
  { method: 'GET', pattern: /^\/api\/support-tickets$/ },
  { method: 'POST', pattern: /^\/api\/support-tickets\/[^/]+\/notes$/ },
  { method: 'POST', pattern: /^\/api\/support-tickets\/[^/]+\/view$/ },
  // Both roles can change their own password from an active session (a
  // dedicated "Change password" control, not the full admin Settings
  // panel) -- see POST /api/me/password in server.js. Current password is
  // required, so this doesn't widen what an employee can do beyond their
  // own account.
  { method: 'POST', pattern: /^\/api\/me\/password$/ },
  // Both roles can see and clear their own @mention / task-assignment bell —
  // read-only to their own userId (see GET /api/notifications in server.js),
  // so this doesn't open anything an employee couldn't already see about
  // themselves.
  { method: 'GET', pattern: /^\/api\/notifications$/ },
  { method: 'POST', pattern: /^\/api\/notifications\/[^/]+\/read$/ },
  { method: 'POST', pattern: /^\/api\/notifications\/read-all$/ },
  // Both roles can rearrange/resize their own Dashboard cards -- stored
  // per userId, so an employee can only ever read/write/clear their own
  // layout (see GET/POST/DELETE /api/dashboard-layout in server.js).
  // POST /api/dashboard-layout/default is deliberately NOT here -- that one
  // changes what everyone WITHOUT a personal override sees, so it's
  // admin-only (also enforced inside the route handler itself).
  { method: 'GET', pattern: /^\/api\/dashboard-layout$/ },
  { method: 'POST', pattern: /^\/api\/dashboard-layout$/ },
  { method: 'DELETE', pattern: /^\/api\/dashboard-layout$/ },
  // Both roles can use Follow-Ups -- a shared team to-do list, not scoped
  // per user, same spirit as the shared support-ticket queue above. Notes
  // on a task are a thread anyone can add to and @mention in, mirroring
  // support-ticket notes. (Briefly dropped from the Employee nav on
  // 2026-08-05, restored the same day -- Employees need it after all.)
  { method: 'GET', pattern: /^\/api\/tasks$/ },
  { method: 'POST', pattern: /^\/api\/tasks$/ },
  { method: 'PATCH', pattern: /^\/api\/tasks\/[^/]+$/ },
  { method: 'DELETE', pattern: /^\/api\/tasks\/[^/]+$/ },
  { method: 'GET', pattern: /^\/api\/tasks\/[^/]+\/notes$/ },
  { method: 'POST', pattern: /^\/api\/tasks\/[^/]+\/notes$/ },
  { method: 'DELETE', pattern: /^\/api\/task-notes\/[^/]+$/ },
  // Read-only directory of dashboard logins (id/username/name/role/
  // disabled/mustSetPassword -- no password hashes, see GET /api/users in
  // server.js) so an employee's assignee dropdown and @mention
  // autocomplete can actually resolve names. User *management*
  // (POST/PATCH/DELETE /api/users) stays admin-only.
  { method: 'GET', pattern: /^\/api\/users$/ },
  // Both roles can see the unified "All Messages" inbox (SMS/Email/FB/IG via
  // GHL Conversations) -- read-only, same day-to-day client-contact work as
  // Deal Production and Follow-Ups. Replying is open to both roles too, for
  // the same reason -- routine client contact, not admin configuration --
  // see POST /api/messages/:id/reply in server.js.
  { method: 'GET', pattern: /^\/api\/messages$/ },
  { method: 'GET', pattern: /^\/api\/messages\/[^/]+$/ },
  { method: 'POST', pattern: /^\/api\/messages\/[^/]+\/reply$/ },
  // Read-only Clients access for the Team Dashboard's "Clients" nav item.
  // Money fields (totalSpent, numberOfPayments, mfsn affiliate status) are
  // stripped server-side by redactClient() below before the response is
  // built, regardless of this allowlist -- this only controls whether the
  // (already-redacted) route is reachable at all. Every write on a client
  // (status, affiliate override, contact edit, tags, SMS, notes,
  // POST /api/clients itself) stays admin-only on purpose.
  { method: 'GET', pattern: /^\/api\/clients$/ },
  { method: 'GET', pattern: /^\/api\/clients\/[^/]+$/ },
  // The top-level Pipeline board (revenue by round, per-client total spent)
  // -- explicitly requested open to Employees identical to Admin's own view,
  // unredacted, on 2026-08-05. Read-only either way (no write route here).
  { method: 'GET', pattern: /^\/api\/pipeline$/ }
];

function canAccess(role, method, path) {
  if (role === 'admin') return true;
  if (role !== 'employee') return false;
  return EMPLOYEE_API.some(r => r.method === method && r.pattern.test(path));
}

// ------------------------- static asset boundary -------------------------

// Gating the API is not enough: personal-finances.js carries balances in its
// source, so the file itself is the data.
const EMPLOYEE_ASSETS = new Set([
  '/', '/index.html', '/production.js', '/role.js', '/messages.js', '/team.js', '/logo.png', '/mfsn-logo.png', '/login.html', '/favicon.ico'
]);

function canAccessAsset(role, path) {
  if (role === 'admin') return true;
  if (role !== 'employee') return false;
  if (EMPLOYEE_ASSETS.has(path)) return true;
  return path.endsWith('.css');
}

// ------------------------- field-level permissions -------------------------

// Employees run the work desk: dispute rounds, document checklists, and
// appending notes. stage moves a lead through the pipeline and va reassigns
// ownership, so both stay with the admin. cfpb (the per-round CFPB
// portal logins the team files complaints with) belongs here too -- it's
// the same day-to-day round work, not admin configuration.
//
// `note` (append one) rather than `notes` (rewrite the array): a writable
// notes array would let one employee delete or forge a colleague's note,
// which makes server-side attribution meaningless.
const EMPLOYEE_FIELDS = new Set(['tu', 'eq', 'ex', 'docs', 'note', 'cfpb']);

function filterEditable(role, patch) {
  const keys = Object.keys(patch || {});
  if (role === 'admin') return { allowed: { ...patch }, denied: [] };
  const allowed = {};
  const denied = [];
  for (const k of keys) {
    if (EMPLOYEE_FIELDS.has(k)) allowed[k] = patch[k];
    else denied.push(k);
  }
  return { allowed, denied };
}

// A client record mixes money (totalSpent, numberOfPayments, MFSN
// affiliate/commission status) in with the operational fields (name,
// contact, package, status, round, notes) an employee legitimately needs
// for the Team Dashboard's Clients view and client-detail drawer. Strip
// the money fields here, server-side, rather than trusting the client to
// not render them -- same reasoning as EMPLOYEE_ASSETS above.
const EMPLOYEE_HIDDEN_CLIENT_FIELDS = new Set(['totalSpent', 'numberOfPayments', 'mfsnStatus', 'mfsnMatched', 'mfsnOverride', 'mfsnCommission']);
function redactClient(role, client) {
  if (role === 'admin' || !client) return client;
  const out = { ...client };
  for (const k of EMPLOYEE_HIDDEN_CLIENT_FIELDS) delete out[k];
  return out;
}

module.exports = {
  hashPassword, verifyPassword, makeUser, ensureAdmin, authenticate,
  createSessions, canAccess, canAccessAsset, filterEditable,
  verifySsoToken, findOrCreateSsoUser,
  signAppToken, verifyAppToken,
  redactClient,
  EMPLOYEE_FIELDS
};
