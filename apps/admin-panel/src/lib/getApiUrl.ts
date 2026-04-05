/**
 * API base URL for backend requests.
 * Dev: call backend directly (localhost:4000) to avoid Next.js proxy timeouts on auth.
 * Prod: use env URL or same-origin if backend is served from same host.
 */
export function getApiBaseUrl(): string {
  const envUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_URL;
  const base = (envUrl && typeof envUrl === 'string' ? envUrl : '').trim().replace(/\/$/, '');

  if (typeof window !== 'undefined') {
    const isLocalhost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';
    if (isLocalhost) {
      return base || 'http://localhost:4000';
    }
    return base || '';
  }

  return base || 'http://localhost:4000';
}
