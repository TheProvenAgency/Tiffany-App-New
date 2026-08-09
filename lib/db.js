// Optional Postgres (Supabase) connection. The app must keep working fully
// on JSON alone -- see lib/store.js and lib/production.js, where every
// Postgres call is wrapped so a failure/absence never breaks the request.
// If DATABASE_URL isn't set (the default for local/demo use), every
// function here is a safe no-op.
const { Pool, types } = require('pg');

// pg's default DATE parser builds a JS Date at local-timezone midnight, then
// callers serialize it with .toISOString() (UTC) -- on any host whose TZ
// isn't UTC, that silently shifts the calendar day (verified: this exact
// bug reproduces in this environment, TZ=Asia/Karachi, UTC+5). The app
// only ever wants the plain 'YYYY-MM-DD' string Postgres already returns
// -- every JSON-side date in this codebase is that same plain string, never
// a Date object -- so disable the type coercion entirely rather than rely
// on the deploy host happening to run in UTC.
types.setTypeParser(1082 /* date */, val => val);

const connectionString = process.env.DATABASE_URL || '';

// Pool sizing: this app should connect through Supabase's Transaction
// Pooler (port 6543), which already multiplexes many logical connections
// down to a small number of real Postgres backends -- so the app-side pool
// here just needs enough concurrency to not queue under normal traffic,
// not to match real backend connection limits. connectionTimeoutMillis
// fails fast (5s) instead of piling up pending requests during an outage;
// idleTimeoutMillis recycles connections Supabase's pooler would otherwise
// consider abandoned.
const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    })
  : null;

if (pool) {
  // A dropped idle connection must not crash the process -- every real
  // query already has its own try/catch at the call site.
  pool.on('error', err => console.error('Postgres pool error (non-fatal):', err.message));
}

function isEnabled() {
  return !!pool;
}

async function query(text, params) {
  if (!pool) throw new Error('Postgres is not configured (DATABASE_URL unset)');
  return pool.query(text, params);
}

// Runs `fn(client)` inside a real transaction (begin/commit, or rollback on
// any thrown error) -- for the handful of call sites that need several
// statements to land atomically (e.g. lib/production.js's multi-table
// record creation). `fn` must use the passed `client`, not `query()` above,
// for every statement in the transaction, or those statements would run on
// a different pooled connection outside it.
async function withTransaction(fn) {
  if (!pool) throw new Error('Postgres is not configured (DATABASE_URL unset)');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { isEnabled, query, withTransaction };
