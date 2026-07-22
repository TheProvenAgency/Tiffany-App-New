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
  if (!u || u.disabled) return null;
  return verifyPassword(password, u) ? u : null;
}

// ------------------------- sessions -------------------------

function createSessions(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    create(user) {
      const token = crypto.randomBytes(32).toString('hex');
      map.set(token, { userId: user.id, role: user.role, createdAt: Date.now() });
      return token;
    },
    resolve(token) {
      if (!token) return null;
      return map.get(token) || null;
    },
    destroy(token) { map.delete(token); },
    destroyForUser(userId) {
      for (const [token, s] of map) if (s.userId === userId) map.delete(token);
    },
    serialize() { return Object.fromEntries(map); }
  };
}

// ------------------------- API permission boundary -------------------------

// Deny by default. An employee reaches only what is listed here, so any route
// added later is closed until someone deliberately opens it.
const EMPLOYEE_API = [
  { method: 'GET', pattern: /^\/api\/me$/ },
  { method: 'GET', pattern: /^\/api\/production$/ },
  { method: 'PATCH', pattern: /^\/api\/production\/[^/]+$/ },
  { method: 'POST', pattern: /^\/api\/logout$/ }
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
  EMPLOYEE_FIELDS
};
