/**
 * P2P API client. Uses shared api (auth + base URL).
 * Create and Release require Idempotency-Key (caller passes or we generate).
 */

import { api } from './api';

const P2P_PREFIX = '/api/v1/p2p';

export interface P2PAdRow {
  id: string;
  ad_type: string;
  current_price: string;
  min_amount: string;
  max_amount: string;
  available_amount: string;
  username: string;
  crypto_symbol: string;
  fiat_currency: string;
  payment_time_limit?: number;
  total_orders?: number;
  completed_orders?: number;
  merchant_total_orders?: number;
  merchant_completion_rate?: string | null;
  accepted_payment_methods?: string[] | unknown;
  /** Platform method IDs (p2p_payment_methods.id) the ad accepts. For order modal intersection. */
  accepted_platform_method_ids?: string[];
}

export interface P2POrderRow {
  id: string;
  ad_id: string;
  buyer_id: string;
  seller_id: string;
  status: string;
  quantity: string;
  fiat_amount?: string;
  payment_method_id?: string;
  escrow_id?: string;
  expires_at?: string;
  payment_confirmed_at?: string | null;
  released_at?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  crypto_symbol?: string;
  buyer_username?: string;
  seller_username?: string;
  fiat_currency?: string;
  created_at?: string;
}

export interface P2PPaymentMethodRow {
  id: string;
  payment_method_id?: string;
  method_name: string;
  method_code?: string;
  method_type?: string;
  display_name?: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function idempotencyHeaders(): Record<string, string> {
  return { 'Idempotency-Key': crypto.randomUUID() };
}

export async function fetchP2PAds(params: {
  type?: string;
  currency?: string;
  fiat?: string;
  limit?: number;
  offset?: number;
}): Promise<P2PAdRow[]> {
  const q = new URLSearchParams();
  if (params.type) q.set('type', params.type);
  if (params.currency) q.set('currency', params.currency);
  if (params.fiat) q.set('fiat', params.fiat);
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.offset != null) q.set('offset', String(params.offset));
  const res = await api.get<{ success: boolean; data?: P2PAdRow[] }>(`${P2P_PREFIX}/ads?${q.toString()}`);
  if (!res.success || !Array.isArray(res.data)) return [];
  return res.data;
}

export async function fetchMyOrders(status?: string): Promise<P2POrderRow[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  const res = await api.get<{ success: boolean; data?: P2POrderRow[] }>(`${P2P_PREFIX}/my-orders${q}`);
  if (!res.success || !Array.isArray(res.data)) return [];
  return res.data;
}

/** Dedicated fetch for order detail. Use with queryKey ['p2p', 'order', orderId]. */
export async function fetchOrderById(orderId: string): Promise<P2POrderRow | null> {
  const res = await api.get<{ success: boolean; data?: P2POrderRow; error?: { code: string } }>(
    `${P2P_PREFIX}/orders/${encodeURIComponent(orderId)}`
  );
  if (!res.success || !res.data) return null;
  return res.data as unknown as P2POrderRow;
}

export async function fetchMyPaymentMethods(opts?: { includeInactive?: boolean }): Promise<P2PPaymentMethodRow[]> {
  const q = opts?.includeInactive ? '?include_inactive=1' : '';
  const res = await api.get<{ success: boolean; data?: P2PPaymentMethodRow[]; error?: { message?: string } }>(`${P2P_PREFIX}/my-payment-methods${q}`);
  if (!res.success) {
    throw new Error(res.error?.message ?? 'Failed to fetch payment methods');
  }
  if (!Array.isArray(res.data)) {
    throw new Error('Invalid payment methods response');
  }
  return res.data;
}

export interface PlatformPaymentMethod {
  id: string;
  name: string;
  code?: string;
  method_type?: string;
}

export async function fetchPlatformPaymentMethods(): Promise<PlatformPaymentMethod[]> {
  const res = await api.get<{ success: boolean; data?: PlatformPaymentMethod[]; error?: { message?: string } }>(
    `${P2P_PREFIX}/payment-methods`,
    { notifyOnError: false }
  );
  if (!res.success) {
    throw new Error(res.error?.message ?? 'Failed to load payment types');
  }
  if (res.data == null) {
    throw new Error('Invalid platform payment methods response');
  }
  if (!Array.isArray(res.data)) {
    throw new Error('Invalid platform payment methods response');
  }
  return res.data;
}

