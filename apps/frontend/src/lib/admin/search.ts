/**
 * Admin global search API — GET /admin/search
 */

import { adminFetch } from './apiClient';

export interface AdminSearchResult {
  type: 'user' | 'order' | 'trade' | 'withdrawal' | 'transaction';
  id: string;
  label: string;
  subtitle?: string;
  href: string;
}

export interface AdminSearchResponse {
  results: AdminSearchResult[];
}

export async function adminSearch(
  token: string | null,
  query: string,
  limit = 10
): Promise<AdminSearchResponse['results']> {
  const q = query.trim();
  if (!q || q.length < 2) return [];
  const res = await adminFetch<AdminSearchResponse>('/search', {
    token,
    params: { q, limit: String(limit) },
  });
  return res.success && res.data?.results ? res.data.results : [];
}
