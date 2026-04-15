import { db } from './database.js';

export type HotWalletsIdMode = 'chain_id' | 'blockchain_id' | 'none';

let cached: { mode: HotWalletsIdMode; at: number } | null = null;
const TTL_MS = 5 * 60 * 1000;

/**
 * Caches hot_wallets column shape — avoids 2× information_schema round-trips per request
 * (treasury hot/cold list + admin hot-wallets were each paying ~2× latency to Supabase).
 */
export async function getHotWalletsIdModeCached(): Promise<HotWalletsIdMode> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.mode;

  const [chainR, blkR] = await Promise.all([
    db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hot_wallets' AND column_name = 'chain_id' LIMIT 1`
    ),
    db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hot_wallets' AND column_name = 'blockchain_id' LIMIT 1`
    ),
  ]);
  const mode: HotWalletsIdMode =
    chainR.rows.length > 0 ? 'chain_id' : blkR.rows.length > 0 ? 'blockchain_id' : 'none';
  cached = { mode, at: now };
  return mode;
}

export function resetHotWalletsIdModeCacheForTests(): void {
  cached = null;
}
