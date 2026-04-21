/**
 * Key rotation runner — same logic as rotate-encryption-key.ts but with
 * explicit host/port/user/password to handle IPv6 DB addresses.
 */
import crypto from 'crypto';
import pg from 'pg';

const OLD_KEY = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
const NEW_KEY = '0340ec7d9a4f52332691d75bfbdc78f6f79f857ef6fc7cf993b276816b93c49c';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

function deriveMasterKey(encKey: string, keyVersion: string): Buffer {
  return crypto.createHash('sha256').update(encKey + ':' + keyVersion).digest();
}

function decodeCiphertext(encoded: string) {
  const parts = encoded.split(':');
  if (parts.length !== 3) throw new Error(`Invalid ciphertext: ${encoded.slice(0, 20)}`);
  return {
    iv: Buffer.from(parts[0]!, 'base64'),
    authTag: Buffer.from(parts[1]!, 'base64'),
    ciphertext: Buffer.from(parts[2]!, 'base64'),
  };
}

function encodeCiphertext(iv: Buffer, authTag: Buffer, ct: Buffer): string {
  return [iv.toString('base64'), authTag.toString('base64'), ct.toString('base64')].join(':');
}

function decryptDEK(encDEK: string, master: Buffer): Buffer {
  const { iv, authTag, ciphertext } = decodeCiphertext(encDEK);
  const d = crypto.createDecipheriv(ALGORITHM, master, iv);
  d.setAuthTag(authTag);
  return Buffer.concat([d.update(ciphertext), d.final()]);
}

function encryptDEK(dek: Buffer, master: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const c = crypto.createCipheriv(ALGORITHM, master, iv);
  const ct = Buffer.concat([c.update(dek), c.final()]);
  return encodeCiphertext(iv, c.getAuthTag(), ct);
}

function decryptWithDEK(encoded: string, dek: Buffer): Buffer {
  const { iv, authTag, ciphertext } = decodeCiphertext(encoded);
  const d = crypto.createDecipheriv(ALGORITHM, dek, iv);
  d.setAuthTag(authTag);
  return Buffer.concat([d.update(ciphertext), d.final()]);
}

async function main() {
  const client = new pg.Client({
    host: '2406:da1c:f42:ae0c:9690:2daf:ca56:2745',
    port: 5432,
    user: 'postgres',
    password: 'Aman@961648',
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('✅ DB connected');

  const res = await client.query<{
    id: string; chain_id: string; address: string;
    encrypted_private_key: string; encrypted_dek: string | null; key_version: string | null;
  }>(`SELECT id, chain_id, address, encrypted_private_key, encrypted_dek, key_version FROM hot_wallets ORDER BY created_at`);

  console.log(`\n📋 Found ${res.rows.length} hot wallet(s).\n`);

  // Phase 1: verify all decrypt OK with old key
  for (const row of res.rows) {
    if (!row.encrypted_dek || !row.key_version) {
      console.log(`⚠️  ${row.chain_id} — no DEK (legacy), skip`);
      continue;
    }
    try {
      const om = deriveMasterKey(OLD_KEY, row.key_version);
      const dek = decryptDEK(row.encrypted_dek, om);
      decryptWithDEK(row.encrypted_private_key, dek); // verify
      dek.fill(0);
      console.log(`✅ Verified: ${row.chain_id.padEnd(14)} ${row.address.slice(0, 16)}...`);
    } catch (e) {
      console.error(`❌ FAIL: ${row.chain_id}: ${(e as Error).message}`);
      await client.end();
      process.exit(1);
    }
  }

  console.log('\n🔄 Starting re-encryption...\n');

  await client.query('BEGIN');
  try {
    let rotated = 0;
    for (const row of res.rows) {
      if (!row.encrypted_dek || !row.key_version) continue;
      const om = deriveMasterKey(OLD_KEY, row.key_version);
      const nm = deriveMasterKey(NEW_KEY, row.key_version);
      const dek = decryptDEK(row.encrypted_dek, om);
      const newEncDEK = encryptDEK(dek, nm);
      dek.fill(0);
      await client.query(`UPDATE hot_wallets SET encrypted_dek = $1, updated_at = NOW() WHERE id = $2`, [newEncDEK, row.id]);
      rotated++;
      console.log(`  🔑 Rotated: ${row.chain_id} (${row.address.slice(0, 16)}...)`);
    }
    await client.query('COMMIT');
    console.log(`\n✅ Done. Rotated ${rotated} wallet(s). Update .env next.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Rolled back. No changes.', err);
    process.exit(1);
  }
  await client.end();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
