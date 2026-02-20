/**
 * API base URL for backend requests.
 * Uses NEXT_PUBLIC_API_URL / NEXT_PUBLIC_API_BASE_URL when set (direct backend connection).
 * Otherwise in browser uses '' (same-origin, Next.js proxy); on server uses localhost:4000.
 */
export function getApiBaseUrl(): string {
  const envUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_URL;
  if (envUrl && envUrl.trim()) {
    return envUrl.trim().replace(/\/$/, '');
  }
  if (typeof window !== 'undefined') {
    return '';
  }
  return 'http://localhost:4000';
}
