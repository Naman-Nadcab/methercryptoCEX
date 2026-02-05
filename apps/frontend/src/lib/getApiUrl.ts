/**
 * API base URL for backend requests.
 * Supports both NEXT_PUBLIC_API_BASE_URL and NEXT_PUBLIC_API_URL (no trailing slash).
 */
export function getApiBaseUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:4000';
  return url.replace(/\/$/, '');
}
