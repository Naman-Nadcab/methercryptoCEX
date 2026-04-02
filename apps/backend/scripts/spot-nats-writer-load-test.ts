/**
 * Load harness: publish synthetic spot.match.* to JetStream (SPOT_MATCH).
 *
 * Usage:
 *   NATS_URL=nats://127.0.0.1:4222 npx tsx scripts/spot-nats-writer-load-test.ts [options]
 *
 * Options:
 *   --symbol BTC_USDT          Single symbol (default)
 *   --symbols BTC_USDT,ETH_USDT   Multi-symbol round-robin
 *   --rate 5000                Target msgs/sec aggregate
 *   --seconds 10
 *   --burst                    First 20% of window at 3x rate, then baseline
 *   --burst-mult 3
 *
 * Failure injection (manual): stop the writer process or bounce NATS while this runs; verify
 * leader failover, no duplicate apply (dedup), and recovery via snapshot + stream seq.
 */

import { connect } from 'nats';
import { TextEncoder } from 'node:util';

const te = new TextEncoder();

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  return def;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const url = process.env.NATS_URL || 'nats://127.0.0.1:4222';
  const symbolsCsv = arg('--symbols', '');
  const single = arg('--symbol', 'BTC_USDT');
  const symbols = (symbolsCsv ? symbolsCsv.split(',') : [single]).map((s) => s.trim().toUpperCase().replace(/-/g, '_')).filter(Boolean);
  const rate = parseInt(arg('--rate', '2000'), 10) || 2000;
  const seconds = parseInt(arg('--seconds', '5'), 10) || 5;
  const burst = hasFlag('--burst');
  const burstMult = parseFloat(arg('--burst-mult', '3')) || 3;

  const nc = await connect({ servers: url.split(',').map((s) => s.trim()) });
  const js = nc.jetstream();

  const burstPhaseMs = burst ? Math.floor(seconds * 1000 * 0.2) : 0;
  const end = Date.now() + seconds * 1000;
  let n = 0;
  const seqBySymbol = Object.fromEntries(symbols.map((s) => [s, 0])) as Record<string, number>;

  console.log(
    `Publishing spot.match.{${symbols.join(',')}} at ~${rate}/s for ${seconds}s` +
      (burst ? ` (burst first ${burstPhaseMs}ms @ ${burstMult}x)` : '') +
      '...'
  );

  while (Date.now() < end) {
    const t0 = Date.now();
    const elapsed = t0 - (end - seconds * 1000);
    const effectiveRate = burst && elapsed < burstPhaseMs ? Math.min(rate * burstMult, 80_000) : rate;
    const intervalMs = 1000 / Math.min(effectiveRate, 50_000);
    const symbol = symbols[n % symbols.length]!;
    seqBySymbol[symbol] = (seqBySymbol[symbol] ?? 0) + 1;
    const seq = seqBySymbol[symbol]!;
    n += 1;
    const payload = {
      kind: 'match' as const,
      symbol,
      event_key: `loadtest:${symbol}:${seq}:${Date.now()}`,
      timestamp: Date.now(),
      source: 'js' as const,
      taker_side: 'buy' as const,
      base: symbol.split('_')[0] ?? 'BTC',
      quote: symbol.split('_')[1] ?? 'USDT',
      quote_precision: 8,
      writer_seq: seq,
      trades: [
        {
          price: '50000',
          quantity: '0.0001',
          taker_user_id: 'taker-load',
          maker_user_id: 'maker-load',
        },
      ],
    };
    await js.publish(`spot.match.${symbol}`, te.encode(JSON.stringify(payload)), { msgID: payload.event_key });
    const loopElapsed = Date.now() - t0;
    const wait = Math.max(0, intervalMs - loopElapsed);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  await nc.drain();
  console.log(`Done. Published ${n} messages. Per-symbol seq:`, seqBySymbol);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
