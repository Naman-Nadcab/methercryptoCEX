'use client';

import { useEffect, useState } from 'react';
import type { P2POrderRow } from '@/lib/p2pApi';
import { formatFiatSymbol } from '@/lib/p2p-v2-utils';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { useAuthStore } from '@/store/auth';
import { Loader2 } from 'lucide-react';
import { CoinIcon } from '@/components/ui/CoinIcon';

/* ── Helpers ── */
function statusLabel(s: string): string {
  switch (s) {
    case 'payment_pending': return 'Awaiting Payment';
    case 'payment_confirmed': return 'Paid — Awaiting Release';
    case 'completed': return 'Completed';
    case 'cancelled': return 'Cancelled';
    case 'expired': return 'Expired';
    case 'disputed': return 'In Dispute';
    default: return s;
  }
}

const STATUS_CLS: Record<string, string> = {
  payment_pending: 'bg-amber-500/10 text-amber-500',
  payment_confirmed: 'bg-blue-500/10 text-blue-500',
  completed: 'bg-[#0ecb81]/10 text-[#0ecb81]',
  cancelled: 'bg-muted text-muted-foreground',
  expired: 'bg-muted text-muted-foreground',
  disputed: 'bg-[#f6465d]/10 text-[#f6465d]',
};

function verificationBadge(pvs: string | null | undefined): { label: string; cls: string } | null {
  if (pvs == null || pvs === '') return null;
  switch (pvs) {
    case 'pending': return { label: 'Payment check: pending', cls: 'bg-amber-500/10 text-amber-500' };
    case 'verified': return { label: 'Payment verified', cls: 'bg-[#0ecb81]/10 text-[#0ecb81]' };
    case 'rejected': return { label: 'Proof rejected', cls: 'bg-[#f6465d]/10 text-[#f6465d]' };
    default: return { label: String(pvs), cls: 'bg-muted text-muted-foreground' };
  }
}

/* ── Payment proof viewer (logic unchanged) ── */
function PaymentProofViewer({ orderId, paymentProofUrl }: { orderId: string; paymentProofUrl: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const accessToken = useAuthStore((s) => s.accessToken);

  const isSecure = paymentProofUrl.startsWith('secure:');
  const legacyHref =
    typeof window !== 'undefined' && paymentProofUrl.startsWith('/assets/')
      ? `${window.location.origin}${paymentProofUrl}`
      : paymentProofUrl;

  const loadSecure = async () => {
    if (!accessToken) { setErr('Not signed in'); return; }
    setLoading(true);
    setErr(null);
    try {
      const base = getApiBaseUrl();
      const res = await fetch(
        `${base}/api/v1/p2p/orders/${encodeURIComponent(orderId)}/payment-proof`,
        { headers: { Authorization: `Bearer ${accessToken}` }, credentials: 'include' },
      );
      if (!res.ok) throw new Error((await res.text()) || res.statusText);
      const b = await res.blob();
      const u = URL.createObjectURL(b);
      setBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return u; });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load proof');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, [blobUrl]);

  if (isSecure) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => void loadSecure()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline disabled:opacity-50"
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {blobUrl ? 'Reload proof' : 'View payment proof'}
        </button>
        {err && <p className="text-xs text-[#f6465d]">{err}</p>}
        {blobUrl && <img src={blobUrl} alt="Payment proof" className="max-h-48 max-w-full rounded-lg border border-border/30" />}
      </div>
    );
  }

  return (
    <a href={legacyHref} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary hover:underline">
      Open image
    </a>
  );
}

/* ── Main component ── */
type Props = { order: P2POrderRow; isBuyer: boolean };

export function P2POrderSummary({ order, isBuyer }: Props) {
  const fiat = order.fiat_currency ?? 'USD';
  const sym = formatFiatSymbol(fiat);
  const vBadge = verificationBadge(order.payment_verification_status);
  const isSeller = !isBuyer;
  const sCls = STATUS_CLS[order.status] ?? 'bg-muted text-muted-foreground';

  return (
    <div className="rounded-lg border border-border/30 bg-card">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/20 px-4 py-3">
        <h2 className="text-base font-semibold tracking-tight text-foreground">Order Details</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${sCls}`}>
            {statusLabel(order.status)}
          </span>
          {vBadge && (
            <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${vBadge.cls}`}>{vBadge.label}</span>
          )}
        </div>
      </div>

      {isSeller && order.status === 'payment_confirmed' && order.payment_verification_status === 'pending' && (
        <p className="mx-4 mt-3 rounded-md border border-amber-500/15 bg-amber-500/5 px-3 py-2 text-sm text-amber-500">
          Confirm the fiat arrived in your account before releasing. Use &quot;Verify payment received&quot; after checking.
        </p>
      )}

      {/* Info grid */}
      <div className="m-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border/10 p-px">
        <div className="bg-card p-3.5">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Role</p>
          <p className="text-sm font-semibold text-foreground">{isBuyer ? 'Buyer' : 'Seller'}</p>
        </div>
        <div className="bg-card p-3.5">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Counterparty</p>
          <p className="truncate text-sm font-medium text-foreground">
            {isBuyer ? order.seller_username ?? '—' : order.buyer_username ?? '—'}
          </p>
        </div>
        <div className="bg-card p-3.5">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Crypto</p>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            {order.crypto_symbol && <CoinIcon symbol={order.crypto_symbol} size={18} />}
            <span className="numeric">{order.quantity}</span> {order.crypto_symbol ?? ''}
          </p>
        </div>
        <div className="bg-card p-3.5">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Fiat</p>
          <p className="numeric text-sm font-semibold text-foreground">
            {sym}{order.fiat_amount ?? '—'} {fiat}
          </p>
        </div>
      </div>

      {/* Transaction reference & proof */}
      {!isBuyer && order.status === 'payment_confirmed' && order.transaction_reference && (
        <div className="mx-4 mb-3 rounded-md bg-muted/10 border border-border/15 px-3 py-2.5">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Buyer Transaction Reference</p>
          <p className="numeric break-all text-sm text-foreground">{order.transaction_reference}</p>
        </div>
      )}
      {!isBuyer && order.status === 'payment_confirmed' && order.payment_proof_url && (
        <div className="mx-4 mb-3 rounded-md bg-muted/10 border border-border/15 px-3 py-2.5">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Payment Proof</p>
          <PaymentProofViewer orderId={order.id} paymentProofUrl={order.payment_proof_url} />
        </div>
      )}
    </div>
  );
}
