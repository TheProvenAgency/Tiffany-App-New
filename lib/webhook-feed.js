// Real-time admin-only feed of inbound /webhooks/* POSTs -- lets Tiffany
// see in the UI whether an external service (Zapier, n8n, Commas) is
// actually hitting the app, without needing server log access. An
// operational signal, not a data store: capped in-memory ring buffer,
// wiped on restart, nothing written to disk or Postgres.
//
// ALLOWLIST, not blocklist, for what a payload is even permitted to show
// (Tiffany's explicit instruction, 2026-08-17): a blocklist leaks the
// moment a new sensitive field shows up in a payload nobody thought to add
// to it. Per source, only fields she has named as safe are ever read out
// of the body -- every other field is never captured, not merely hidden at
// render. A hard-blocked key-name pattern (password/token/secret/email/pw)
// is checked even against an allowlisted field, as a backstop against a
// future mis-added allowlist entry, not because any current entry needs it.
//
// Only /webhooks/sheet-sync has a confirmed-safe field list. Every other
// webhook (fanbasis, commas, disputefox, mfsn, sms) shows METADATA ONLY --
// source, timestamp, item count, status -- until its own safe-field list
// is confirmed. Guessing at which fields of an unconfirmed payload shape
// are safe is exactly the mistake this feature exists to prevent.

const MAX_ENTRIES = 50;
const buffer = []; // newest first
let seq = 0;

const HARD_BLOCK_KEY = /password|token|secret|email|pw/i;

const SHEET_SYNC_ALLOWLIST = [
  'NAME', 'PACKAGE', 'TU', 'EQ', 'EX', 'Member_List',
  'RND_1_DATE', 'RND_2_DATE', 'RND_3_DATE', 'RND_4_DATE', 'RND_5_DATE',
  'RND_6_DATE', 'RND_7_DATE', 'RND_8_DATE', 'RND_9_DATE', 'RND_10_DATE'
];

// Applied to every allowlist, always -- see the header comment on why this
// exists even though nothing currently on SHEET_SYNC_ALLOWLIST needs it.
function pickAllowlisted(item, allowlist) {
  const out = {};
  if (!item || typeof item !== 'object') return out;
  for (const k of allowlist) {
    if (HARD_BLOCK_KEY.test(k)) continue; // the backstop
    if (Object.prototype.hasOwnProperty.call(item, k)) out[k] = item[k];
  }
  return out;
}

// Sheet-sync's real request shape (verified against n8n's actual payload --
// see lib/sheet.js and the /webhooks/sheet-sync route): an array wrapping
// n8n's own trigger envelope, [{ body: [...items...] }]. The two fallbacks
// mirror the same tolerance the route itself has.
function extractSheetSyncItems(body) {
  if (Array.isArray(body) && body[0] && Array.isArray(body[0].body)) return body[0].body;
  if (body && Array.isArray(body.body)) return body.body;
  if (Array.isArray(body)) return body;
  return [];
}

// Item count only, never field content -- the one thing every unconfirmed
// webhook shape is allowed to expose, since "how many arrived" is a
// structural fact about the request, not payload content.
function genericItemCount(body) {
  if (Array.isArray(body)) return body.length;
  if (body && Array.isArray(body.members)) return body.members.length; // /webhooks/mfsn
  return null;
}

const SOURCE_LABELS = {
  '/fanbasis': 'Fanbasis', '/commas': 'Commas', '/disputefox': 'DisputeFox',
  '/mfsn': 'MFSN sync', '/sms': 'SMS', '/sheet-sync': 'Sheet Sync'
};

function buildDisplay(path, body) {
  if (path === '/sheet-sync') {
    const items = extractSheetSyncItems(body).map(item => pickAllowlisted(item, SHEET_SYNC_ALLOWLIST));
    return { itemCount: items.length, items };
  }
  // Every other source: metadata only, by design -- see header comment.
  return { itemCount: genericItemCount(body), items: null };
}

function summarize(path, display) {
  const label = SOURCE_LABELS[path] || path;
  return display.itemCount != null
    ? `${label} · ${display.itemCount} item${display.itemCount === 1 ? '' : 's'}`
    : `${label} · received`;
}

// path: req.path (e.g. '/sheet-sync'). body: the already-parsed request
// body -- read here, but never itself stored; only the allowlisted/counted
// derivative (`display`) enters the buffer.
function record(path, body) {
  const display = buildDisplay(path, body);
  const entry = {
    id: ++seq,
    path,
    receivedAt: new Date().toISOString(),
    status: null, // filled in by setStatus() once the response is sent
    display,
    summary: summarize(path, display)
  };
  buffer.unshift(entry);
  if (buffer.length > MAX_ENTRIES) buffer.length = MAX_ENTRIES;
  return entry;
}

function setStatus(id, status) {
  const e = buffer.find(x => x.id === id);
  if (e) e.status = status;
}

// Polling contract: entries strictly newer than afterId, oldest first (so
// the frontend can toast them in the order they actually arrived).
function since(afterId) {
  return buffer.filter(e => e.id > afterId).sort((a, b) => a.id - b.id);
}

function latestId() {
  return buffer.length ? buffer[0].id : 0;
}

module.exports = {
  record, setStatus, since, latestId,
  SHEET_SYNC_ALLOWLIST, HARD_BLOCK_KEY, pickAllowlisted // exported for direct unit testing of the backstop
};
