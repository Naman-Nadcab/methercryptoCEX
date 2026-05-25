/**
 * Optional authenticated API checks (no full UI trade flow).
 * Uses `e2e/.e2e-credentials.json` from provision script or env vars.
 */
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const CRED_FILE = path.join(process.cwd(), 'e2e', '.e2e-credentials.json');

function loadCred(key: string): string | undefined {
  const fromEnv = process.env[key]?.trim();
  if (fromEnv) return fromEnv;
  if (!existsSync(CRED_FILE)) return undefined;
  try {
    const j = JSON.parse(readFileSync(CRED_FILE, 'utf8')) as Record<string, string>;
    return j[key]?.trim();
  } catch {
    return undefined;
  }
}

const API_BASE = (
  process.env.E2E_API_BASE_URL ||
  process.env.E2E_BASE_URL ||
  'http://127.0.0.1:4000'
).replace(/\/$/, '');

test.describe('API journey (credentials optional)', () => {
  test('spot markets public', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/v1/spot/markets`);
    expect(res.ok()).toBeTruthy();
    const j = (await res.json()) as { success?: boolean };
    expect(j.success).toBe(true);
  });

  test('authenticated open-orders with API key', async ({ request }) => {
    const apiKey = loadCred('E2E_API_KEY');
    test.skip(!apiKey, 'Set E2E_API_KEY or generate e2e/.e2e-credentials.json (npm run qa:e2e-credentials)');
    const res = await request.get(`${API_BASE}/api/v1/spot/open-orders`, {
      headers: { 'X-API-Key': apiKey! },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('auth/me with JWT', async ({ request }) => {
    const jwt = loadCred('E2E_JWT');
    test.skip(!jwt, 'Set E2E_JWT or generate e2e/.e2e-credentials.json');
    const res = await request.get(`${API_BASE}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(res.ok()).toBeTruthy();
  });
});
