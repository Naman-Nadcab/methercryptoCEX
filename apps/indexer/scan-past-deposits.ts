import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { ethers, JsonRpcProvider } from 'ethers';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

const USDC_POLYGON = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'; // Native USDC on Polygon
const USDC_BRIDGED_POLYGON = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'; // Bridged USDC.e

const USER_ADDRESS = '0x5628Ff33ff1EcEE4B5FeC0f59e4f358DdD33e6fa'.toLowerCase();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/postgres'
});

const ankrKey = process.env.ANKR_API_KEY || '';
const polygonRpc = process.env.POLYGON_RPC_URL || (ankrKey ? `https://rpc.ankr.com/polygon/${ankrKey}` : 'https://polygon-rpc.com');
const provider = new JsonRpcProvider(polygonRpc);

const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

async function scanPastDeposits() {
  console.log('🔍 Scanning past USDC deposits on Polygon...');
  console.log('User address:', USER_ADDRESS);
  
  const currentBlock = await provider.getBlockNumber();
  console.log('Current block:', currentBlock);
  
  // Scan last 1000 blocks (about 30 mins on Polygon)
  const fromBlock = currentBlock - 1000;
  
  console.log(`Scanning blocks ${fromBlock} to ${currentBlock}...`);
  
  // Get all Transfer events to user address
  const filter = {
    fromBlock,
    toBlock: currentBlock,
    topics: [
      ERC20_TRANSFER_TOPIC,
      null, // from (any)
      ethers.zeroPadValue(USER_ADDRESS, 32) // to user
    ]
  };
  
  const logs = await provider.getLogs(filter);
  console.log(`Found ${logs.length} Transfer events to user`);
  
  for (const log of logs) {
    const tokenAddress = log.address.toLowerCase();
    const fromAddress = '0x' + log.topics[1]!.slice(26).toLowerCase();
    const amount = ethers.formatUnits(log.data, 6); // USDC has 6 decimals
    
    console.log(`\n📥 Found deposit:`);
    console.log(`  Token: ${tokenAddress}`);
    console.log(`  From: ${fromAddress}`);
    console.log(`  Amount: ${amount}`);
    console.log(`  TxHash: ${log.transactionHash}`);
    console.log(`  Block: ${log.blockNumber}`);
    
    // Check if this is USDC
    if (tokenAddress === USDC_POLYGON.toLowerCase() || tokenAddress === USDC_BRIDGED_POLYGON.toLowerCase()) {
      console.log('  ✅ This is USDC!');
      
      // Get user ID
      const userResult = await pool.query(`
        SELECT uw.user_id 
        FROM user_wallets uw 
        JOIN blockchains b ON uw.blockchain_id = b.id
        WHERE LOWER(uw.address) = $1 AND b.chain_id = 137
      `, [USER_ADDRESS]);
      
      if (userResult.rows.length === 0) {
        console.log('  ❌ No user found for this address');
        continue;
      }
      
      const userId = userResult.rows[0].user_id;
      
      // Get currency ID for USDC
      const currencyResult = await pool.query(`SELECT id FROM currencies WHERE UPPER(symbol) = 'USDC' LIMIT 1`);
      const currencyId = currencyResult.rows[0]?.id;
      
      // Get blockchain ID
      const blockchainResult = await pool.query(`SELECT id FROM blockchains WHERE chain_id = 137`);
      const blockchainId = blockchainResult.rows[0]?.id;
      
      // Get wallet ID
      const walletResult = await pool.query(`
        SELECT uw.id 
        FROM user_wallets uw 
        JOIN blockchains b ON uw.blockchain_id = b.id
        WHERE LOWER(uw.address) = $1 AND b.chain_id = 137
      `, [USER_ADDRESS]);
      const walletId = walletResult.rows[0]?.id;
      
      // Get block timestamp
      const block = await provider.getBlock(log.blockNumber);
      const blockTimestamp = block?.timestamp || Math.floor(Date.now() / 1000);
      
      // Insert deposit. ON CONFLICT DO NOTHING prevents duplicate for same (blockchain_id, tx_hash, to_address).
      const insertResult = await pool.query(`
        INSERT INTO deposits (
          id, user_id, currency_id, blockchain_id, wallet_id, tx_hash, 
          from_address, to_address, amount, confirmations, 
          required_confirmations, block_number, block_timestamp, 
          status, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 
          $9, 128, $10, to_timestamp($11), 'completed', NOW(), NOW()
        )
        ON CONFLICT (blockchain_id, tx_hash, to_address) DO NOTHING
        RETURNING id
      `, [
        userId,
        currencyId,
        blockchainId,
        walletId,
        log.transactionHash,
        fromAddress,
        USER_ADDRESS,
        amount,
        currentBlock - log.blockNumber, // confirmations
        log.blockNumber,
        blockTimestamp
      ]);

      if (insertResult.rows.length === 0) {
        console.log('  ⏭️  Already in database (duplicate tx), skipping');
        continue;
      }

      console.log('  ✅ Deposit added to database!');

      // Credit user balance only when we inserted a new deposit (avoids double credit on re-run).
      const CHAIN_ID_GLOBAL = '';
      await pool.query(`
        INSERT INTO user_balances (id, user_id, currency_id, chain_id, available_balance, locked_balance, account_type, updated_at)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, 0, 'funding', NOW())
        ON CONFLICT (user_id, currency_id, chain_id, account_type)
        DO UPDATE SET available_balance = user_balances.available_balance + $4, updated_at = NOW()
      `, [userId, currencyId, CHAIN_ID_GLOBAL, amount]);

      console.log('  ✅ Balance credited!');
    }
  }
  
  await pool.end();
  console.log('\n🎉 Scan complete!');
}

scanPastDeposits().catch(console.error);
