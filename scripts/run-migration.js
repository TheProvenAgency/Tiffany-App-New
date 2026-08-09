// Runs the batched SQL files from build-migration-sql.js against a real
// Postgres connection, in order, inside ONE transaction -- either the whole
// migration lands or none of it does. Not part of the running app.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DIR = process.argv[2];
if (!DIR) { console.error('usage: DATABASE_URL=... node run-migration.js <batch-dir>'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const f of files) {
      const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
      const start = Date.now();
      const r = await client.query(sql);
      console.log(`${f}: ${r.rowCount ?? 0} rows affected (${Date.now() - start}ms)`);
    }
    await client.query('commit');
    console.log('MIGRATION COMMITTED');
  } catch (e) {
    await client.query('rollback');
    console.error('MIGRATION ROLLED BACK — nothing was committed. Error:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}
main();
