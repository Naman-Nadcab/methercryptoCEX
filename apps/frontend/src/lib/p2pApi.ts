/**
 * P2P API client. Uses shared api (auth + base URL).
 * Create and Release require Idempotency-Key (caller passes or we generate).
 */

import { api } from './api';

const P2P_PREFIX = '/api/v1/p2p';

export interface P2PAdRow {
  id: string;
  user_id?: string;
  ad_type?: string;
  /** Legacy / alt schema */
  type?: string;
  current_price?: string;
  price?: string;
  min_amount?: string;
  max_amount?: string;
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
  seller_payment_details?: Record<string, unknown>;
  seller_payment_display_name?: string | null;
  seller_payment_method_name?: string | null;
  seller_payment_method_code?: string | null;
  /** Buyer-submitted bank / UPI / wire reference (strict flow). */
  transaction_reference?: string | null;
  payment_proof_url?: string | null;
  payment_verification_status?: 'pending' | 'verified' | 'rejected' | string | null;
  payment_verified_at?: string | null;
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
  /** Filter ads for a merchant profile (UUID). */
  advertiser_id?: string;
  limit?: number;
  offset?: number;
}): Promise<P2PAdRow[]> {
  const q = new URLSearchParams();
  if (params.type) q.set('type', params.type);
  if (params.currency) q.set('currency', params.currency);
  if (params.fiat) q.set('fiat', params.fiat);
  if (params.advertiser_id) q.set('advertiser_id', params.advertiser_id);
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.offset != null) q.set('offset', String(params.offset));
  const res = await api.get<{ success: boolean; data?: P2PAdRow[] }>(`${P2P_PREFIX}/ads?${q.toString()}`, { skipAuth: true, notifyOnError: false });
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
    { skipAuth: true, notifyOnError: false }
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

export async function confirmPayment(
  orderId: string,
  idempotencyKey?: string,
  body?: { proof_url?: string; transaction_reference?: string }
): Promise<ApiResponse<P2POrderRow>> {
  const key = idempotencyKey ?? crypto.randomUUID();
  return api.post<P2POrderRow>(
    `${P2P_PREFIX}/orders/${encodeURIComponent(orderId)}/confirm-payment`,
    body ?? {},
    { headers: { 'Idempotency-Key': key } }
  );
}

/** Single-step mark paid: multipart proof + transaction_reference. Requires Idempotency-Key. */
export async function submitP2pOrderPay(
  orderId: string,
  params: { file: File; transactionReference: string; idempotencyKey: string }
): Promise<ApiResponse<P2POrderRow>> {
  const { getApiBaseUrl } = await import('@/lib/getApiUrl');
  const { useAuthStore } = await import('@/store/auth');
  const base = getApiBaseUrl() || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000');
  const token = useAuthStore.getState().accessToken;
  const formData = new FormData();
  formData.append('payment_proof_file', params.file);
  formData.append('transaction_reference', params.transactionReference.trim());
  const headers: Record<string, string> = {
    'Idempotency-Key': params.idempotencyKey,
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${base}/api/v1/p2p/orders/${encodeURIComponent(orderId)}/pay`, {
    method: 'POST',
    body: formData,
    headers,
    credentials: 'include',
  });
  const data = (await res.json()) as ApiResponse<P2POrderRow>;
  if (!res.ok || !data.success) {
    return { success: false, error: data?.error ?? { code: 'PAY_FAILED', message: 'Mark paid failed' } };
  }
  return { success: true, data: data.data as P2POrderRow };
}

export async function verifySellerPayment(orderId: string): Promise<ApiResponse<P2POrderRow>> {
  return api.post<P2POrderRow>(`${P2P_PREFIX}/orders/${encodeURIComponent(orderId)}/verify-payment`, {});
}

export async function uploadPaymentProof(orderId: string, file: File): Promise<ApiResponse<{ proof_url: string }>> {
  const { getApiBaseUrl } = await import('@/lib/getApiUrl');
  const { useAuthStore } = await import('@/store/auth');
  const base = getApiBaseUrl() || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000');
  const token = useAuthStore.getState().accessToken;
  const formData = new FormData();
  formData.append('file', file);
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${base}/api/v1/p2p/orders/${encodeURIComponent(orderId)}/upload-payment-proof`, {
    method: 'POST',
    body: formData,
    headers,
    credentials: 'include',
  });
  const data = await res.json();
  if (!res.ok) {
    return { success: false, error: data?.error ?? { code: 'UPLOAD_FAILED', message: 'Upload failed' } };
  }
  return { success: true, data: data.data ?? { proof_url: '' } };
}

