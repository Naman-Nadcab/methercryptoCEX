/**
 * Mutable writer state for snapshots, stream offset, and per-symbol writer_seq tracking.
 */

let lastAckedStreamSeq = 0;
const lastWriterSeqBySymbol = new Map<string, number>();
const perSymbolLastEventKey = new Map<string, string>();

export function resetWriterRuntimeState(): void {
  lastAckedStreamSeq = 0;
  lastWriterSeqBySymbol.clear();
  perSymbolLastEventKey.clear();
  lastProcessEndMs = Date.now();
  lastPendingEstimate = 0;
}

export function initWriterStateFromSnapshot(meta: {
  lastSpotMatchStreamSeq: number;
  perSymbolWriterSeq: Record<string, number>;
  perSymbolLastEventKey: Record<string, string>;
}): void {
  lastAckedStreamSeq = meta.lastSpotMatchStreamSeq;
  lastWriterSeqBySymbol.clear();
  for (const [k, v] of Object.entries(meta.perSymbolWriterSeq)) {
    lastWriterSeqBySymbol.set(k.toUpperCase(), v);
  }
  perSymbolLastEventKey.clear();
  for (const [k, v] of Object.entries(meta.perSymbolLastEventKey)) {
    perSymbolLastEventKey.set(k.toUpperCase(), v);
  }
}

export function recordStreamMessageAcked(streamSeq: number): void {
  if (streamSeq > lastAckedStreamSeq) lastAckedStreamSeq = streamSeq;
}

export function getLastAckedStreamSeq(): number {
  return lastAckedStreamSeq;
}

export function getPrevWriterSeq(symbol: string): number {
  return lastWriterSeqBySymbol.get(symbol.toUpperCase()) ?? 0;
}

export function setWriterSeq(symbol: string, seq: number): void {
  const s = symbol.toUpperCase();
  lastWriterSeqBySymbol.set(s, seq);
}

export function setLastEventKey(symbol: string, key: string): void {
  perSymbolLastEventKey.set(symbol.toUpperCase(), key);
}

export function exportWriterSeqSnapshot(): {
  lastSpotMatchStreamSeq: number;
  perSymbolWriterSeq: Record<string, number>;
  perSymbolLastEventKey: Record<string, string>;
} {
  return {
    lastSpotMatchStreamSeq: lastAckedStreamSeq,
    perSymbolWriterSeq: Object.fromEntries(lastWriterSeqBySymbol),
    perSymbolLastEventKey: Object.fromEntries(perSymbolLastEventKey),
  };
}

/** In-process lag estimate: time since last successful apply ended (ms). */
let lastProcessEndMs = Date.now();
export function markWriterProcessEnd(): void {
  lastProcessEndMs = Date.now();
}

/** Time since last successful apply ended. When JetStream pending is 0, idle time is not "processing lag". */
export function getWriterProcessingLagMs(): number {
  const idleMs = Math.max(0, Date.now() - lastProcessEndMs);
  if (lastPendingEstimate <= 0) return 0;
  return idleMs;
}

let lastPendingEstimate = 0;
export function setWriterPendingEstimate(n: number): void {
  lastPendingEstimate = n;
}

export function getWriterPendingEstimate(): number {
  return lastPendingEstimate;
}
