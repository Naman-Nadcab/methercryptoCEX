'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { P2POrderRow } from '@/lib/p2pApi';
import {
  releaseOrder,
  cancelOrder,
  openDispute,
  submitP2pOrderPay,
  verifySellerPayment,
  P2P_V2_ORDER_KEY,
  P2P_V2_ORDERS_KEY,
} from '@/lib/p2pApi';
import { useAuthStore } from '@/store/auth';

type Props = {
  order: P2POrderRow;
  isBuyer: boolean;
  isSeller: boolean;
};

function paymentVerificationGate(order: P2POrderRow): boolean {
  const pvs = order.payment_verification_status;
  if (pvs == null || pvs === '') return true;
  return pvs === 'verified';
}

export function P2PActionButtons({ order, isBuyer, isSeller }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const payKeyRef = useRef<string | null>(null);
  const releaseKeyRef = useRef<string | null>(null);
  const cancelKeyRef = useRef<string | null>(null);
  const [payFile, setPayFile] = useState<File | null>(null);
  const [txRef, setTxRef] = useState('');

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: P2P_V2_ORDER_KEY(order.id) });
    queryClient.invalidateQueries({ queryKey: P2P_V2_ORDERS_KEY });
  };

  const payMut = useMutation({
    mutationFn: async () => {
      if (!payFile) throw new Error('FILE_REQUIRED');
      const ref = txRef.trim();
      if (!ref || ref.length > 256) throw new Error('REF_REQUIRED');
      if (!payKeyRef.current) payKeyRef.current = crypto.randomUUID();
      return submitP2pOrderPay(order.id, {
        file: payFile,
        transactionReference: ref,
        idempotencyKey: payKeyRef.current,
      });
    },
    onSuccess: (res) => {
      if (res.success) {
        setOk('Payment marked as paid. The seller will verify and release.');
        setErr(null);
        setPayFile(null);
        setTxRef('');
        invalidate();
      } else {
        setErr(res.error?.message ?? 'Mark paid failed');
      }
    },
    onError: (e: unknown) => {
      if (e instanceof Error && e.message === 'FILE_REQUIRED') {
        setErr('Upload a PNG or JPEG payment proof.');
        return;
      }
      if (e instanceof Error && e.message === 'REF_REQUIRED') {
        setErr('Enter your transaction reference (1–256 characters).');
        return;
      }
      setErr('Network error marking paid');
    },
  });

  const verifyMut = useMutation({
    mutationFn: () => verifySellerPayment(order.id),
    onSuccess: (res) => {
      if (res.success) {
        setOk('Payment verified. You can release crypto when ready.');
        setErr(null);
        invalidate();
      } else {
        setErr(res.error?.message ?? 'Verify failed');
      }
    },
    onError: () => setErr('Network error verifying payment'),
  });

  const releaseMut = useMutation({
    mutationFn: async () => {
      if (!releaseKeyRef.current) releaseKeyRef.current = crypto.randomUUID();
      return releaseOrder(order.id, releaseKeyRef.current);
    },
    onSuccess: (res) => {
      if (res.success) {
        setOk('Crypto released.');
        setErr(null);
        invalidate();
      } else {
        setErr(res.error?.message ?? 'Release failed');
        if (res.error?.code === 'PAYMENT_NOT_VERIFIED') {
          releaseKeyRef.current = null;
        }
      }
    },
    onError: () => setErr('Network error releasing'),
  });

  const cancelMut = useMutation({
    mutationFn: async (reason: string) => {
      if (!cancelKeyRef.current) cancelKeyRef.current = crypto.randomUUID();
      return cancelOrder(order.id, reason, cancelKeyRef.current);
    },
    onSuccess: (res) => {
      if (res.success) {
        setOk('Order cancelled.');
        setErr(null);
        invalidate();
      } else {
        setErr(res.error?.message ?? 'Cancel failed');
      }
    },
    onError: () => setErr('Network error cancelling'),
  });

  const disputeMut = useMutation({
    mutationFn: (reason: string) => openDispute(order.id, reason),
    onSuccess: (res) => {
      if (res.success) {
        setOk('Dispute opened.');
        setErr(null);
        invalidate();
        const id = res.data && typeof res.data === 'object' && res.data != null && 'id' in res.data ? String((res.data as { id: string }).id) : '';
        if (id) router.push(`/p2p/disputes/${id}`);
      } else {
        setErr(res.error?.message ?? 'Dispute failed');
      }
    },
    onError: () => setErr('Network error opening dispute'),
  });

  const st = order.status;
  const pvs = order.payment_verification_status ?? null;
  const canPay = isBuyer && st === 'payment_pending';
  const canVerify = isSeller && st === 'payment_confirmed' && pvs === 'pending';
  const canRelease = isSeller && st === 'payment_confirmed' && paymentVerificationGate(order);
  const canCancel = (isBuyer || isSeller) && st === 'payment_pending';
  const canDispute = (isBuyer || isSeller) && st === 'payment_confirmed';
  const [cancelReason, setCancelReason] = useState('');
  const [disputeReason, setDisputeReason] = useState('');

  if (!user) return null;

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-[#1e2329]">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Actions</h3>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {ok && <p className="text-sm text-emerald-600">{ok}</p>}

      {canPay && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Upload a screenshot of your transfer and enter the transaction ID from your bank or payment app. Both are required.
          </p>
          <input
            type="file"
            accept="image/png,image/jpeg,image/jpg"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setPayFile(f ?? null);
              e.target.value = '';
            }}
            className="block w-full text-xs text-gray-600 file:mr-2 file:rounded file:border-0 file:bg-gray-100 file:px-2 file:py-1 dark:text-gray-300"
          />
          <input
            type="text"
            value={txRef}
            onChange={(e) => setTxRef(e.target.value)}
            placeholder="Transaction reference (as shown on receipt)"
            maxLength={256}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-[#0b0e11] dark:text-white"
          />
          <button
            type="button"
            disabled={payMut.isPending || !payFile || txRef.trim().length < 1}
            onClick={() => payMut.mutate()}
            className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {payMut.isPending ? 'Submitting…' : 'Mark as paid'}
          </button>
        </div>
      )}

      {isSeller && st === 'payment_confirmed' && pvs === 'pending' && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Check your account for the buyer&apos;s payment, review their proof and reference, then verify before releasing.
        </p>
      )}

      {canVerify && (
        <button
          type="button"
          disabled={verifyMut.isPending}
          onClick={() => verifyMut.mutate()}
          className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {verifyMut.isPending ? 'Verifying…' : 'Verify payment received'}
        </button>
      )}

      {canRelease && (
        <button
          type="button"
          disabled={releaseMut.isPending}
          onClick={() => releaseMut.mutate()}
          className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {releaseMut.isPending ? 'Releasing…' : 'Release crypto'}
        </button>
      )}

      {canCancel && (
        <div className="space-y-2 border-t border-gray-100 pt-3 dark:border-gray-800">
          <input
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Cancel reason (required)"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-[#0b0e11] dark:text-white"
          />
          <button
            type="button"
            disabled={cancelMut.isPending || cancelReason.trim().length < 1}
            onClick={() => cancelMut.mutate(cancelReason.trim())}
            className="w-full rounded-lg border border-red-300 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30 disabled:opacity-50"
          >
            Cancel order
          </button>
          <p className="text-[10px] text-gray-500">Only available before payment is marked as paid.</p>
        </div>
      )}

      {canDispute && (
        <div className="space-y-2 border-t border-gray-100 pt-3 dark:border-gray-800">
          <textarea
            value={disputeReason}
            onChange={(e) => setDisputeReason(e.target.value)}
            placeholder="Describe the issue (10–1000 characters)"
            rows={3}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-[#0b0e11] dark:text-white"
          />
          <button
            type="button"
            disabled={disputeMut.isPending || disputeReason.trim().length < 10}
            onClick={() => disputeMut.mutate(disputeReason.trim())}
            className="w-full rounded-lg bg-amber-600 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            Raise dispute
          </button>
        </div>
      )}

      {st === 'disputed' && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          This order is under dispute. Support will review. You cannot cancel or release from here.
        </p>
      )}
    </div>
  );
}
