/**
 * Replay DLQ envelopes back into MATCH_EVENTS (for reprocessing after fixes).
 * Requires `original_nats_subject` on the envelope (set when the message was DLQ'd).
 */
import { randomUUID } from 'node:crypto';
import {
  STREAM_MATCH_SETTLEMENT_DLQ,
  ensureNatsJetStreamReady,
  getJetStream,
  getNatsConnection,
} from './nats.service.js';
import { logger } from '../lib/logger.js';

type DlqEnvelopeV1 = {
  v?: number;
  phase?: string;
  payload_text?: string;
  original_nats_subject?: string;
};

export type DlqReplayResult = {
  replayed: number;
  skipped: number;
  errors: string[];
};

export async function replaySettlementDlqToMatchStream(opts: {
  startSeq: number;
  limit: number;
}): Promise<DlqReplayResult> {
  const result: DlqReplayResult = { replayed: 0, skipped: 0, errors: [] };
  const startSeq = Math.max(1, Math.floor(opts.startSeq));
  const limit = Math.min(500, Math.max(1, Math.floor(opts.limit)));

  await ensureNatsJetStreamReady();
  const nc = getNatsConnection();
  const jsm = await nc.jetstreamManager();
  const js = getJetStream();

  for (let i = 0; i < limit; i++) {
    const seq = startSeq + i;
    try {
      const sm = await jsm.streams.getMessage(STREAM_MATCH_SETTLEMENT_DLQ, { seq });
      let env: DlqEnvelopeV1;
      try {
        env = sm.json<DlqEnvelopeV1>();
      } catch {
        result.skipped++;
        result.errors.push(`seq ${seq}: invalid DLQ json`);
        continue;
      }
      const subject = env.original_nats_subject?.trim();
      if (!subject || !subject.startsWith('match.events.')) {
        result.skipped++;
        result.errors.push(`seq ${seq}: missing original_nats_subject`);
        continue;
      }
      if (!env.payload_text?.trim()) {
        result.skipped++;
        result.errors.push(`seq ${seq}: missing payload_text`);
        continue;
      }
      const payload = new TextEncoder().encode(env.payload_text);
      const msgID = `dlq-replay:${seq}:${randomUUID()}`;
      await js.publish(subject, payload, { msgID });
      result.replayed++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
        break;
      }
      result.errors.push(`seq ${seq}: ${msg}`);
    }
  }

  logger.info('DLQ replay to MATCH_EVENTS completed', result);
  return result;
}