export async function releaseOrder(orderId: string, idempotencyKey?: string): Promise<ApiResponse<P2POrderRow>> {
  const key = idempotencyKey ?? crypto.randomUUID();
  return api.post<P2POrderRow>(
    `${P2P_PREFIX}/orders/${encodeURIComponent(orderId)}/release`,
    {},
    { headers: { 'Idempotency-Key': key } }
  );
}

export async function cancelOrder(orderId: string, reason: string, idempotencyKey?: string): Promise<ApiResponse<P2POrderRow>> {
  const key = idempotencyKey ?? crypto.randomUUID();
  return api.post<P2POrderRow>(
    `${P2P_PREFIX}/orders/${encodeURIComponent(orderId)}/cancel`,
    { reason },
    { headers: { 'Idempotency-Key': key } }
  );
}

export async function openDispute(orderId: string, reason: string, evidence?: string[]): Promise<ApiResponse<{ id: string }>> {
  return api.post<{ id: string }>(
    `${P2P_PREFIX}/orders/${encodeURIComponent(orderId)}/dispute`,
    { reason, evidence }
  );
}

export async function blockAdvertiser(advertiserId: string): Promise<ApiResponse<unknown>> {
  return api.post<unknown>(`${P2P_PREFIX}/blocked-advertisers`, { advertiser_id: advertiserId });
}

export async function unblockAdvertiser(advertiserId: string): Promise<ApiResponse<unknown>> {
  return api.delete<unknown>(`${P2P_PREFIX}/blocked-advertisers/${encodeURIComponent(advertiserId)}`);
}

export interface P2POrderMessage {
  id: string;
  orderId: string;
  senderId: string;
  senderUsername?: string | null;
  message: string;
  createdAt: string;
}

export const P2P_ORDER_MESSAGES_QUERY_KEY = ['p2p', 'order-messages'] as const;

/** Fetch messages. If since (ISO timestamp) is provided, returns only messages created after that time (for polling). */
export interface P2PReferencePriceResponse {
  asset: string;
  fiat: string;
  reference_price: string;
  market: string | null;
  source: string;
  updated_at: string;
}

export async function fetchP2PReferencePrice(asset: string, fiat: string): Promise<P2PReferencePriceResponse | null> {
  const q = new URLSearchParams();
  q.set('asset', asset);
  q.set('fiat', fiat);
  const res = await api.get<P2PReferencePriceResponse>(
    `${P2P_PREFIX}/reference-price?${q.toString()}`,
    { skipAuth: true, notifyOnError: false }
  );
  if (!res.success || res.data == null) return null;
  return res.data;
}

export async function fetchP2POrderMessages(orderId: string, since?: string): Promise<P2POrderMessage[]> {
  let url = `${P2P_PREFIX}/orders/${encodeURIComponent(orderId)}/messages`;
  if (since && since.trim()) {
    url += `?since=${encodeURIComponent(since.trim())}`;
  }
  const res = await api.get<{ success: boolean; data?: P2POrderMessage[] }>(url);
  if (!res.success || !Array.isArray(res.data)) return [];
  return res.data;
}

export async function sendP2POrderMessage(orderId: string, message: string): Promise<ApiResponse<P2POrderMessage>> {
  return api.post<P2POrderMessage>(
    `${P2P_PREFIX}/orders/${encodeURIComponent(orderId)}/messages`,
    { message }
  );
}

