/**
 * Script to generate wallets for all existing users
 * Run with: npx tsx apps/backend/generate-user-wallets.ts
 */

import { db } from './src/lib/database.js';
import { walletService } from './src/services/wallet.service.js';
import { logger } from './src/lib/logger.js';

interface UserRow {
  id: string;
  email: string;
}

async function generateWalletsForExistingUsers() {
  console.log('🔑 Starting wallet generation for existing users...\n');

  try {
    // First, ensure the user_master_keys table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_master_keys (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        encrypted_seed TEXT NOT NULL,
        key_version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ user_master_keys table ready\n');

    // Get all users who don't have wallets yet
    const result = await db.query<UserRow>(`
      SELECT u.id, u.email 
      FROM users u
      WHERE NOT EXISTS (
        SELECT 1 FROM wallets w WHERE w.user_id = u.id
      )
      AND u.status = 'active'
      ORDER BY u.created_at ASC
    `);

    console.log(`Found ${result.rows.length} users without wallets\n`);

    if (result.rows.length === 0) {
      console.log('✓ All users already have wallets!');
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    for (const user of result.rows) {
      try {
        console.log(`Processing user: ${user.email} (${user.id})`);
        
        const wallets = await walletService.createWalletsForUser(user.id);
        
        console.log(`  ✓ Created ${wallets.length} wallets`);
        wallets.forEach(w => {
          console.log(`    - ${w.chainId}: ${w.address.slice(0, 10)}...${w.address.slice(-8)}`);
        });
        
        successCount++;
      } catch (error) {
        console.error(`  ✗ Error for user ${user.email}:`, error instanceof Error ? error.message : 'Unknown');
        errorCount++;
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log(`✓ Completed: ${successCount} successful, ${errorCount} errors`);
    console.log('='.repeat(50));

  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

generateWalletsForExistingUsers();
