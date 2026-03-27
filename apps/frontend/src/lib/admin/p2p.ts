/**
 * Admin P2P API — uses existing /api/v1/admin/p2p, p2p/orders, p2p/disputes, p2p/ads, escrows.
 */

import { adminFetch } from './apiClient';

export async function getP2pOverview(token: string | null) {
  return adminFetch<Record<string, unknown>>('/p2p', { token });
}

export async function getP2pOrders(
  token: string | null,
  params?: { limit?: number; offset?: number; status?: string }
) {
  return adminFetch<{ orders?: unknown[]; total?: number }>('/p2p/orders', {
    token,
    params: params as Record<string, string | number | boolean | undefined>,
  });
}

export async function getP2pDisputes(token: string | null, params?: { limit?: number; offset?: number }) {
  return adminFetch<{ disputes?: unknown[]; total?: number }>('/p2p/disputes', {
    token,
    params: params as Record<string, string | number | boolean | undefined>,
  });
}

export async function resolveP2pDispute(
  token: string | null,
  disputeId: string,
  body: { winner: 'buyer' | 'seller'; reason?: string }
) {
  return adminFetch(`/p2p/disputes/${disputeId}/resolve`, { method: 'PATCH', token, body });
}

export async function getP2pAds(token: string | null, params?: { limit?: number; offset?: number }) {
  return adminFetch<{ ads?: unknown[]; total?: number }>('/p2p/ads', {
    token,
    params: params as Record<string, string | number | boolean | undefined>,
  });
}

export async function getEscrows(token: string | null) {
  return adminFetch<{ escrows?: unknown[] }>('/escrows', { token });
}
