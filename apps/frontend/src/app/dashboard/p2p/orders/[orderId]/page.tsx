'use client';

import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { useState, useRef } from 'react';
import {
  fetchOrderById,
  releaseOrder,
  confirmPayment,
  cancelOrder,
  P2P_ORDER_QUERY_KEY,
  P2P_ORDER_DETAIL_QUERY_KEY,
  type P2POrderRow,
} from '@/lib/p2pApi';

function orderStatusLabel(status: string): string {
  switch (status) {
    case 'payment_pending':
      return 'Pending Payment';
    case 'payment_confirmed':
      return 'Paid';
    case 'completed':
      return 'Released';
    case 'cancelled':
      return 'Cancelled';
    case 'expired':
      return 'Expired';
    case 'disputed':
      return 'Disputed';
    default:
      return status;
  }
}

export default function P2POrderDetailPage() {
  const params = useParams();
  const queryClient = useQueryClient();
  const { accessToken, _hasHydrated, user } = useAuthStore();
  const orderId = typeof params?.orderId === 'string' ? params.orderId : '';

  const [confirmLoading, setConfirmLoading] = useState(false);
  const [releaseLoading, setReleaseLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const releaseIdempotencyKeyRef = useRef<string | null>(null);

  const { data: order, isLoading } = useQuery({
    queryKey: [...P2P_ORDER_DETAIL_QUERY_KEY, orderId],
    queryFn: () => fetchOrderById(orderId),
    enabled: !!orderId && !!_hasHydrated && !!accessToken,
  });
  const isBuyer = !!(order && user && order.buyer_id === user.id);
  const isSeller = !!(order && user && order.seller_id === user.id);
  const canConfirmPayment = isBuyer && order?.status === 'payment_pending';
  const canRelease = isSeller && order?.status === 'payment_confirmed';
  const canCancel = (isBuyer || isSeller) && order?.status === 'payment_pending';

  const handleConfirmPayment = async () => {
    if (!orderId || !canConfirmPayment || confirmLoading) return;
    setActionError(null);
    setActionSuccess(null);
    setConfirmLoading(true);
    try {
      const res = await confirmPayment(orderId);
      if (res.success) {
        queryClient.invalidateQueries({ queryKey: ['balances'] });
        queryClient.invalidateQueries({ queryKey: P2P_ORDER_QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: [...P2P_ORDER_DETAIL_QUERY_KEY, orderId] });
        setActionSuccess('Payment confirmed. Waiting for seller to release.');
        setTimeout(() => setActionSuccess(null), 5000);
      } else {
        setActionError(res.error?.message ?? 'Could not confirm payment. Please try again.');
      }
    } catch (e) {
      setActionError('Connection issue. Safe to try again—no action was taken.');
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleRelease = async () => {
    if (!orderId || !canRelease || releaseLoading) return;
    setActionError(null);
    setActionSuccess(null);
    if (releaseIdempotencyKeyRef.current === null) {
      releaseIdempotencyKeyRef.current = crypto.randomUUID();
    }
    const idempotencyKey = releaseIdempotencyKeyRef.current;
    setReleaseLoading(true);
    try {
      const res = await releaseOrder(orderId, idempotencyKey);
      if (res.success) {
        releaseIdempotencyKeyRef.current = null;
        queryClient.invalidateQueries({ queryKey: ['balances'] });
        queryClient.invalidateQueries({ queryKey: P2P_ORDER_QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: [...P2P_ORDER_DETAIL_QUERY_KEY, orderId] });
        setActionSuccess('Crypto released. Funds have been transferred to the buyer.');
        setTimeout(() => setActionSuccess(null), 5000);
      } else {
        if (res.error?.code === 'RELEASE_FAILED' || res.error?.code === 'NOT_FOUND') {
          releaseIdempotencyKeyRef.current = null;
        }
        setActionError(res.error?.message ?? 'Could not release. Please try again.');
      }
    } catch (e) {
      setActionError('Connection issue. Safe to try again—no funds have been moved.');
    } finally {
      setReleaseLoading(false);
    }
  };

  const handleCancel = async () => {
    const reason = cancelReason.trim();
    if (!orderId || !canCancel || cancelLoading || reason.length < 1 || reason.length > 500) return;
    setActionError(null);
    setActionSuccess(null);
    setCancelLoading(true);
    try {
      const res = await cancelOrder(orderId, reason);
      if (res.success) {
        queryClient.invalidateQueries({ queryKey: ['balances'] });
        queryClient.invalidateQueries({ queryKey: P2P_ORDER_QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: [...P2P_ORDER_DETAIL_QUERY_KEY, orderId] });
        setCancelReason('');
        setActionSuccess('Order cancelled. Locked funds have been returned.');
        setTimeout(() => setActionSuccess(null), 5000);
      } else {
        setActionError(res.error?.message ?? 'Could not cancel. Please try again.');
      }
    } catch (e) {
      setActionError('Connection issue. Safe to try again—no action was taken.');
    } finally {
      setCancelLoading(false);
    }
  };

  if (!_hasHydrated || !accessToken) {
    return (
      <div className="min-h-screen bg-[#0b0e11] flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 mb-4">You must be logged in to view this order.</p>
          <Link href="/login" className="text-blue-400 hover:underline">Log in</Link>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0b0e11] flex items-center justify-center gap-2">
        <span className="inline-block w-5 h-5 border-2 border-gray-600 border-t-gray-400 rounded-full animate-spin" />
        <p className="text-gray-400">Loading order…</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-[#0b0e11] flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 mb-4">Order not found.</p>
          <Link href="/dashboard/p2p" className="text-blue-400 hover:underline">Back to P2P</Link>
        </div>
      </div>
    );
  }

  const statusLabel = orderStatusLabel(order.status);
  const statusVariant =
    order.status === 'payment_pending'
      ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
      : order.status === 'payment_confirmed'
        ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
        : order.status === 'completed'
          ? 'bg-green-500/20 text-green-400 border-green-500/30'
          : order.status === 'cancelled' || order.status === 'expired'
            ? 'bg-gray-500/20 text-gray-400 border-gray-500/30'
            : 'bg-gray-500/20 text-gray-400 border-gray-500/30';

  return (
    <div className="min-h-screen bg-[#0b0e11] text-white">
      <div className="max-w-2xl py-8 mx-auto">
        <Link href="/dashboard/p2p" className="text-sm text-gray-400 hover:text-white mb-6 inline-block transition-colors duration-100">← Back to P2P</Link>
        <h1 className="text-xl font-bold mb-2 tracking-tight tabular-nums">Order {order.id.slice(0, 8)}…</h1>
        <p className="text-sm mb-6 flex items-center gap-2">
          <span className="text-gray-400">Status:</span>
          <span className={`inline-flex px-2.5 py-1 rounded-md text-xs font-medium border ${statusVariant}`}>{statusLabel}</span>
        </p>

        <div className="rounded-xl border border-gray-800 bg-[#181a20] p-6 space-y-4">
          <div className="flex justify-between items-baseline py-1"><span className="text-gray-500 text-sm">Quantity</span><span className="font-medium tabular-nums">{order.quantity} {order.crypto_symbol ?? 'Crypto'}</span></div>
          {order.fiat_amount != null && <div className="flex justify-between items-baseline py-1"><span className="text-gray-500 text-sm">Fiat amount</span><span className="tabular-nums">{order.fiat_currency ?? ''} {order.fiat_amount}</span></div>}
          <div className="flex justify-between items-baseline py-1"><span className="text-gray-500 text-sm">Buyer</span><span>{order.buyer_username ?? order.buyer_id}</span></div>
          <div className="flex justify-between items-baseline py-1"><span className="text-gray-500 text-sm">Seller</span><span>{order.seller_username ?? order.seller_id}</span></div>
        </div>

        {(order.status === 'payment_pending' || order.status === 'payment_confirmed') && (
          <p className="text-xs text-gray-500 mt-2">Funds are secured in escrow. Release occurs after seller confirmation.</p>
        )}

        {actionSuccess && (
          <div className="mt-4 p-4 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm transition-opacity duration-200">
            {actionSuccess}
          </div>
        )}
        {actionError && (
          <div className="mt-4 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm transition-opacity duration-200">
            {actionError}
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          {canConfirmPayment && (
            <button
              type="button"
              disabled={confirmLoading}
              onClick={handleConfirmPayment}
              aria-busy={confirmLoading}
              className="px-4 py-2.5 rounded-lg bg-blue-500 hover:bg-blue-600 active:scale-[0.98] text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 transition-colors duration-100"
            >
              {confirmLoading && <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {confirmLoading ? 'Confirming…' : 'I have paid'}
            </button>
          )}
          {canRelease && (
            <button
              type="button"
              disabled={releaseLoading}
              onClick={handleRelease}
              aria-busy={releaseLoading}
              className="px-4 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 active:scale-[0.98] text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 transition-colors duration-100"
            >
              {releaseLoading && <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {releaseLoading ? 'Releasing…' : 'Release crypto'}
            </button>
          )}
          {canCancel && (
            <div className="flex flex-wrap items-end gap-2">
              <input
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Cancel reason (required)"
                maxLength={500}
                className="flex-1 min-w-[200px] rounded-lg border border-gray-700 bg-[#0b0e11] px-3 py-2.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-shadow duration-150"
              />
              <button
                type="button"
                disabled={cancelLoading || cancelReason.trim().length < 1}
                onClick={handleCancel}
                aria-busy={cancelLoading}
                className="px-4 py-2.5 rounded-lg bg-gray-600 hover:bg-gray-700 active:scale-[0.98] text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 transition-colors duration-100"
              >
                {cancelLoading && <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                {cancelLoading ? 'Cancelling…' : 'Cancel order'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
