/**
 * Admin P2P API — uses existing /api/v1/admin/p2p, p2p/orders, p2p/disputes, p2p/ads, escrows.
 */

import { adminFetch } from './apiClient';

export async function getP2pOverview(token: string | null) {
  return adminFetch<Record<string, unknown>>('/p2p', { token });
}

export async function getP2pOrders(
  token: string | null,
  params?: { limit?: number; page?: number; status?: string; ad_id?: string }
) {
  return adminFetch<{
    orders?: unknown[];
    pagination?: { page: number; limit: number; total: number };
  }>('/p2p/orders', {
    token,
    params: params as Record<string, string | number | boolean | undefined>,
  });
}

export async function getP2pDisputes(token: string | null, params?: { limit?: number; offset?: number }) {
  return adminFetch<unknown[] | { disputes?: unknown[]; total?: number }>('/p2p/disputes', {
    token,
    params: params as Record<string, string | number | boolean | undefined>,
  });
}

export async function resolveP2pDispute(
  token: string | null,
  disputeId: string,
  body: { resolution: 'favor_buyer' | 'favor_seller' | 'cancelled'; notes?: string }
) {
  return adminFetch(`/p2p/disputes/${disputeId}/resolve`, { method: 'PATCH', token, body });
}

export async function getP2pAds(
  token: string | null,
  params?: { limit?: number; page?: number; status?: string; type?: string }
) {
  return adminFetch<{
    ads?: unknown[];
    pagination?: { page: number; limit: number; total: number };
  }>('/p2p/ads', {
    token,
    params: params as Record<string, string | number | boolean | undefined>,
  });
}

export async function getEscrows(token: string | null) {
  return adminFetch<{ escrows?: unknown[] }>('/escrows', { token });
}

export async function getP2pMerchants(
  token: string | null,
  params?: { status?: string; page?: number; limit?: number }
) {
  return adminFetch<{
    merchants?: unknown[];
    pagination?: { page: number; limit: number; total: number };
  }>('/p2p/merchants', {
    token,
    params: params as Record<string, string | number | boolean | undefined>,
  });
}

export async function reviewP2pMerchant(
  token: string | null,
  merchantId: string,
  body: { status: 'approved' | 'rejected'; note?: string }
) {
  return adminFetch(`/p2p/merchants/${merchantId}/review`, { method: 'PATCH', token, body });
}

export async function freezeEscrow(token: string | null, escrowId: string, reason?: string) {
  return adminFetch(`/escrows/${escrowId}/freeze`, { method: 'POST', token, body: { reason } });
}

export async function unfreezeEscrow(token: string | null, escrowId: string) {
  return adminFetch(`/escrows/${escrowId}/unfreeze`, { method: 'POST', token });
}
