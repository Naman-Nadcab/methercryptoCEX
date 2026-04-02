import crypto from 'node:crypto';
import { redis } from '../lib/redis.js';

const GEN_KEY = 'p2p:ads:cache_gen';

export async function bumpP2PAdsListCacheGen(): Promise<void> {
  try {
    await redis.incr(GEN_KEY);
  } catch {
    /* best-effort */
  }
}

export async function getP2PAdsCacheGeneration(): Promise<string> {
  try {
    const g = await redis.get(GEN_KEY);
    return g && g.length > 0 ? g : '0';
  } catch {
    return '0';
  }
}

export function fingerprintP2PAdsQuery(parts: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 40);
}
