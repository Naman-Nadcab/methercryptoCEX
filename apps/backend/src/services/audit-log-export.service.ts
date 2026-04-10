/**
 * Periodic append-only export of audit_logs_immutable + chain head for external backup / tamper detection.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';
import { auditImmutableEntryHashMatches } from './audit-log.service.js';
import { auditExportChecksumMismatchTotal, auditExportFailureTotal } from '../lib/prometheus-metrics.js';

type ExportRow = {
  id: string;
  created_at: string;
  prev_hash: string | null;
  entry_hash: string | null;
  action: string;
  actor_type: string;
  actor_id: string | null;
  request_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
  old_value: string | null;
  new_value: string | null;
  ip_address: string | null;
  user_agent: string | null;
};

async function exportBatchOnce(): Promise<{ exported: number; lastHash: string | null }> {
  const dir = path.resolve(config.auditExport.dir!);
  await fs.mkdir(dir, { recursive: true });

  const cp = await db.query<{ last_immutable_id: string | null; last_chain_hash: string | null }>(
    `SELECT last_immutable_id::text, last_chain_hash FROM audit_export_checkpoint WHERE id = 1`
  );
  const lastId = cp.rows[0]?.last_immutable_id ?? null;
  const head = await db.query<{ last_entry_hash: string }>(`SELECT last_entry_hash FROM audit_chain_state WHERE id = 1`);
  const chainHead = head.rows[0]?.last_entry_hash ?? null;

  const rows = lastId
    ? await db.query<ExportRow>(
        `SELECT id, created_at::text, prev_hash, entry_hash, action, actor_type, actor_id,
                request_id::text, resource_type, resource_id::text,
                old_value::text, new_value::text, host(ip_address)::text AS ip_address, user_agent
         FROM audit_logs_immutable
         WHERE id > $1::uuid
         ORDER BY created_at ASC, id ASC
         LIMIT 5000`,
        [lastId]
      )
    : await db.query<ExportRow>(
        `SELECT id, created_at::text, prev_hash, entry_hash, action, actor_type, actor_id,
                request_id::text, resource_type, resource_id::text,
                old_value::text, new_value::text, host(ip_address)::text AS ip_address, user_agent
         FROM audit_logs_immutable
         ORDER BY created_at ASC, id ASC
         LIMIT 5000`
      );

  if (rows.rows.length === 0) {
    return { exported: 0, lastHash: chainHead };
  }

  for (const r of rows.rows) {
    if (!auditImmutableEntryHashMatches(r)) {
      auditExportChecksumMismatchTotal.inc();
      logger.error('audit_export: entry_hash verification failed', { id: r.id, action: r.action });
      throw new Error('AUDIT_EXPORT_CHECKSUM_MISMATCH');
    }
  }

  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, `audit-export-${day}.ndjson`);
  const lines = rows.rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  const batchChecksum = createHash('sha256').update(lines, 'utf8').digest('hex');
  await fs.appendFile(file, lines, 'utf8');

  const disk = await fs.readFile(file, 'utf8');
  const tail = disk.slice(-lines.length);
  const verify = createHash('sha256').update(tail, 'utf8').digest('hex');
  if (verify !== batchChecksum) {
    auditExportChecksumMismatchTotal.inc();
    throw new Error('AUDIT_EXPORT_DISK_CHECKSUM_MISMATCH');
  }

  const maxId = rows.rows[rows.rows.length - 1]!.id;
  await db.query(
    `INSERT INTO audit_export_checkpoint (id, last_immutable_id, last_chain_hash, updated_at)
     VALUES (1, $1::uuid, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET
       last_immutable_id = EXCLUDED.last_immutable_id,
       last_chain_hash = EXCLUDED.last_chain_hash,
       updated_at = NOW()`,
    [maxId, chainHead]
  );

  logger.info('audit_export: wrote batch', {
    count: rows.rows.length,
    file,
    chainHead,
    batch_sha256: batchChecksum,
  });
  return { exported: rows.rows.length, lastHash: chainHead };
}

export async function runAuditLogExportOnce(): Promise<{ exported: number; lastHash: string | null }> {
  if (!config.auditExport.enabled || !config.auditExport.dir) {
    return { exported: 0, lastHash: null };
  }
  const maxRetries = config.auditExport.maxRetries ?? 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await exportBatchOnce();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('audit_export: attempt failed', { attempt, maxRetries, error: msg });
      if (attempt === maxRetries) break;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  auditExportFailureTotal.inc({ reason: lastErr instanceof Error ? lastErr.name : 'unknown' });
  logger.error('audit_export: failed after retries', {
    error: lastErr instanceof Error ? lastErr.message : String(lastErr),
  });
  throw lastErr;
}

export function startAuditLogExportJob(intervalMs = 300_000): NodeJS.Timeout {
  void runAuditLogExportOnce().catch((e) =>
    logger.error('audit_export: initial run failed', { error: e instanceof Error ? e.message : String(e) })
  );
  return setInterval(() => {
    void runAuditLogExportOnce().catch((e) =>
      logger.error('audit_export: run failed', { error: e instanceof Error ? e.message : String(e) })
    );
  }, intervalMs);
}
