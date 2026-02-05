#!/usr/bin/env npx tsx
/**
 * One-time migration: re-encrypt all legacy hot wallet keys (encrypted_dek IS NULL)
 * to envelope encryption. Run after schema migration has added encrypted_dek and key_version.
 *
 * Usage: npx tsx scripts/migrate-hot-wallets-envelope.ts
 * Or from backend: npm run migrate && npx tsx scripts/migrate-hot-wallets-envelope.ts
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const { migrateAllHotWalletsToEnvelope } = await import('../src/services/hot-wallet.service.js');
  const { db } = await import('../src/lib/database.js');

  try {
    const result = await migrateAllHotWalletsToEnvelope();
    console.log(`Done. Migrated: ${result.migrated}, Already envelope: ${result.skipped}`);
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
