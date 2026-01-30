import { db } from './src/lib/database.js';

async function check() {
  try {
    // Check chains structure
    const chains = await db.query('SELECT * FROM chains LIMIT 2');
    console.log('=== CHAINS STRUCTURE ===');
    console.log(JSON.stringify(chains.rows, null, 2));
    
    // Check tokens structure  
    const tokens = await db.query('SELECT DISTINCT ON (symbol) * FROM tokens WHERE is_active = true ORDER BY symbol LIMIT 20');
    console.log('\n=== UNIQUE TOKENS ===');
    console.log(JSON.stringify(tokens.rows, null, 2));

    // Check user columns for KYC
    const userCols = await db.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users'`);
    console.log('\n=== USER COLUMNS ===');
    console.log(JSON.stringify(userCols.rows, null, 2));
    
  } catch(e) {
    console.error('Error:', e);
  }
  process.exit(0);
}

check();
