import { db } from './src/lib/database.js';

async function check() {
  try {
    // Check for KYC table
    const kycTable = await db.query(`SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%kyc%'`);
    console.log('KYC Tables:', kycTable.rows);
    
    // Check wallet addresses table
    const walletTable = await db.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'wallet_addresses'`);
    console.log('\nWallet Addresses Columns:', walletTable.rows);
    
    // Check user_wallets table
    const userWallets = await db.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'user_wallets'`);
    console.log('\nUser Wallets Columns:', userWallets.rows);
    
    // Get chains for specific tokens
    const ethChains = await db.query(`
      SELECT DISTINCT t.symbol, c.name as chain_name, c.id_text as chain_code, c.type, c.required_confirmations
      FROM tokens t 
      JOIN chains c ON t.chain_id = c.id 
      WHERE t.symbol = 'ETH' AND t.is_active = true
    `);
    console.log('\nETH available on chains:', ethChains.rows);
    
    const usdtChains = await db.query(`
      SELECT DISTINCT t.symbol, c.name as chain_name, c.id_text as chain_code, c.type, c.required_confirmations
      FROM tokens t 
      JOIN chains c ON t.chain_id = c.id 
      WHERE t.symbol = 'USDT' AND t.is_active = true
    `);
    console.log('\nUSDT available on chains:', usdtChains.rows);
  } catch(e) {
    console.error('Error:', e);
  }
  process.exit(0);
}
check();
