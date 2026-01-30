import { db } from './src/lib/database.js';

async function checkDB() {
  try {
    // Check if chains exists as table or view
    const tableType = await db.query(`
      SELECT table_type FROM information_schema.tables 
      WHERE table_name = 'chains'
    `);
    console.log('chains type:', tableType.rows);
    
    // Check actual chains data
    const chains = await db.query('SELECT * FROM chains LIMIT 3');
    console.log('chains data:', JSON.stringify(chains.rows, null, 2));
    
    // Check tokens
    const tokens = await db.query('SELECT symbol, chain_id, name FROM tokens WHERE is_active = true LIMIT 10');
    console.log('tokens data:', JSON.stringify(tokens.rows, null, 2));
    
  } catch(e) {
    console.error('Error:', e);
  }
  process.exit(0);
}

checkDB();
