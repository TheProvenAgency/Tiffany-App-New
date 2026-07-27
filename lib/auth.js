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

function makeUser({ username, name, role, password }) {
  return {
    id: crypto.randomUUID(),
    username,
    name: name || username,
    role,
    ...hashPassword(password),
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
  { method: 'POST', pattern: /^\/api\/support-tickets$/ }
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
  '/', '/index.html', '/production.js', '/role.js', '/logo.png', '/login.html', '/favicon.ico'
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
// ownership, so both stay with the admin.
//
// `note` (append one) rather than `notes` (rewrite the array): a writable
// notes array would let one employee delete or forge a colleague's note,
// which makes server-side attribution meaningless.
const EMPLOYEE_FIELDS = new Set(['tu', 'eq', 'ex', 'docs', 'note']);

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

module.exports = {
  hashPassword, verifyPassword, makeUser, ensureAdmin, authenticate,
  createSessions, canAccess, canAccessAsset, filterEditable,
  verifySsoToken, findOrCreateSsoUser,
  EMPLOYEE_FIELDS
};
