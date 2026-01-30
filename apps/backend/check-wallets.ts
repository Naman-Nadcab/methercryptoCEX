import { db } from './src/lib/database.js';

async function check() {
  // Check if there are any wallets for the user
  const wallets = await db.query(`SELECT w.*, c.name as chain_name FROM wallets w LEFT JOIN chains c ON w.chain_id = c.id WHERE w.user_id = 'e1f151e5-bfb1-47d3-be52-2270089cf8ad'`);
  console.log('\n=== User wallets ===');
  console.log(wallets.rows);
  
  // Check KYC status
  const kyc = await db.query(`SELECT * FROM kyc_applications WHERE user_id = 'e1f151e5-bfb1-47d3-be52-2270089cf8ad'`);
  console.log('\n=== KYC status ===');
  console.log(kyc.rows);
  
  process.exit(0);
}

check().catch(e => {
  console.error(e);
  process.exit(1);
});
