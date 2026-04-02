'use client';

import type { P2PAdRow } from '@/lib/p2pApi';
import { p2pAdDisplayPrice, p2pAdSide, formatFiatSymbol } from '@/lib/p2p-v2-utils';
import { P2PMerchantCard } from './P2PMerchantCard';
import { ShoppingCart } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Store } from 'lucide-react';

function formatPaymentMethods(ad: P2PAdRow): string {
  const m = ad.accepted_payment_methods;
  if (m == null) return '—';
  if (Array.isArray(m)) {
    const parts = m
      .map((x) => (typeof x === 'string' ? x : typeof x === 'object' && x && 'name' in x ? String((x as { name?: string }).name) : String(x)))
      .filter(Boolean);
    return parts.length ? parts.slice(0, 5).join(' · ') : '—';
  }
  return String(m);
}

function P2PAdsLoadingSkeleton() {
  return (
    <>
      <div className="space-y-3 md:hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-border bg-card p-4 dark:border-border dark:bg-card"
          >
            <div className="flex justify-between gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
            <Skeleton className="mt-3 h-6 w-28" />
            <Skeleton className="mt-2 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-2/3" />
            <Skeleton className="mt-4 h-11 w-full rounded-lg" />
          </div>
        ))}
      </div>
      <div className="hidden overflow-hidden rounded-xl border border-border bg-card dark:border-border dark:bg-card md:block">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-border bg-muted text-xs font-medium text-muted-foreground dark:border-border dark:bg-card/50 dark:text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Advertiser</th>
              <th className="px-4 py-3">Side</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Limits</th>
              <th className="px-4 py-3">Available</th>
              <th className="w-28 px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <tr key={i}>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-40" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-12" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-24" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-28" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-16" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-8 w-20 rounded-lg" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

type Props = {
  ads: P2PAdRow[];
  fiat: string;
  loading?: boolean;
  authed: boolean;
  onTakeAd: (ad: P2PAdRow) => void;
  paymentFilter: string;
  isError?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
};

export function P2PAdsTable({
  ads,
  fiat,
  loading,
  authed,
  onTakeAd,
  paymentFilter,
  isError,
  errorMessage,
  onRetry,
}: Props) {
  const sym = formatFiatSymbol(fiat);

  const filtered = paymentFilter
    ? ads.filter((a) => {
        const raw = JSON.stringify(a.accepted_payment_methods ?? []).toLowerCase();
        return raw.includes(paymentFilter.toLowerCase());
      })
    : ads;

  if (loading) {
    return <P2PAdsLoadingSkeleton />;
  }

  if (isError) {
    return (
      <ErrorState
        title="Could not load ads"
        message={errorMessage || 'Check your connection and try again.'}
        onRetry={onRetry}
      />
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card dark:border-border dark:bg-card">
        <EmptyState
          icon={Store}
          title="No ads match your filters"
          description="Try another payment method, fiat, or crypto — or check back later."
          className="py-14"
        />
        {paymentFilter ? (
          <p className="px-4 pb-6 text-center text-xs text-muted-foreground">
            Remove the payment filter in the bar above to see more listings.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {/* Mobile: cards — no horizontal scroll */}
      <div className="space-y-3 md:hidden">
        {filtered.map((ad) => {
          const side = p2pAdSide(ad);
          const price = p2pAdDisplayPrice(ad);
          const minA = ad.min_amount ?? '0';
          const maxA = ad.max_amount ?? '0';
          const completion =
            ad.merchant_completion_rate != null && String(ad.merchant_completion_rate).trim() !== ''
              ? `${ad.merchant_completion_rate}%`
              : '—';
          const payments = formatPaymentMethods(ad);
          return (
            <div
              key={ad.id}
              className="rounded-xl border border-border bg-card p-4 shadow-sm dark:border-border dark:bg-card"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <P2PMerchantCard ad={ad} fiat={ad.fiat_currency || fiat} />
                </div>
                <span className="shrink-0 rounded-full bg-accent px-2.5 py-1 text-xs font-medium capitalize text-foreground dark:bg-accent dark:text-gray-200">
                  {side}
                </span>
              </div>
              <div className="mt-3 grid gap-2 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Price</span>
                  <span className="font-mono font-medium text-foreground">
                    {sym}
                    {price}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">/{ad.crypto_symbol}</span>
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Completion</span>
                  <span className="font-medium text-foreground">{completion}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Available</span>
                  <span className="font-mono text-foreground">{ad.available_amount}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground">Limits ({fiat})</span>
                  <span className="font-mono text-xs text-foreground/80">
                    {minA} — {maxA}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground">Payment methods</span>
                  <span className="break-words text-xs leading-relaxed text-foreground dark:text-gray-200">{payments}</span>
                </div>
              </div>
              <button
                type="button"
                disabled={!authed}
                onClick={() => onTakeAd(ad)}
                title={!authed ? 'Log in to trade' : undefined}
                className="mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ShoppingCart className="h-4 w-4 shrink-0" aria-hidden />
                {side === 'sell' ? 'Buy' : 'Sell'}
              </button>
            </div>
          );
        })}
      </div>

      {/* Desktop: table */}
      <div className="hidden overflow-hidden rounded-xl border border-border bg-card dark:border-border dark:bg-card md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-border bg-muted text-xs font-medium text-muted-foreground dark:border-border dark:bg-card/50 dark:text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Advertiser</th>
                <th className="px-4 py-3">Side</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Limits ({fiat})</th>
                <th className="px-4 py-3">Available</th>
                <th className="w-28 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((ad) => {
                const side = p2pAdSide(ad);
                const price = p2pAdDisplayPrice(ad);
                const minA = ad.min_amount ?? '0';
                const maxA = ad.max_amount ?? '0';
                return (
                  <tr key={ad.id} className="hover:bg-background/80 dark:hover:bg-gray-900/30">
                    <td className="px-4 py-3">
                      <P2PMerchantCard ad={ad} fiat={ad.fiat_currency || fiat} />
                    </td>
                    <td className="px-4 py-3 capitalize text-foreground">{side}</td>
                    <td className="px-4 py-3 font-mono text-foreground">
                      {sym}
                      {price}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {minA} — {maxA}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{ad.available_amount}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={!authed}
                        onClick={() => onTakeAd(ad)}
                        title={!authed ? 'Log in to trade' : undefined}
                        className="inline-flex min-h-[36px] min-w-[72px] items-center justify-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <ShoppingCart className="h-3.5 w-3.5" />
                        {side === 'sell' ? 'Buy' : 'Sell'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
