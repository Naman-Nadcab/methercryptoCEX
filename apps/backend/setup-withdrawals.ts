import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/exchange'
});

/**
 * Sets up withdrawals table and optionally inserts TEST/DUMMY data (withdrawals + balances).
 * Do NOT run in production if you want only real data. After running, use:
 *   node scripts/cleanup-dummy-financial-data.js
 * to remove all dummy financial data while keeping the protected user (nmnsingh02@gmail.com).
 */
async function setup() {
  const client = await pool.connect();
  try {
    console.log('Setting up withdrawals table and dummy data...');

    // Create withdrawals table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_id UUID NOT NULL REFERENCES tokens(id),
        chain_id UUID NOT NULL REFERENCES chains(id),
        amount DECIMAL(30, 18) NOT NULL,
        fee DECIMAL(30, 18) DEFAULT 0,
        to_address VARCHAR(255) NOT NULL,
        tx_hash VARCHAR(255),
        memo VARCHAR(255),
        status VARCHAR(50) DEFAULT 'pending',
        account_type VARCHAR(50) DEFAULT 'funding',
        processed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✓ Withdrawals table created/verified');

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id ON withdrawals(user_id);
      CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
      CREATE INDEX IF NOT EXISTS idx_withdrawals_created_at ON withdrawals(created_at);
    `);
    console.log('✓ Indexes created');

    // Add withdrawal_fee and min_withdrawal columns to tokens if not exist
    const tokenColCheck = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'tokens' AND column_name = 'withdrawal_fee'
    `);
    
    if (tokenColCheck.rows.length === 0) {
      await client.query(`
        ALTER TABLE tokens 
        ADD COLUMN IF NOT EXISTS withdrawal_fee DECIMAL(30, 18) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS min_withdrawal DECIMAL(30, 18) DEFAULT 0
      `);
      console.log('✓ Added withdrawal_fee and min_withdrawal columns to tokens');
    }

    // Update tokens with withdrawal fees
    await client.query(`
      UPDATE tokens SET 
        withdrawal_fee = CASE 
          WHEN UPPER(symbol) = 'BTC' THEN 0.0001
          WHEN UPPER(symbol) = 'ETH' THEN 0.001
          WHEN UPPER(symbol) IN ('USDT', 'USDC', 'BUSD', 'DAI') THEN 1
          WHEN UPPER(symbol) = 'SOL' THEN 0.01
          WHEN UPPER(symbol) = 'XRP' THEN 0.1
          ELSE 0.001
        END,
        min_withdrawal = CASE 
          WHEN UPPER(symbol) = 'BTC' THEN 0.0005
          WHEN UPPER(symbol) = 'ETH' THEN 0.005
          WHEN UPPER(symbol) IN ('USDT', 'USDC', 'BUSD', 'DAI') THEN 10
          WHEN UPPER(symbol) = 'SOL' THEN 0.1
          WHEN UPPER(symbol) = 'XRP' THEN 1
          ELSE 0.01
        END
      WHERE withdrawal_fee = 0 OR withdrawal_fee IS NULL
    `);
    console.log('✓ Updated token withdrawal fees');

    // Get a test user
    const userResult = await client.query(`
      SELECT id FROM users ORDER BY created_at LIMIT 1
    `);

    if (userResult.rows.length === 0) {
      console.log('⚠ No users found, skipping dummy data creation');
      return;
    }

    const testUserId = userResult.rows[0].id;
    console.log(`Using test user: ${testUserId}`);

    // Get token and chain IDs
    const usdtToken = await client.query(`
      SELECT t.id as token_id, c.id as chain_id, c.name as chain_name
      FROM tokens t 
      JOIN chains c ON t.chain_id = c.id
      WHERE UPPER(t.symbol) = 'USDT' AND t.is_active = TRUE
      LIMIT 4
    `);

    const btcToken = await client.query(`
      SELECT t.id as token_id, c.id as chain_id, c.name as chain_name
      FROM tokens t 
      JOIN chains c ON t.chain_id = c.id
      WHERE UPPER(t.symbol) = 'BTC' AND t.is_active = TRUE
      LIMIT 1
    `);

    const ethToken = await client.query(`
      SELECT t.id as token_id, c.id as chain_id, c.name as chain_name
      FROM tokens t 
      JOIN chains c ON t.chain_id = c.id
      WHERE UPPER(t.symbol) = 'ETH' AND t.is_active = TRUE
      LIMIT 1
    `);

    // Check if dummy data already exists
    const existingWithdrawals = await client.query(`
      SELECT COUNT(*) as count FROM withdrawals WHERE user_id = $1
    `, [testUserId]);

    if (parseInt(existingWithdrawals.rows[0].count) > 0) {
      console.log('✓ Dummy withdrawal data already exists, skipping...');
    } else {
      // Create dummy withdrawal records
      const dummyWithdrawals = [];

      // USDT withdrawals
      if (usdtToken.rows.length > 0) {
        const bscChain = usdtToken.rows.find((r: { chain_name: string }) => r.chain_name.toLowerCase().includes('bsc') || r.chain_name.toLowerCase().includes('bnb'));
        const tronChain = usdtToken.rows.find((r: { chain_name: string }) => r.chain_name.toLowerCase().includes('tron'));
        
        if (bscChain) {
          dummyWithdrawals.push({
            token_id: bscChain.token_id,
            chain_id: bscChain.chain_id,
            amount: '9030',
            fee: '1',
            to_address: '0x007d8c9f1A9d2B3c4E5F6A7b8C9d0e1F2a3b4c5d',
            tx_hash: '0xb78d8d48e3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0',
            status: 'completed',
            created_at: '2025-04-07 14:00:49'
          });
          dummyWithdrawals.push({
            token_id: bscChain.token_id,
            chain_id: bscChain.chain_id,
            amount: '809.257',
            fee: '1',
            to_address: '0x824b4793a5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0',
            tx_hash: '0x559c4341d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9',
            status: 'completed',
            created_at: '2025-03-16 12:15:16'
          });
        }

        if (tronChain) {
          dummyWithdrawals.push({
            token_id: tronChain.token_id,
            chain_id: tronChain.chain_id,
            amount: '168',
            fee: '1.6',
            to_address: 'TTFXZ3f1Za2b3c4D5e6F7g8H9i0J1k2L3m',
            tx_hash: '60fc5e7b1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c',
            status: 'completed',
            created_at: '2025-02-26 17:15:38'
          });
          dummyWithdrawals.push({
            token_id: tronChain.token_id,
            chain_id: tronChain.chain_id,
            amount: '780',
            fee: '1.6',
            to_address: 'TZ7pKkbq6u1a2b3c4D5e6F7g8H9i0J1k2L',
            tx_hash: '533a394fa72b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d',
            status: 'completed',
            created_at: '2025-02-26 08:31:51'
          });
        }
      }

      // BTC withdrawal
      if (btcToken.rows.length > 0) {
        dummyWithdrawals.push({
          token_id: btcToken.rows[0].token_id,
          chain_id: btcToken.rows[0].chain_id,
          amount: '0.5',
          fee: '0.0001',
          to_address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
          tx_hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
          status: 'completed',
          created_at: '2025-01-15 10:30:00'
        });
      }

      // ETH withdrawal (pending)
      if (ethToken.rows.length > 0) {
        dummyWithdrawals.push({
          token_id: ethToken.rows[0].token_id,
          chain_id: ethToken.rows[0].chain_id,
          amount: '2.5',
          fee: '0.001',
          to_address: '0x1234567890abcdef1234567890abcdef12345678',
          tx_hash: null,
          status: 'pending',
          created_at: new Date().toISOString()
        });
      }

      // Insert dummy withdrawals
      for (const w of dummyWithdrawals) {
        await client.query(`
          INSERT INTO withdrawals (user_id, token_id, chain_id, amount, fee, to_address, tx_hash, status, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [testUserId, w.token_id, w.chain_id, w.amount, w.fee, w.to_address, w.tx_hash, w.status, w.created_at]);
      }

      console.log(`✓ Created ${dummyWithdrawals.length} dummy withdrawal records`);
    }

    // Ensure balances table has account_type column
    const balanceColCheck = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'balances' AND column_name = 'account_type'
    `);

    if (balanceColCheck.rows.length === 0) {
      await client.query(`
        ALTER TABLE balances ADD COLUMN IF NOT EXISTS account_type VARCHAR(50) DEFAULT 'funding'
      `);
      console.log('✓ Added account_type column to balances');
    }

    // Add some test user_balances for the user (single source of truth; do not use balances table)
    const existingUb = await client.query(`
      SELECT COUNT(*) as count FROM user_balances WHERE user_id = $1
    `, [testUserId]);

    if (parseInt(existingUb.rows[0].count) === 0) {
      const tokens = await client.query(`
        SELECT DISTINCT ON (UPPER(symbol)) t.id, t.symbol, c.id as currency_id
        FROM tokens t
        LEFT JOIN currencies c ON UPPER(TRIM(c.symbol)) = UPPER(TRIM(t.symbol))
        WHERE t.is_active = TRUE AND c.id IS NOT NULL
        ORDER BY UPPER(t.symbol), t.id
        LIMIT 5
      `);

      for (const token of tokens.rows) {
        let balance = '0';
        if (token.symbol.toUpperCase() === 'USDT') balance = '50000';
        else if (token.symbol.toUpperCase() === 'BTC') balance = '1.5';
        else if (token.symbol.toUpperCase() === 'ETH') balance = '15';
        else balance = '1000';

        await client.query(`
          INSERT INTO user_balances (id, user_id, currency_id, chain_id, account_type, available_balance, locked_balance, pending_balance, total_deposited, updated_at)
          VALUES (gen_random_uuid(), $1, $2, '', 'funding', $3, 0, 0, 0, NOW())
          ON CONFLICT (user_id, currency_id, chain_id, account_type) DO UPDATE SET available_balance = EXCLUDED.available_balance, updated_at = NOW()
        `, [testUserId, token.currency_id, balance]);

        await client.query(`
          INSERT INTO user_balances (id, user_id, currency_id, chain_id, account_type, available_balance, locked_balance, pending_balance, total_deposited, updated_at)
          VALUES (gen_random_uuid(), $1, $2, '', 'trading', $3, 0, 0, 0, NOW())
          ON CONFLICT (user_id, currency_id, chain_id, account_type) DO NOTHING
        `, [testUserId, token.currency_id, (parseFloat(balance) * 0.5).toString()]);
      }
      console.log('✓ Created test user_balances for user');
    }

    console.log('\n✅ Withdrawal setup completed successfully!');
  } catch (error) {
    console.error('Setup failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

setup().catch(console.error);
