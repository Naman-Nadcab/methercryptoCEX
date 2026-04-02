/**
 * E2E test configuration. Set via env or defaults.
 *
 * Trading: `E2E_JWT` (Bearer) or `E2E_API_KEY` for POST /spot/order.
 * WebSocket soak: `E2E_WS_SOAK_MS` (default 12000, max ~310000 for 5min), `E2E_SPOT_SYMBOL`.
 * Health: `E2E_ALLOW_DEGRADED_HEALTH=true` allows Phase 1 pass when DB is up but /health is 503.
 * Private WS (Phase 14): `E2E_COUNTERPARTY_JWT` (+ optional `E2E_COUNTERPARTY_API_KEY` for taker REST).
 */
export const config = {
  baseUrl: process.env.E2E_BASE_URL || 'http://localhost:4000',
  engineUrl: process.env.E2E_ENGINE_URL || 'http://localhost:7101',
  jwt: process.env.E2E_JWT || '',
  apiKey: process.env.E2E_API_KEY || '',
  /** Second user JWT for Spot WS `auth` + REST when testing cross-user fills. */
  counterpartyJwt: process.env.E2E_COUNTERPARTY_JWT || '',
  adminEmail: process.env.E2E_ADMIN_EMAIL || '',
  adminPassword: process.env.E2E_ADMIN_PASSWORD || '',
  timeoutMs: Number(process.env.E2E_TIMEOUT_MS) || 10_000,
};

export function getAuthHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.jwt) h['Authorization'] = `Bearer ${config.jwt}`;
  if (config.apiKey) h['X-API-Key'] = config.apiKey;
  return h;
}

/** Taker / second-user REST headers (JWT and/or API key). */
export function getCounterpartyRestHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const k = process.env.E2E_COUNTERPARTY_API_KEY?.trim();
  if (k) h['X-API-Key'] = k;
  if (config.counterpartyJwt.trim()) h['Authorization'] = `Bearer ${config.counterpartyJwt.trim()}`;
  return h;
}
