'use client';

import { useEffect, useState } from 'react';
import type { P2POrderRow } from '@/lib/p2pApi';
import { formatFiatSymbol } from '@/lib/p2p-v2-utils';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { useAuthStore } from '@/store/auth';
import { Loader2 } from 'lucide-react';

function statusLabel(s: string): string {
  switch (s) {
    case 'payment_pending':
      return 'Awaiting payment';
    case 'payment_confirmed':
      return 'Paid — awaiting release';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    case 'expired':
      return 'Expired';
    case 'disputed':
      return 'In dispute';
    default:
      return s;
  }
}

type Props = {
  order: P2POrderRow;
  isBuyer: boolean;
};

/** Secure proofs require Authorization; legacy `/assets/` can open in a new tab. */
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
    if (!accessToken) {
      setErr('Not signed in');
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const base = getApiBaseUrl();
      const res = await fetch(
        `${base}/api/v1/p2p/orders/${encodeURIComponent(orderId)}/payment-proof`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          credentials: 'include',
        }
      );
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || res.statusText);
      }
      const b = await res.blob();
      const u = URL.createObjectURL(b);
      setBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return u;
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load proof');
    } finally {
      setLoading(false);
    }
  };

  useEffect(
    () => () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    },
    [blobUrl]
  );

  if (isSecure) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => void loadSecure()}
          disabled={loading}
          className="inline-flex items-center gap-2 text-sm text-primary hover:underline disabled:opacity-50 dark:text-blue-400"
          aria-busy={loading}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {blobUrl ? 'Reload proof' : 'View payment proof'}
        </button>
        {err && <p className="text-xs text-red-600">{err}</p>}
        {blobUrl && (
          <img
            src={blobUrl}
            alt="Payment proof"
            className="max-h-64 max-w-full rounded border border-border"
          />
        )}
      </div>
    );
  }

  return (
    <a
      href={legacyHref}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sm text-primary hover:underline dark:text-blue-400"
    >
      Open image
    </a>
  );
}

function verificationBadge(pvs: string | null | undefined): { label: string; className: string } | null {
  if (pvs == null || pvs === '') return null;
  switch (pvs) {
    case 'pending':
      return {
        label: 'Payment check: pending',
        className: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200',
      };
    case 'verified':
      return {
        label: 'Payment verified',
        className: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200',
      };
    case 'rejected':
      return {
        label: 'Payment proof rejected',
        className: 'bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-200',
      };
    default:
      return { label: String(pvs), className: 'bg-accent text-foreground dark:bg-accent dark:text-gray-200' };
  }
}

export function P2POrderSummary({ order, isBuyer }: Props) {
  const fiat = order.fiat_currency ?? 'USD';
  const sym = formatFiatSymbol(fiat);
  const vBadge = verificationBadge(order.payment_verification_status);
  const isSeller = !isBuyer;

  return (
    <div className="rounded-xl border border-border bg-card p-4 dark:border-border dark:bg-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Order summary</h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-foreground/80 dark:bg-accent dark:text-gray-200">
            {statusLabel(order.status)}
          </span>
          {vBadge && (
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${vBadge.className}`}>{vBadge.label}</span>
          )}
        </div>
      </div>
      {isSeller && order.status === 'payment_confirmed' && order.payment_verification_status === 'pending' && (
        <p className="mb-3 text-xs text-amber-700 dark:text-amber-400">
          Do not release until you have confirmed the fiat in your account. Use &quot;Verify payment received&quot; after you are satisfied.
        </p>
      )}
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Role</dt>
          <dd className="font-medium text-foreground">{isBuyer ? 'Buyer' : 'Seller'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Crypto</dt>
          <dd className="font-mono font-medium text-foreground">
            {order.quantity} {order.crypto_symbol ?? ''}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Fiat</dt>
          <dd className="font-mono font-medium text-foreground">
            {sym}
            {order.fiat_amount ?? '—'} {fiat}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Counterparty</dt>
          <dd className="text-foreground">
            {isBuyer ? order.seller_username ?? '—' : order.buyer_username ?? '—'}
          </dd>
        </div>
        {!isBuyer && order.status === 'payment_confirmed' && order.transaction_reference && (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Buyer transaction reference</dt>
            <dd className="break-all font-mono text-sm text-foreground">{order.transaction_reference}</dd>
          </div>
        )}
        {!isBuyer && order.status === 'payment_confirmed' && order.payment_proof_url && (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Payment proof</dt>
            <dd>
              <PaymentProofViewer orderId={order.id} paymentProofUrl={order.payment_proof_url} />
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
