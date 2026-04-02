/**
 * Lightweight health snapshot for orderbook writer (optional; workers process only).
 */

import { config } from '../config/index.js';
import {
  getLastAckedStreamSeq,
  getWriterPendingEstimate,
  getWriterProcessingLagMs,
} from './spot-orderbook-writer-state.service.js';
import { getOrderbookWriterLeaderHolder } from './orderbook-writer-leader.service.js';

export async function getOrderbookWriterHealthSnapshot(): Promise<Record<string, unknown> | null> {
  if (!config.nats.orderbookWriterEnabled || !config.nats.spotPipelineEnabled) return null;
  const leaderHolder = config.nats.writerLeaderElection ? await getOrderbookWriterLeaderHolder() : null;
  return {
    enabled: true,
    shard_id: config.nats.shardId,
    shard_total: config.nats.shardTotal,
    leader_election: config.nats.writerLeaderElection,
    leader_holder: leaderHolder,
    lag_ms: getWriterProcessingLagMs(),
    pending_messages_estimate: getWriterPendingEstimate(),
    last_spot_match_stream_seq: getLastAckedStreamSeq(),
    strict_writer_seq: config.nats.writerStrictSeq,
    dedup_redis: config.nats.writerDedupUseRedis,
  };
}