export async function createOrder(params: {
  adId: string;
  quantity: string;
  paymentMethodId: string;
  idempotencyKey?: string;
}): Promise<ApiResponse<P2POrderRow>> {
  const key = params.idempotencyKey ?? crypto.randomUUID();
  return api.post<P2POrderRow>(
    `${P2P_PREFIX}/orders`,
    { adId: params.adId, quantity: params.quantity, paymentMethodId: params.paymentMethodId },
    { headers: { 'Idempotency-Key': key } }
  );
}

export async function confirmPayment(orderId: string): Promise<ApiResponse<P2POrderRow>> {
  return api.post<P2POrderRow>(`${P2P_PREFIX}/orders/${encodeURIComponent(orderId)}/confirm-payment`, {});
}

export async function releaseOrder(orderId: string, idempotencyKey?: string): Promise<ApiResponse<P2POrderRow>> {
  const key = idempotencyKey ?? crypto.randomUUID();
  return api.post<P2POrderRow>(
    `${P2P_PREFIX}/orders/${encodeURIComponent(orderId)}/release`,
    {},
    { headers: { 'Idempotency-Key': key } }
  );
}

export async function cancelOrder(orderId: string, reason: string): Promise<ApiResponse<P2POrderRow>> {
  return api.post<P2POrderRow>(
    `${P2P_PREFIX}/orders/${encodeURIComponent(orderId)}/cancel`,
    { reason }
  );
}

export interface CreateAdParams {
  type: 'buy' | 'sell';
  currency: string;
  fiat: string;
  price: string;
  min_amount: string;
  max_amount: string;
  available_amount: string;
  payment_method_ids: string[];
  payment_time_limit?: number;
}

export interface CreateAdResponse {
  id: string;
  ad_type: string;
  crypto_currency_id?: string;
  fiat_currency: string;
  current_price: string;
  min_amount: string;
  max_amount: string;
  available_amount: string;
  payment_time_limit?: number;
  accepted_payment_methods?: unknown;
  status: string;
  created_at?: string;
}

export async function createAd(params: CreateAdParams): Promise<ApiResponse<CreateAdResponse>> {
  return api.post<CreateAdResponse>(`${P2P_PREFIX}/ads`, {
    type: params.type,
    currency: params.currency,
    fiat: params.fiat,
    price: params.price,
    min_amount: params.min_amount,
    max_amount: params.max_amount,
    available_amount: params.available_amount,
    payment_method_ids: params.payment_method_ids,
    payment_time_limit: params.payment_time_limit ?? 15,
  });
}

export interface AddPaymentMethodParams {
  payment_method_id: string;
  payment_details?: Record<string, unknown>;
  display_name?: string;
}

export async function addPaymentMethod(params: AddPaymentMethodParams): Promise<ApiResponse<P2PPaymentMethodRow>> {
  return api.post<P2PPaymentMethodRow>(`${P2P_PREFIX}/my-payment-methods`, params);
}

export async function updatePaymentMethod(
  id: string,
  updates: { is_active?: boolean; payment_details?: Record<string, unknown>; display_name?: string }
): Promise<ApiResponse<P2PPaymentMethodRow>> {
  return api.patch<P2PPaymentMethodRow>(`${P2P_PREFIX}/my-payment-methods/${encodeURIComponent(id)}`, updates);
}

export async function deletePaymentMethod(id: string): Promise<ApiResponse<{ deleted: boolean; id: string }>> {
  return api.delete<{ deleted: boolean; id: string }>(`${P2P_PREFIX}/my-payment-methods/${encodeURIComponent(id)}`);
}

export const P2P_ORDER_QUERY_KEY = ['p2p', 'my-orders'] as const;
export const P2P_ORDER_DETAIL_QUERY_KEY = ['p2p', 'order'] as const;
export const P2P_ADS_QUERY_KEY = ['p2p', 'ads'] as const;
export const P2P_PAYMENT_METHODS_QUERY_KEY = ['p2p', 'my-payment-methods'] as const;