export async function markP2POrderMessagesRead(
  orderId: string,
  lastReadMessageId?: string
): Promise<ApiResponse<unknown>> {
  return api.post<unknown>(`${P2P_PREFIX}/orders/${encodeURIComponent(orderId)}/messages/read`, {
    last_read_message_id: lastReadMessageId,
  });
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
  auto_release?: boolean;
  remarks?: string;
  auto_reply?: string;
  pricing_type?: 'fixed' | 'floating';
  float_margin_percent?: number;
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
  const body: Record<string, unknown> = {
    type: params.type,
    currency: params.currency,
    fiat: params.fiat,
    price: params.price,
    min_amount: params.min_amount,
    max_amount: params.max_amount,
    available_amount: params.available_amount,
    payment_method_ids: params.payment_method_ids,
    payment_time_limit: params.payment_time_limit ?? 15,
  };
  if (params.auto_release === true) body.auto_release = true;
  if (params.remarks != null && params.remarks !== '') body.remarks = params.remarks;
  if (params.auto_reply != null && params.auto_reply !== '') body.auto_reply = params.auto_reply;
  if (params.pricing_type === 'floating') {
    body.pricing_type = 'floating';
    if (params.float_margin_percent != null) body.float_margin_percent = params.float_margin_percent;
  }
  return api.post<CreateAdResponse>(`${P2P_PREFIX}/ads`, body);
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

/** User's own ads (dashboard / P2P v2). */
export async function fetchMyP2PAds(): Promise<Record<string, unknown>[]> {
  const res = await api.get<{ success: boolean; data?: Record<string, unknown>[] }>(`${P2P_PREFIX}/my-ads`);
  if (!res.success || !Array.isArray(res.data)) return [];
  return res.data;
}

export async function patchMyP2PAd(
  adId: string,
  updates: {
    price?: string;
    min_amount?: string;
    max_amount?: string;
    remarks?: string;
    auto_reply?: string;
    status?: 'active' | 'paused';
  }
): Promise<ApiResponse<Record<string, unknown>>> {
  return api.patch<Record<string, unknown>>(`${P2P_PREFIX}/my-ads/${encodeURIComponent(adId)}`, updates);
}

export async function deleteMyP2PAd(adId: string): Promise<ApiResponse<Record<string, unknown>>> {
  return api.delete<Record<string, unknown>>(`${P2P_PREFIX}/my-ads/${encodeURIComponent(adId)}`);
}

export type P2PDisputeDetail = Record<string, unknown> & {
  id: string;
  order_id: string;
  status: string;
  reason?: string;
  evidence?: string[] | null;
  resolution?: string | null;
  admin_notes?: string | null;
  resolved_at?: string | null;
  order_status?: string;
};

export async function fetchP2PDisputeById(disputeId: string): Promise<P2PDisputeDetail | null> {
  const res = await api.get<P2PDisputeDetail>(`${P2P_PREFIX}/disputes/${encodeURIComponent(disputeId)}`);
  if (!res.success || res.data == null) return null;
  return res.data;
}

/** P2P v2 query keys (primary UI: /p2p). */
export const P2P_V2_ADS_KEY = ['p2p-v2', 'ads'] as const;
export const P2P_V2_MY_ADS_KEY = ['p2p-v2', 'my-ads'] as const;
export const P2P_V2_ORDERS_KEY = ['p2p-v2', 'orders'] as const;
export const P2P_V2_ORDER_KEY = (id: string) => ['p2p-v2', 'order', id] as const;
export const P2P_V2_MESSAGES_KEY = (id: string) => ['p2p-v2', 'messages', id] as const;
export const P2P_V2_DISPUTE_KEY = (id: string) => ['p2p-v2', 'dispute', id] as const;
export const P2P_V2_MERCHANT_STATS_KEY = ['p2p-v2', 'merchant-stats'] as const;

export async function fetchP2PMerchantStats(): Promise<Record<string, unknown> | null> {
  const res = await api.get<{ success: boolean; data?: Record<string, unknown> | null }>(`${P2P_PREFIX}/merchant-stats`);
  if (!res.success) return null;
  return res.data ?? null;
}
