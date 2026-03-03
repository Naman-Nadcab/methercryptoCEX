'use client';

import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';
import {
  fetchOrderById,
  releaseOrder,
  confirmPayment,
  cancelOrder,
  openDispute,
  fetchP2POrderMessages,
  sendP2POrderMessage,
  P2P_ORDER_QUERY_KEY,
  P2P_ORDER_DETAIL_QUERY_KEY,
  P2P_ORDER_MESSAGES_QUERY_KEY,
  type P2POrderRow,
  type P2POrderMessage,
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
  const [disputeLoading, setDisputeLoading] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [minutesLeft, setMinutesLeft] = useState<number | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const releaseIdempotencyKeyRef = useRef<string | null>(null);
  const confirmIdempotencyKeyRef = useRef<string | null>(null);
  const cancelIdempotencyKeyRef = useRef<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const { data: order, isLoading } = useQuery({
    queryKey: [...P2P_ORDER_DETAIL_QUERY_KEY, orderId],
    queryFn: () => fetchOrderById(orderId),
    enabled: !!orderId && !!_hasHydrated && !!accessToken,
  });
  const queryKey = [...P2P_ORDER_MESSAGES_QUERY_KEY, orderId] as const;
  const { data: messages = [] } = useQuery({
    queryKey,
    queryFn: () => fetchP2POrderMessages(orderId),
    enabled: !!orderId && !!_hasHydrated && !!accessToken && !!order,
    refetchInterval: false,
  });
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Poll for new messages using since= to reduce payload
  useEffect(() => {
    if (!orderId || !order || !accessToken) return;
    const key = [...P2P_ORDER_MESSAGES_QUERY_KEY, orderId] as const;
    const intervalMs = 5000;
    const t = setInterval(async () => {
      const current = queryClient.getQueryData<P2POrderMessage[]>(key) ?? [];
      const lastCreatedAt = current.length > 0 ? current[current.length - 1].createdAt : undefined;
      if (!lastCreatedAt) return;
      const newMsgs = await fetchP2POrderMessages(orderId, lastCreatedAt);
      if (newMsgs.length > 0) {
        const existingIds = new Set(current.map((m) => m.id));
        const toAppend = newMsgs.filter((m) => !existingIds.has(m.id));
        if (toAppend.length > 0) {
          queryClient.setQueryData<P2POrderMessage[]>(key, [...current, ...toAppend]);
        }
      }
    }, intervalMs);
    return () => clearInterval(t);
  }, [orderId, order, accessToken, queryClient]);

  useEffect(() => {
    if (!order?.expires_at || order.status !== 'payment_pending') return;
    const tick = () => {
      const expiresAt = new Date(order.expires_at!).getTime();
      const diff = expiresAt - Date.now();
      setMinutesLeft(diff > 0 ? Math.ceil(diff / 60000) : 0);
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [order?.expires_at, order?.status]);

  const handleOpenDispute = async () => {
    const reason = disputeReason.trim();
    if (!orderId || !canOpenDispute || disputeLoading || reason.length < 10 || reason.length > 1000) return;
    setActionError(null);
    setActionSuccess(null);
    setDisputeLoading(true);
    try {
      const res = await openDispute(orderId, reason);
      if (res.success) {
        setShowDisputeModal(false);
        setDisputeReason('');
        queryClient.invalidateQueries({ queryKey: P2P_ORDER_QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: [...P2P_ORDER_DETAIL_QUERY_KEY, orderId] });
        setActionSuccess('Dispute opened. Our team will review shortly.');
        setTimeout(() => setActionSuccess(null), 5000);
      } else {
        setActionError(res.error?.message ?? 'Could not open dispute. Please try again.');
      }
    } catch (e) {
      setActionError('Connection issue. Please try again.');
    } finally {
      setDisputeLoading(false);
    }
  };
  const isBuyer = !!(order && user && order.buyer_id === user.id);
  const isSeller = !!(order && user && order.seller_id === user.id);
  const canConfirmPayment = isBuyer && order?.status === 'payment_pending';
  const canRelease = isSeller && order?.status === 'payment_confirmed';
  const canCancel = (isBuyer || isSeller) && order?.status === 'payment_pending';
  const canOpenDispute = (isBuyer || isSeller) && order?.status === 'payment_confirmed';

  const handleConfirmPayment = async () => {
    if (!orderId || !canConfirmPayment || confirmLoading) return;
    setActionError(null);
    setActionSuccess(null);
    if (confirmIdempotencyKeyRef.current === null) {
      confirmIdempotencyKeyRef.current = crypto.randomUUID();
    }
    setConfirmLoading(true);
    try {
      const res = await confirmPayment(orderId, confirmIdempotencyKeyRef.current);
      if (res.success) {
        confirmIdempotencyKeyRef.current = null;
        queryClient.invalidateQueries({ queryKey: ['balances'] });
        queryClient.invalidateQueries({ queryKey: P2P_ORDER_QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: [...P2P_ORDER_DETAIL_QUERY_KEY, orderId] });
        setActionSuccess('Payment confirmed. Waiting for seller to release.');
        setTimeout(() => setActionSuccess(null), 5000);
      } else {
        if (res.error?.code === 'CONFIRM_FAILED' || res.error?.code === 'NOT_FOUND') {
          confirmIdempotencyKeyRef.current = null;
        }
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
    if (cancelIdempotencyKeyRef.current === null) {
      cancelIdempotencyKeyRef.current = crypto.randomUUID();
    }
    setCancelLoading(true);
    try {
      const res = await cancelOrder(orderId, reason, cancelIdempotencyKeyRef.current);
      if (res.success) {
        cancelIdempotencyKeyRef.current = null;
        queryClient.invalidateQueries({ queryKey: ['balances'] });
        queryClient.invalidateQueries({ queryKey: P2P_ORDER_QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: [...P2P_ORDER_DETAIL_QUERY_KEY, orderId] });
        setCancelReason('');
        setActionSuccess('Order cancelled. Locked funds have been returned.');
        setTimeout(() => setActionSuccess(null), 5000);
      } else {
        if (res.error?.code === 'CANCEL_FAILED' || res.error?.code === 'NOT_FOUND') {
          cancelIdempotencyKeyRef.current = null;
        }
        setActionError(res.error?.message ?? 'Could not cancel. Please try again.');
      }
    } catch (e) {
      setActionError('Connection issue. Safe to try again—no action was taken.');
    } finally {
      setCancelLoading(false);
    }
  };

  const handleSendMessage = async () => {
    const text = chatInput.trim();
    if (!orderId || !text || chatSending) return;
    setChatSending(true);
    setChatInput('');
    try {
      const res = await sendP2POrderMessage(orderId, text);
      if (res.success && res.data) {
        queryClient.invalidateQueries({ queryKey: [...P2P_ORDER_MESSAGES_QUERY_KEY, orderId] });
      } else {
        setChatInput(text);
      }
    } catch {
      setChatInput(text);
    } finally {
      setChatSending(false);
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

        {isBuyer && order.status === 'payment_pending' && order.seller_payment_details && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <h3 className="text-sm font-semibold text-amber-400 mb-2">Pay to this account</h3>
            <p className="text-xs text-gray-500 mb-2">{order.seller_payment_display_name ?? order.seller_payment_method_name ?? 'Payment method'}</p>
            <div className="space-y-1.5">
              {Object.entries(order.seller_payment_details as Record<string, unknown>).map(([key, val]) => (
                val != null && String(val).trim() && (
                  <div key={key} className="flex justify-between items-center gap-2">
                    <span className="text-gray-500 text-xs capitalize">{key.replace(/_/g, ' ')}</span>
                    <span className="font-mono text-sm text-white truncate max-w-[200px]" title={String(val)}>{String(val)}</span>
                  </div>
                )
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">Transfer exactly {order.fiat_currency} {order.fiat_amount} to the details above.</p>
          </div>
        )}

        {order.status === 'payment_pending' && minutesLeft != null && minutesLeft >= 0 && (
          <div className={`mt-4 p-4 rounded-xl border flex items-center justify-between ${
            minutesLeft <= 5 ? 'bg-amber-500/10 border-amber-500/40' : 'bg-blue-500/5 border-blue-500/30'
          }`}>
            <span className="text-sm text-gray-400">Time to pay</span>
            <span className={`text-2xl font-bold tabular-nums ${minutesLeft <= 5 ? 'text-amber-400' : 'text-blue-400'}`}>
              {minutesLeft > 0 ? `${minutesLeft} min` : 'Expired'}
            </span>
          </div>
        )}

        {(order.status === 'payment_pending' || order.status === 'payment_confirmed') && (
          <div className="mt-4 p-4 rounded-xl bg-green-500/5 border border-green-500/20">
            <p className="text-sm text-green-400 font-medium flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" /> Escrow protection active
            </p>
            <p className="text-xs text-gray-400 mt-1">Funds are secured in escrow. Release occurs after seller confirmation. Never release payment outside the platform.</p>
          </div>
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
          {canOpenDispute && (
            <button
              type="button"
              disabled={disputeLoading}
              onClick={() => setShowDisputeModal(true)}
              className="px-4 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 active:scale-[0.98] text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 transition-colors duration-100"
            >
              Open dispute
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

        {showDisputeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="dispute-modal-title">
            <div className="w-full max-w-md rounded-xl border border-gray-700 bg-[#181a20] p-6">
              <h2 id="dispute-modal-title" className="text-lg font-semibold text-white mb-2">Open dispute</h2>
              <p className="text-sm text-gray-400 mb-4">Describe the issue (10–1000 characters). Our team will review.</p>
              <textarea
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                placeholder="e.g. Seller has not released crypto after I confirmed payment."
                rows={4}
                maxLength={1000}
                className="w-full rounded-lg border border-gray-700 bg-[#0b0e11] px-3 py-2.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 resize-none"
              />
              <p className="text-xs text-gray-500 mt-1">{disputeReason.length}/1000</p>
              <div className="flex gap-3 mt-4">
                <button
                  type="button"
                  disabled={disputeLoading || disputeReason.trim().length < 10}
                  onClick={handleOpenDispute}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium"
                >
                  {disputeLoading ? 'Submitting…' : 'Submit'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowDisputeModal(false); setDisputeReason(''); setActionError(null); }}
                  className="px-4 py-2.5 rounded-lg bg-gray-600 hover:bg-gray-700 text-white font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* P2P order chat */}
        <div className="mt-8 rounded-xl border border-gray-800 bg-[#181a20] overflow-hidden">
          <h2 className="px-4 py-3 text-sm font-medium text-gray-300 border-b border-gray-800">Chat</h2>
          <div className="max-h-64 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <p className="text-sm text-gray-500">No messages yet. Send a message to coordinate payment.</p>
            )}
            {messages.map((msg) => {
              const isMe = user && msg.senderId === user.id;
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                >
                  <span className="text-xs text-gray-500">
                    {msg.senderUsername ?? 'User'} · {new Date(msg.createdAt).toLocaleString()}
                  </span>
                  <span className={`mt-0.5 px-3 py-1.5 rounded-lg text-sm max-w-[85%] ${isMe ? 'bg-blue-500/20 text-blue-200' : 'bg-gray-700/50 text-gray-200'}`}>
                    {msg.message}
                  </span>
                </div>
              );
            })}
            <div ref={chatEndRef} />
          </div>
          <div className="p-3 border-t border-gray-800 flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
              placeholder="Type a message…"
              maxLength={2000}
              className="flex-1 rounded-lg border border-gray-700 bg-[#0b0e11] px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
            <button
              type="button"
              disabled={!chatInput.trim() || chatSending}
              onClick={handleSendMessage}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium"
            >
              {chatSending ? '…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
