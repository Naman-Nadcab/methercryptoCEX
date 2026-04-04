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
import { Upload, CheckCircle, XCircle, AlertTriangle, Shield } from 'lucide-react';

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
        setErr(null); setPayFile(null); setTxRef('');
        invalidate();
      } else { setErr(res.error?.message ?? 'Mark paid failed'); }
    },
    onError: (e: unknown) => {
      if (e instanceof Error && e.message === 'FILE_REQUIRED') { setErr('Upload a PNG or JPEG payment proof.'); return; }
      if (e instanceof Error && e.message === 'REF_REQUIRED') { setErr('Enter your transaction reference (1–256 characters).'); return; }
      setErr('Network error marking paid');
    },
  });

  const verifyMut = useMutation({
    mutationFn: () => verifySellerPayment(order.id),
    onSuccess: (res) => {
      if (res.success) { setOk('Payment verified. You can release crypto when ready.'); setErr(null); invalidate(); }
      else { setErr(res.error?.message ?? 'Verify failed'); }
    },
    onError: () => setErr('Network error verifying payment'),
  });

  const releaseMut = useMutation({
    mutationFn: async () => {
      if (!releaseKeyRef.current) releaseKeyRef.current = crypto.randomUUID();
      return releaseOrder(order.id, releaseKeyRef.current);
    },
    onSuccess: (res) => {
      if (res.success) { setOk('Crypto released.'); setErr(null); invalidate(); }
      else {
        setErr(res.error?.message ?? 'Release failed');
        if (res.error?.code === 'PAYMENT_NOT_VERIFIED') releaseKeyRef.current = null;
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
      if (res.success) { setOk('Order cancelled.'); setErr(null); invalidate(); }
      else { setErr(res.error?.message ?? 'Cancel failed'); }
    },
    onError: () => setErr('Network error cancelling'),
  });

  const disputeMut = useMutation({
    mutationFn: (reason: string) => openDispute(order.id, reason),
    onSuccess: (res) => {
      if (res.success) {
        setOk('Dispute opened.'); setErr(null); invalidate();
        const id = res.data && typeof res.data === 'object' && res.data != null && 'id' in res.data ? String((res.data as { id: string }).id) : '';
        if (id) router.push(`/p2p/disputes/${id}`);
      } else { setErr(res.error?.message ?? 'Dispute failed'); }
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

  const inputCls = 'w-full rounded-lg border border-border/40 bg-background px-3.5 py-2 text-[13px] text-foreground transition-colors focus:border-primary/40 focus:outline-none';

  if (!user) return null;

  return (
    <div className="space-y-3 rounded-lg border border-border/30 bg-card p-4">
      <h3 className="text-[13px] font-semibold text-foreground">Actions</h3>

      {err && (
        <div className="rounded-md bg-[#f6465d]/5 border border-[#f6465d]/15 px-3 py-2 text-[12px] font-medium text-[#f6465d]">{err}</div>
      )}
      {ok && (
        <div className="rounded-md bg-[#0ecb81]/5 border border-[#0ecb81]/15 px-3 py-2 text-[12px] font-medium text-[#0ecb81]">{ok}</div>
      )}

      {canPay && (
        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Upload a screenshot of your transfer and enter the transaction ID from your bank or payment app.
          </p>
          <div className="rounded-lg border border-dashed border-border/40 p-3.5 text-center transition-colors hover:border-primary/20">
            <Upload className="mx-auto h-5 w-5 text-muted-foreground/30 mb-1.5" />
            <input
              type="file"
              accept="image/png,image/jpeg,image/jpg"
              onChange={(e) => { const f = e.target.files?.[0]; setPayFile(f ?? null); e.target.value = ''; }}
              className="block w-full text-[11px] text-muted-foreground file:mr-2 file:rounded-md file:border-0 file:bg-primary/10 file:px-2.5 file:py-1 file:text-[10px] file:font-semibold file:text-primary"
            />
            {payFile && <p className="mt-1.5 text-[10px] text-foreground">{payFile.name}</p>}
          </div>
          <input
            type="text"
            value={txRef}
            onChange={(e) => setTxRef(e.target.value)}
            placeholder="Transaction reference (as shown on receipt)"
            maxLength={256}
            className={inputCls}
          />
          <button
            type="button"
            disabled={payMut.isPending || !payFile || txRef.trim().length < 1}
            onClick={() => payMut.mutate()}
            className="w-full rounded-lg bg-primary py-2.5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
          >
            {payMut.isPending ? 'Submitting…' : 'Mark as Paid'}
          </button>
        </div>
      )}

      {isSeller && st === 'payment_confirmed' && pvs === 'pending' && (
        <div className="rounded-md bg-amber-500/5 border border-amber-500/15 px-3 py-2 text-[11px] text-amber-500 leading-relaxed">
          Check your account for the buyer&apos;s payment, review their proof and reference, then verify before releasing.
        </div>
      )}

      {canVerify && (
        <button
          type="button"
          disabled={verifyMut.isPending}
          onClick={() => verifyMut.mutate()}
          className="w-full rounded-lg bg-blue-600 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-40 flex items-center justify-center gap-1.5"
        >
          <Shield className="h-3.5 w-3.5" />
          {verifyMut.isPending ? 'Verifying…' : 'Verify Payment Received'}
        </button>
      )}

      {canRelease && (
        <button
          type="button"
          disabled={releaseMut.isPending}
          onClick={() => releaseMut.mutate()}
          className="w-full rounded-lg bg-[#0ecb81] py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[#0ecb81]/90 disabled:opacity-40 flex items-center justify-center gap-1.5"
        >
          <CheckCircle className="h-3.5 w-3.5" />
          {releaseMut.isPending ? 'Releasing…' : 'Release Crypto'}
        </button>
      )}

      {canCancel && (
        <div className="space-y-2 border-t border-border/20 pt-3">
          <input
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Cancel reason (required)"
            className={inputCls}
          />
          <button
            type="button"
            disabled={cancelMut.isPending || cancelReason.trim().length < 1}
            onClick={() => cancelMut.mutate(cancelReason.trim())}
            className="w-full rounded-lg border border-[#f6465d]/25 py-2.5 text-[13px] font-semibold text-[#f6465d] transition-colors hover:bg-[#f6465d]/5 disabled:opacity-40 flex items-center justify-center gap-1.5"
          >
            <XCircle className="h-3.5 w-3.5" />
            Cancel Order
          </button>
          <p className="text-[10px] text-muted-foreground">Only available before payment is marked as paid.</p>
        </div>
      )}

      {canDispute && (
        <div className="space-y-2 border-t border-border/20 pt-3">
          <textarea
            value={disputeReason}
            onChange={(e) => setDisputeReason(e.target.value)}
            placeholder="Describe the issue (10–1000 characters)"
            rows={3}
            className={`${inputCls} resize-none`}
          />
          <button
            type="button"
            disabled={disputeMut.isPending || disputeReason.trim().length < 10}
            onClick={() => disputeMut.mutate(disputeReason.trim())}
            className="w-full rounded-lg bg-amber-600 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-40 flex items-center justify-center gap-1.5"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            Raise Dispute
          </button>
        </div>
      )}

      {st === 'disputed' && (
        <div className="rounded-md bg-amber-500/5 border border-amber-500/15 px-3 py-2 text-[11px] text-amber-500 leading-relaxed">
          This order is under dispute. Support will review. You cannot cancel or release from here.
        </div>
      )}
    </div>
  );
}
