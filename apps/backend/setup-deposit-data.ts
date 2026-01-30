/**
 * Script to setup chains and tokens data for deposit feature
 * Run with: npx tsx apps/backend/setup-deposit-data.ts
 */

import { db } from './src/lib/database.js';

async function setupDepositData() {
  console.log('🔧 Setting up deposit data...\n');

  try {
    // Add missing columns to chains table if they don't exist
    try {
      await db.query(`ALTER TABLE chains ADD COLUMN IF NOT EXISTS confirmations_required INTEGER NOT NULL DEFAULT 12`);
      await db.query(`ALTER TABLE chains ADD COLUMN IF NOT EXISTS avg_block_time INTEGER NOT NULL DEFAULT 12`);
      await db.query(`ALTER TABLE chains ADD COLUMN IF NOT EXISTS icon_url TEXT`);
    } catch (e) {
      // Columns might already exist
      console.log('Note: Some columns may already exist');
    }
    console.log('✓ Chains table ready');

    // Add missing columns to tokens table if they don't exist
    try {
      await db.query(`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS icon_url TEXT`);
    } catch (e) {
      console.log('Note: icon_url column may already exist');
    }
    console.log('✓ Tokens table ready');

    // Insert chains one by one to handle missing columns gracefully
    const chainsData = [
      { id: 'ethereum', name: 'Ethereum', type: 'evm', native_currency: 'ETH', decimals: 18, rpc_url: 'https://eth-mainnet.g.alchemy.com/v2/demo', explorer_url: 'https://etherscan.io' },
      { id: 'bsc', name: 'BNB Smart Chain', type: 'evm', native_currency: 'BNB', decimals: 18, rpc_url: 'https://bsc-dataseed.binance.org', explorer_url: 'https://bscscan.com' },
      { id: 'polygon', name: 'Polygon', type: 'evm', native_currency: 'MATIC', decimals: 18, rpc_url: 'https://polygon-rpc.com', explorer_url: 'https://polygonscan.com' },
      { id: 'arbitrum', name: 'Arbitrum One', type: 'evm', native_currency: 'ETH', decimals: 18, rpc_url: 'https://arb1.arbitrum.io/rpc', explorer_url: 'https://arbiscan.io' },
      { id: 'optimism', name: 'Optimism', type: 'evm', native_currency: 'ETH', decimals: 18, rpc_url: 'https://mainnet.optimism.io', explorer_url: 'https://optimistic.etherscan.io' },
      { id: 'base', name: 'Base', type: 'evm', native_currency: 'ETH', decimals: 18, rpc_url: 'https://mainnet.base.org', explorer_url: 'https://basescan.org' },
      { id: 'solana', name: 'Solana', type: 'solana', native_currency: 'SOL', decimals: 9, rpc_url: 'https://api.mainnet-beta.solana.com', explorer_url: 'https://solscan.io' },
      { id: 'tron', name: 'Tron', type: 'tron', native_currency: 'TRX', decimals: 6, rpc_url: 'https://api.trongrid.io', explorer_url: 'https://tronscan.org' },
      { id: 'bitcoin', name: 'Bitcoin', type: 'bitcoin', native_currency: 'BTC', decimals: 8, rpc_url: 'http://localhost:8332', explorer_url: 'https://blockstream.info' },
    ];

    for (const chain of chainsData) {
      await db.query(`
        INSERT INTO chains (id, name, type, native_currency, decimals, rpc_url, explorer_url)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          type = EXCLUDED.type,
          native_currency = EXCLUDED.native_currency,
          decimals = EXCLUDED.decimals,
          rpc_url = EXCLUDED.rpc_url,
          explorer_url = EXCLUDED.explorer_url
      `, [chain.id, chain.name, chain.type, chain.native_currency, chain.decimals, chain.rpc_url, chain.explorer_url]);
    }
    console.log('✓ Chains inserted');

    // Check chains
    const chainsResult = await db.query('SELECT * FROM chains');
    console.log(`  Found ${chainsResult.rows.length} chains`);

    // Delete existing tokens to avoid duplicates
    await db.query('DELETE FROM tokens');

    // Insert tokens
    await db.query(`
      INSERT INTO tokens (id, symbol, name, chain_id, contract_address, decimals, is_active, is_native, min_deposit, min_withdrawal, withdrawal_fee)
      VALUES
        -- Native tokens
        (uuid_generate_v4(), 'ETH', 'Ethereum', 'ethereum', NULL, 18, true, true, 0.001, 0.001, 0.0005),
        (uuid_generate_v4(), 'BNB', 'BNB', 'bsc', NULL, 18, true, true, 0.01, 0.01, 0.0005),
        (uuid_generate_v4(), 'MATIC', 'Polygon', 'polygon', NULL, 18, true, true, 1, 1, 0.1),
        (uuid_generate_v4(), 'ETH', 'Ethereum', 'arbitrum', NULL, 18, true, true, 0.001, 0.001, 0.0001),
        (uuid_generate_v4(), 'ETH', 'Ethereum', 'optimism', NULL, 18, true, true, 0.001, 0.001, 0.0001),
        (uuid_generate_v4(), 'ETH', 'Ethereum', 'base', NULL, 18, true, true, 0.001, 0.001, 0.0001),
        (uuid_generate_v4(), 'SOL', 'Solana', 'solana', NULL, 9, true, true, 0.01, 0.01, 0.001),
        (uuid_generate_v4(), 'TRX', 'Tron', 'tron', NULL, 6, true, true, 10, 10, 1),
        (uuid_generate_v4(), 'BTC', 'Bitcoin', 'bitcoin', NULL, 8, true, true, 0.0001, 0.0001, 0.00005),
        
        -- USDT on different chains
        (uuid_generate_v4(), 'USDT', 'Tether USD', 'ethereum', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 6, true, false, 10, 10, 5),
        (uuid_generate_v4(), 'USDT', 'Tether USD', 'bsc', '0x55d398326f99059fF775485246999027B3197955', 18, true, false, 10, 10, 1),
        (uuid_generate_v4(), 'USDT', 'Tether USD', 'polygon', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', 6, true, false, 10, 10, 1),
        (uuid_generate_v4(), 'USDT', 'Tether USD', 'tron', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 6, true, false, 10, 10, 1),
        (uuid_generate_v4(), 'USDT', 'Tether USD', 'arbitrum', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 6, true, false, 10, 10, 1),
        
        -- USDC on different chains
        (uuid_generate_v4(), 'USDC', 'USD Coin', 'ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6, true, false, 10, 10, 5),
        (uuid_generate_v4(), 'USDC', 'USD Coin', 'bsc', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 18, true, false, 10, 10, 1),
        (uuid_generate_v4(), 'USDC', 'USD Coin', 'polygon', '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', 6, true, false, 10, 10, 1),
        (uuid_generate_v4(), 'USDC', 'USD Coin', 'arbitrum', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 6, true, false, 10, 10, 1),
        (uuid_generate_v4(), 'USDC', 'USD Coin', 'base', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6, true, false, 10, 10, 1),

        -- HMSTR (Hamster Kombat) on TON (we'll use ethereum for now)
        (uuid_generate_v4(), 'HMSTR', 'Hamster Kombat', 'ethereum', '0x0000000000000000000000000000000000000001', 9, true, false, 100, 100, 10)
    `);
    console.log('✓ Tokens inserted');

    // Check tokens
    const tokensResult = await db.query('SELECT * FROM tokens');
    console.log(`  Found ${tokensResult.rows.length} tokens`);

    // List all tokens
    console.log('\n📋 Available tokens:');
    for (const token of tokensResult.rows) {
      console.log(`  - ${token.symbol} on ${token.chain_id} (${token.name})`);
    }

    console.log('\n✅ Setup completed successfully!');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

setupDepositData();
