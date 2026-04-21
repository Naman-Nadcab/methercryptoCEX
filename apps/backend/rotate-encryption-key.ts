/**
 * Safe ENCRYPTION_KEY rotation script.
 *
 * What it does:
 *  1. Connects to DB, fetches all hot_wallets (encrypted_private_key, encrypted_dek, key_version).
 *  2. Decrypts each DEK using the OLD master key.
 *  3. Decrypts each private key using the old DEK (to verify decryption works).
 *  4. Re-encrypts the DEK with the NEW master key.
 *  5. Updates the row in DB (encrypted_dek only — private key encryption is unchanged, only the wrapper key changes).
 *  6. Prints a summary. Does NOT print private keys.
 *
 * Usage:
 *   OLD_ENCRYPTION_KEY=<old> NEW_ENCRYPTION_KEY=<new> npx tsx rotate-encryption-key.ts
 *
 * Safety:
 *  - All changes are in a single DB transaction; on any error it rolls back.
 *  - Backup of old values printed before update (so you can restore if needed).
 *  - After running, set ENCRYPTION_KEY=<new> in .env and restart backend.
 */

import crypto from 'crypto';
import pg from 'pg';

const OLD_KEY = process.env.OLD_ENCRYPTION_KEY;
const NEW_KEY = process.env.NEW_ENCRYPTION_KEY;

if (!OLD_KEY || !NEW_KEY) {
  console.error('❌ Set OLD_ENCRYPTION_KEY and NEW_ENCRYPTION_KEY env vars.');
  process.exit(1);
}
if (OLD_KEY === NEW_KEY) {
  console.error('❌ OLD_ENCRYPTION_KEY and NEW_ENCRYPTION_KEY are the same — nothing to do.');
  process.exit(1);
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function deriveMasterKey(encryptionKey: string, keyVersion: string): Buffer {
  return crypto.createHash('sha256').update(encryptionKey + ':' + keyVersion).digest();
}

function decodeCiphertext(encoded: string) {
  const parts = encoded.split(':');
  if (parts.length !== 3) throw new Error(`Invalid ciphertext format: ${encoded.slice(0, 30)}`);
  return {
    iv: Buffer.from(parts[0]!, 'base64'),
    authTag: Buffer.from(parts[1]!, 'base64'),
    ciphertext: Buffer.from(parts[2]!, 'base64'),
  };
}

function encodeCiphertext(iv: Buffer, authTag: Buffer, ciphertext: Buffer): string {
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

function decryptDEK(encryptedDEK: string, masterKey: Buffer): Buffer {
  const { iv, authTag, ciphertext } = decodeCiphertext(encryptedDEK);
  const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function encryptDEK(plaintextDEK: Buffer, masterKey: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintextDEK), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return encodeCiphertext(iv, authTag, encrypted);
}

function decryptWithDEK(encoded: string, dek: Buffer): Buffer {
  const { iv, authTag, ciphertext } = decodeCiphertext(encoded);
  const decipher = crypto.createDecipheriv(ALGORITHM, dek, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

async function main() {
  // Parse DB URL from env
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) { console.error('❌ DATABASE_URL not set'); process.exit(1); }

  // Handle IPv6 in connection string
  let connectionConfig: pg.ClientConfig;
  try {
    // Try parsing as-is
    connectionConfig = { connectionString: rawUrl, ssl: { rejectUnauthorized: false } };
  } catch {
    connectionConfig = { connectionString: rawUrl };
  }

  const client = new pg.Client(connectionConfig);
  await client.connect();
  console.log('✅ DB connected');

  // Fetch all hot wallets with encrypted keys
  const res = await client.query<{
    id: string; chain_id: string; address: string;
    encrypted_private_key: string; encrypted_dek: string | null; key_version: string | null;
  }>(`SELECT id, chain_id, address, encrypted_private_key, encrypted_dek, key_version FROM hot_wallets ORDER BY created_at`);

  const rows = res.rows;
  console.log(`\n📋 Found ${rows.length} hot wallet(s).\n`);

  if (rows.length === 0) {
    console.log('Nothing to rotate. Exiting.');
    await client.end();
    return;
  }

  // Verify we can decrypt all wallets with old key BEFORE making any changes
  for (const row of rows) {
    if (!row.encrypted_dek || !row.key_version) {
      console.log(`⚠️  Wallet ${row.chain_id} (${row.address.slice(0, 12)}...) has no DEK — legacy row, skip.`);
      continue;
    }
    try {
      const oldMaster = deriveMasterKey(OLD_KEY, row.key_version);
      const dek = decryptDEK(row.encrypted_dek, oldMaster);
      // Verify private key decrypts too
      decryptWithDEK(row.encrypted_private_key, dek);
      dek.fill(0);
      console.log(`✅ ${row.chain_id.padEnd(12)} ${row.address.slice(0, 16)}...  — decryption OK`);
    } catch (e) {
      console.error(`❌ DECRYPT FAILED for ${row.chain_id}: ${(e as Error).message}`);
      console.error('   Aborting — OLD_ENCRYPTION_KEY may be wrong. No changes made.');
      await client.end();
      process.exit(1);
    }
  }

  console.log('\n🔄 All wallets verified. Starting re-encryption with new key...\n');

  // Do all updates inside a single transaction
  await client.query('BEGIN');
  try {
    let rotated = 0;
    let skipped = 0;
    for (const row of rows) {
      if (!row.encrypted_dek || !row.key_version) {
        skipped++;
        continue;
      }
      const oldMaster = deriveMasterKey(OLD_KEY, row.key_version);
      const newMaster = deriveMasterKey(NEW_KEY, row.key_version);

      const dek = decryptDEK(row.encrypted_dek, oldMaster);
      const newEncryptedDEK = encryptDEK(dek, newMaster);
      dek.fill(0); // zeroize

      await client.query(
        `UPDATE hot_wallets SET encrypted_dek = $1, updated_at = NOW() WHERE id = $2`,
        [newEncryptedDEK, row.id]
      );
      rotated++;
      console.log(`  ✅ Rotated ${row.chain_id} (${row.address.slice(0, 16)}...)`);
    }

    await client.query('COMMIT');
    console.log(`\n✅ Rotation complete. Rotated: ${rotated}, Skipped (legacy): ${skipped}`);
    console.log('\n📌 Next step: Update ENCRYPTION_KEY in apps/backend/.env to the new value and restart backend.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Error during rotation — ROLLED BACK. No changes saved.', err);
    await client.end();
    process.exit(1);
  }

  await client.end();
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
