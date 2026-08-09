// App-layer encryption for anything mirrored into a Postgres *_encrypted
// column (GHL/Meta tokens, the webhook secret, CFPB portal passwords once
// that migration happens) -- Postgres only ever sees ciphertext. Same
// reasoning as docs/postgres-schema-design.sql: a project-level Supabase
// compromise alone can't decrypt these, since the key never leaves this
// process's environment.
//
// AES-256-GCM: key is a 32-byte value, hex-encoded in APP_ENCRYPTION_KEY
// (64 hex chars). Generate one with: openssl rand -hex 32
const crypto = require('crypto');

const KEY_HEX = process.env.APP_ENCRYPTION_KEY || '';
const key = /^[0-9a-fA-F]{64}$/.test(KEY_HEX) ? Buffer.from(KEY_HEX, 'hex') : null;

function isEnabled() {
  return !!key;
}

// Returns a single bytea-ready Buffer: iv (12) + authTag (16) + ciphertext,
// so the whole thing round-trips through one Postgres bytea column.
function encrypt(plaintext) {
  if (!key) throw new Error('APP_ENCRYPTION_KEY is not configured');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

function decrypt(buf) {
  if (!key) throw new Error('APP_ENCRYPTION_KEY is not configured');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

module.exports = { isEnabled, encrypt, decrypt };
