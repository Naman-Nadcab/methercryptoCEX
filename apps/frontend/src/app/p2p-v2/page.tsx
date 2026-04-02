'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth';
import {
  fetchP2PAds,
  fetchMyPaymentMethods,
  createOrder,
  P2P_V2_ADS_KEY,
  type P2PAdRow,
  type P2PPaymentMethodRow,
} from '@/lib/p2pApi';
import { P2PFilters, type P2PFiltersValue } from '@/components/p2p-v2/P2PFilters';
import { P2PAdsTable } from '@/components/p2p-v2/P2PAdsTable';
import { p2pAdDisplayPrice, p2pAdSide, formatFiatSymbol } from '@/lib/p2p-v2-utils';
import { X } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';

function TakeOrderModal({
  ad,
  fiat,
  onClose,
  onCreated,
}: {
  ad: P2PAdRow;
  fiat: string;
  onClose: () => void;
  onCreated: (orderId: string) => void;
}) {
  const sym = formatFiatSymbol(fiat);
  const side = p2pAdSide(ad);
  const price = p2pAdDisplayPrice(ad);
  const min = ad.min_amount ?? '0';
  const max = ad.max_amount ?? '0';
  const accepted = (ad.accepted_platform_method_ids as string[] | undefined) ?? [];

  const { data: methods = [], isLoading: pmLoading } = useQuery({
    queryKey: ['p2p-v2', 'pm-for-order', ad.id],
    queryFn: () => fetchMyPaymentMethods(),
  });

  const selectable = useMemo(() => {
    if (!accepted.length) return methods;
    const set = new Set(accepted);
    return methods.filter((m) => m.payment_method_id && set.has(m.payment_method_id));
  }, [methods, accepted]);

  const [qty, setQty] = useState(min);
  const [pmId, setPmId] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      createOrder({
        adId: ad.id,
        quantity: qty.trim(),
        paymentMethodId: pmId,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: (res) => {
      if (res.success && res.data && typeof res.data === 'object' && 'id' in res.data) {
        onCreated(String((res.data as { id: string }).id));
        onClose();
      } else {
        setErr(res.error?.message ?? 'Order failed');
      }
    },
    onError: () => setErr('Network error'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-gray-200 bg-card p-5 dark:border-gray-800 dark:bg-card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            {side === 'sell' ? 'Buy' : 'Sell'} {ad.crypto_symbol}
          </h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-accent">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-2 text-sm text-muted-foreground">
          Price {sym}
          {price} / {ad.crypto_symbol} · Limits {min}–{max} {fiat}
        </p>
        <label className="mb-2 block text-xs font-medium text-foreground/80">Amount ({ad.crypto_symbol})</label>
        <input
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="mb-4 w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-background dark:text-white"
        />
        <label className="mb-2 block text-xs font-medium text-foreground/80">Your payment method</label>
        {pmLoading ? (
          <div className="mb-4 space-y-2" aria-hidden>
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-3 w-3/4 max-w-sm" />
          </div>
        ) : selectable.length === 0 ? (
          <p className="text-sm text-amber-600">
            No matching payment method.{' '}
            <Link href="/p2p/payment-methods" className="underline">
              Add one
            </Link>
          </p>
        ) : (
          <select
            value={pmId}
            onChange={(e) => setPmId(e.target.value)}
            className="mb-4 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-background dark:text-white"
          >
            <option value="">Select…</option>
            {selectable.map((m: P2PPaymentMethodRow) => (
              <option key={m.id} value={m.id}>
                {m.display_name || m.method_name} ({m.method_code})
              </option>
            ))}
          </select>
        )}
        {err && <p className="mb-2 text-sm text-red-600">{err}</p>}
        <button
          type="button"
          disabled={mut.isPending || !pmId || selectable.length === 0}
          onClick={() => mut.mutate()}
          className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {mut.isPending ? 'Creating…' : 'Create order'}
        </button>
      </div>
    </div>
  );
}

export default function P2PV2MarketplacePage() {
  const queryClient = useQueryClient();
  const { accessToken, _hasHydrated } = useAuthStore();
  const authed = _hasHydrated && !!accessToken;

  const [filters, setFilters] = useState<P2PFiltersValue>({
    side: 'buy',
    crypto: 'USDT',
    fiat: 'INR',
    paymentCode: '',
  });
  const [modalAd, setModalAd] = useState<P2PAdRow | null>(null);

  const { data: ads = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: [...P2P_V2_ADS_KEY, filters],
    queryFn: () =>
      fetchP2PAds({
        type: filters.side,
        currency: filters.crypto,
        fiat: filters.fiat,
        limit: 50,
        offset: 0,
      }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">P2P marketplace</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Trade with verified peers. Escrow protects every deal.
        </p>
      </div>

      <P2PFilters value={filters} onChange={setFilters} />

      <P2PAdsTable
        ads={ads}
        fiat={filters.fiat}
        loading={isLoading}
        authed={authed}
        paymentFilter={filters.paymentCode}
        isError={isError}
        errorMessage={error instanceof Error ? error.message : undefined}
        onRetry={() => void refetch()}
        onTakeAd={(ad) => {
          if (!authed) return;
          setModalAd(ad);
        }}
      />

      {modalAd && authed && (
        <TakeOrderModal
          ad={modalAd}
          fiat={filters.fiat}
          onClose={() => setModalAd(null)}
          onCreated={(orderId) => {
            queryClient.invalidateQueries({ queryKey: P2P_V2_ADS_KEY });
            window.location.href = `/p2p/orders/${orderId}`;
          }}
        />
      )}
    </div>
  );
}
