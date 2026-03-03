/**
 * API base URL for backend requests.
 * In browser: uses '' (same-origin) so Next.js proxy handles /api/v1/* → backend, avoiding CORS.
 * Env pointing to localhost:4000 is ignored in browser to force proxy usage.
 */
export function getApiBaseUrl(): string {
  const envUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_URL;
  const base = envUrl?.trim().replace(/\/$/, '') ?? '';

  if (typeof window !== 'undefined') {
    const isLocalhost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';
    const envPointsToLocalhost =
      base === 'http://localhost:4000' || base === 'http://127.0.0.1:4000';
    if (isLocalhost || envPointsToLocalhost) {
      return '';
    }
    return base || '';
  }

  return base || 'http://localhost:4000';
}
