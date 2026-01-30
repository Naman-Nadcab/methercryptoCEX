import { db } from './src/lib/database.js';

async function check() {
  try {
    // Check USDT tokens
    const usdtTokens = await db.query(`SELECT * FROM tokens WHERE UPPER(symbol) = 'USDT' AND is_active = TRUE`);
    console.log('USDT tokens:', usdtTokens.rows.length);
    
    // Check chains join
    const result = await db.query(`
      SELECT DISTINCT 
             c.id, c.id_text, c.name, c.type
      FROM tokens t
      JOIN chains c ON t.chain_id = c.id
      WHERE UPPER(t.symbol) = 'USDT' AND t.is_active = TRUE AND c.is_active = TRUE
    `);
    console.log('USDT chains:', result.rows);
  } catch(e) {
    console.error('Error:', e);
  }
  process.exit(0);
}
check();
