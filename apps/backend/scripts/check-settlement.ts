import 'dotenv/config';
import { db } from '../src/lib/database.js';

async function main() {
  const cursor = await db.query('SELECT engine_id, last_after_id::text FROM settlement_engine_poll_cursor LIMIT 5');
  console.log('Poll Cursor:', JSON.stringify(cursor.rows));
  
  const events = await db.query("SELECT id::text, match_engine_id, engine_event_id, status, created_at FROM settlement_events ORDER BY created_at DESC LIMIT 10");
  console.log('Recent Settlement Events:', JSON.stringify(events.rows, null, 2));
  
  const orders = await db.query("SELECT id::text, side, status, price::text, quantity::text, created_at FROM spot_orders ORDER BY created_at DESC LIMIT 6");
  console.log('Recent Orders:', JSON.stringify(orders.rows, null, 2));
  
  await db.close();
}
main().catch(e => { console.error(e); process.exit(1); });
