import 'dotenv/config';
import { redis } from '../src/lib/redis.js';
import { getSettlementCircuitOpen, getTradingHalted } from '../src/lib/trading-halt.js';

async function main() {
  const circuit = await getSettlementCircuitOpen();
  console.log('settlement_circuit:open =', circuit);
  
  const halt = await getTradingHalted();
  console.log('trading_halt:global =', halt);
  
  await redis.close();
}
main().catch(e => { console.error(e); process.exit(1); });
