import { db } from './src/lib/database.js';

async function debug() {
  try {
    console.log('Checking currencies table...');
    const result = await db.query(`
      SELECT id, symbol, name, is_active FROM currencies LIMIT 10
    `);
    console.log('Currencies found:', result.rows.length);
    console.log('Sample data:', result.rows);
    
    console.log('\nChecking market_prices table...');
    const pricesResult = await db.query(`
      SELECT * FROM market_prices LIMIT 5
    `);
    console.log('Market prices found:', pricesResult.rows.length);
    console.log('Sample data:', pricesResult.rows);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

debug();
