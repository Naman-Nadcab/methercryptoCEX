/**
 * Deterministic symbol → shard for single-writer guarantee (horizontal scale).
 */

import { config } from '../config/index.js';

/** FNV-1a style hash → shard in [0, totalShards). */
export function symbolShard(symbol: string, totalShards: number): number {
  let h = 2166136261;
  for (let i = 0; i < symbol.length; i++) {
    h ^= symbol.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % totalShards;
}

export function isOrderbookShardOwner(symbol: string): boolean {
  if (!config.nats.spotPipelineEnabled) return true;
  return symbolShard(symbol, config.nats.shardTotal) === config.nats.shardId;
}
