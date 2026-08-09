// One-off migration builder: CSV (canonical source) -> batched SQL files,
// written to an output dir for the agent to execute via Supabase MCP
// execute_sql, in order. Not part of the running app.
//
// Correlation strategy: clients.id is Postgres-assigned (bigint identity),
// unknown until insert time, and relying on RETURNING preserving VALUES-list
// row order across ~3600 rows (with 20 duplicate names in the source, so we
// can't safely join back by display_name either) is not something to bet
// real client identity data on. Instead: each client row is inserted with a
// TEMPORARY, fully-unique correlation marker in ghl_contact_id
// ('csv:CSV-<n>') -- a real, already-unique, already-indexed column -- so
// production_records can join back to the exact right client deterministically,
// no ordering assumptions anywhere. A final cleanup statement clears the
// marker back to null (its real, intended value until GHL linkage exists).
//
// Requires APP_ENCRYPTION_KEY in the environment for CFPB password encryption.
const fs = require('fs');
const path = require('path');
const sheet = require('../lib/sheet.js');
const appCrypto = require('../lib/crypto.js');

const OUT_DIR = process.argv[2];
if (!OUT_DIR) { console.error('usage: node build-migration-sql.js <output-dir>'); process.exit(1); }
if (!appCrypto.isEnabled()) { console.error('APP_ENCRYPTION_KEY not set'); process.exit(1); }
fs.mkdirSync(OUT_DIR, { recursive: true });

function esc(v) {
  if (v === null || v === undefined || v === '') return 'null';
  return `'${String(v).replace(/'/g, "''")}'`;
}
function escBytea(buf) {
  return buf ? `'\\x${buf.toString('hex')}'` : 'null';
}
function bestEffortDate(raw) {
  if (!raw) return 'null';
  const d = new Date(raw);
  if (isNaN(d.getTime()) || d.getFullYear() < 2000 || d.getFullYear() > 2100) return 'null';
  return esc(d.toISOString().slice(0, 10));
}

const raw = fs.readFileSync(path.join(__dirname, '..', 'MSF CREDIT CLIENTS - Credit Repair.csv'), 'utf8');
const rows = sheet.parseCsv(raw);
const norm = sheet.normalizeSheetRows(rows);
console.log('normalized rows:', norm.length);

let batchFiles = 0;
function writeBatch(prefix, name, sql) {
  fs.writeFileSync(path.join(OUT_DIR, `${String(batchFiles).padStart(3, '0')}_${prefix}.sql`), sql);
  batchFiles++;
}
function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ---- 1. clients (temporary marker in ghl_contact_id for correlation) ----
const clientRows = norm.map((r, i) => `(${esc(r.name)}, 'csv_import', ${esc('csv:CSV-' + (i + 1))})`);
chunk(clientRows, 1000).forEach(b =>
  writeBatch('clients', 'clients', `insert into clients (display_name, source, ghl_contact_id) values\n${b.join(',\n')};\n`)
);

// ---- 2. production_records, joined back to the client via the marker ----
const prodRows = norm.map((r, i) => {
  const stage = sheet.deriveStage(r.tu, r.eq, r.ex);
  return `(${esc('CSV-' + (i + 1))}, ${esc('csv:CSV-' + (i + 1))}, ${esc(stage)}, ${esc(r.pkg)})`;
});
chunk(prodRows, 1000).forEach(b =>
  writeBatch('production_records', 'production_records', `insert into production_records (legacy_id, client_id, stage, package)
select v.legacy_id, c.id, v.stage, v.package
from (values\n${b.join(',\n')}\n) as v(legacy_id, marker, stage, package)
join clients c on c.ghl_contact_id = v.marker;\n`)
);

// ---- 3. production_bureau_status (joins on legacy_id, already unique) ----
const bureauRows = [];
norm.forEach((r, i) => {
  const legacyId = 'CSV-' + (i + 1);
  for (const b of ['tu', 'eq', 'ex']) {
    const cell = r[b];
    if (!cell) continue;
    bureauRows.push(`(${esc(legacyId)}, '${b.toUpperCase()}', ${cell.r != null ? cell.r : 'null'}, ${esc(cell.st)}, ${esc(cell.raw)}, ${cell.unrecognized ? 'true' : 'false'})`);
  }
});
chunk(bureauRows, 1000).forEach(b =>
  writeBatch('bureau', 'production_bureau_status', `insert into production_bureau_status (production_record_id, bureau, round_number, status, raw_text, unrecognized)
select pr.id, v.bureau, v.round_number, v.status, v.raw_text, v.unrecognized
from (values\n${b.join(',\n')}\n) as v(legacy_id, bureau, round_number, status, raw_text, unrecognized)
join production_records pr on pr.legacy_id = v.legacy_id;\n`)
);

// ---- 4. production_documents (all-false checklist -- CSV carries no document checkboxes) ----
const docRows = norm.map((r, i) => `(${esc('CSV-' + (i + 1))})`);
chunk(docRows, 2000).forEach(b =>
  writeBatch('docs', 'production_documents', `insert into production_documents (production_record_id)
select pr.id from (values\n${b.join(',\n')}\n) as v(legacy_id)
join production_records pr on pr.legacy_id = v.legacy_id;\n`)
);

// ---- 5. production_notes ----
const noteRows = [];
norm.forEach((r, i) => {
  if (r.notes && r.notes.trim()) noteRows.push(`(${esc('CSV-' + (i + 1))}, ${esc(r.notes.trim())}, ${esc('Sheet')})`);
});
chunk(noteRows, 1000).forEach(b =>
  writeBatch('notes', 'production_notes', `insert into production_notes (production_record_id, body, author_label)
select pr.id, v.body, v.author_label
from (values\n${b.join(',\n')}\n) as v(legacy_id, body, author_label)
join production_records pr on pr.legacy_id = v.legacy_id;\n`)
);

// ---- 6. production_cfpb_logins (encrypted passwords) ----
const cfpbRows = [];
norm.forEach((r, i) => {
  const legacyId = 'CSV-' + (i + 1);
  for (const c of (r.cfpb || [])) {
    const encPw = c.pw ? appCrypto.encrypt(c.pw) : null;
    cfpbRows.push(`(${esc(legacyId)}, ${c.round}, ${esc(c.date)}, ${bestEffortDate(c.date)}, ${esc(c.email)}, ${escBytea(encPw)})`);
  }
});
chunk(cfpbRows, 500).forEach(b =>
  writeBatch('cfpb', 'production_cfpb_logins', `insert into production_cfpb_logins (production_record_id, round_number, filed_date_raw, filed_date, portal_login_or_note, portal_password_encrypted)
select pr.id, v.round_number::int, v.filed_date_raw, v.filed_date::date, v.portal_login_or_note, v.portal_password_encrypted::bytea
from (values\n${b.join(',\n')}\n) as v(legacy_id, round_number, filed_date_raw, filed_date, portal_login_or_note, portal_password_encrypted)
join production_records pr on pr.legacy_id = v.legacy_id;\n`)
);

// ---- 7. cleanup: clear the temporary correlation markers ----
writeBatch('zzz_cleanup', 'cleanup', `update clients set ghl_contact_id = null where ghl_contact_id like 'csv:%';\n`);

console.log('Wrote', batchFiles, 'batch files to', OUT_DIR);
console.log('Row counts: clients', clientRows.length, '| production_records', prodRows.length,
  '| bureau_status', bureauRows.length, '| documents', docRows.length, '| notes', noteRows.length, '| cfpb_logins', cfpbRows.length);
