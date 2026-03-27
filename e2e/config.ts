/**
 * E2E test configuration. Set via env or defaults.
 */
export const config = {
  baseUrl: process.env.E2E_BASE_URL || 'http://localhost:4000',
  engineUrl: process.env.E2E_ENGINE_URL || 'http://localhost:7101',
  jwt: process.env.E2E_JWT || '',
  apiKey: process.env.E2E_API_KEY || '',
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
