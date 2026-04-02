/**
 * Canonical list of matching-engine HTTP instances (URL + stable instance id).
 * Used by poller, placement, cancel targeting, and route validation.
 */
import { config } from '../../config/index.js';

export function normalizeEngineBaseUrl(u: string): string {
  return u.trim().replace(/\/$/, '');
}

export type MatchingEngineInstance = { id: string; baseUrl: string };

function dedupeBases(bases: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of bases) {
    const n = normalizeEngineBaseUrl(raw);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** All engine bases to poll (deduped). First entry is the configured primary URL. */
export function listMatchingEngineInstances(): MatchingEngineInstance[] {
  const primary = normalizeEngineBaseUrl(config.rustMatchingEngine.url);
  const extraRaw = (config.rustMatchingEngine.urlsRaw ?? '').trim();
  const extra = extraRaw
    ? extraRaw
        .split(',')
        .map((s) => normalizeEngineBaseUrl(s))
        .filter(Boolean)
    : [];
  const bases = dedupeBases([primary, ...extra]);
  const idsRaw = (config.rustMatchingEngine.instanceIdsRaw ?? '').trim();
  const idParts = idsRaw ? idsRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  if (bases.length === 1) {
    return [{ id: idParts[0] || 'default', baseUrl: bases[0]! }];
  }
  return bases.map((baseUrl, i) => ({
    id: idParts[i] || `engine_${i}`,
    baseUrl,
  }));
}

export function getMatchingEngineInstanceById(id: string): MatchingEngineInstance | undefined {
  return listMatchingEngineInstances().find((x) => x.id === id);
}

export function resolveEngineIdForBaseUrl(baseUrl: string): string | undefined {
  const n = normalizeEngineBaseUrl(baseUrl);
  for (const inst of listMatchingEngineInstances()) {
    if (inst.baseUrl === n) return inst.id;
  }
  return undefined;
}

export function getPrimaryMatchingEngineBaseUrl(): string {
  return normalizeEngineBaseUrl(config.rustMatchingEngine.url);
}
