'use client';

import type { P2PAdRow } from '@/lib/p2pApi';
import {
  p2pAdDisplayPrice,
  p2pAdSide,
  formatFiatSymbol,
  formatP2pFiatPrice,
  formatP2pCryptoQty,
  p2pPaymentMethodChipCls,
} from '@/lib/p2p-v2-utils';
import { loginWithRedirect, P2P_HREF } from '@/lib/routes';
import { ShieldCheck, Store, PlusCircle } from 'lucide-react';
import { CoinIcon } from '@/components/ui/CoinIcon';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { p2pProfilePath } from '@/lib/routes';
import Link from 'next/link';

/* ── Payment method helpers ── */
function parsePayments(ad: P2PAdRow): string[] {
  const m = ad.accepted_payment_methods;
  if (m == null) return [];
  if (Array.isArray(m)) {
    return m
      .map((x) =>
        typeof x === 'string'
          ? x
          : typeof x === 'object' && x && 'name' in x
            ? String((x as { name?: string }).name)
            : String(x),
      )
      .filter(Boolean)
      .slice(0, 4);
  }
  return [String(m)];
}

/* ── Loading skeleton ── */
function LoadingSkeleton() {
  return (
    <>
      {/* mobile */}
      <div className="space-y-2 md:hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border/20 bg-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="space-y-1 flex-1">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <Skeleton className="h-5 w-24" />
            <div className="flex justify-between">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-7 w-20 rounded-md" />
            </div>
          </div>
        ))}
      </div>
      {/* desktop */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-border/25">
        <div className="min-w-[720px] divide-y divide-border/10">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4">
              <Skeleton className="h-8 w-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-4 w-20" />
              <div className="space-y-1">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-8 w-[88px] rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ── Main component ── */
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

  if (loading) return <LoadingSkeleton />;

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
      <div className="flex flex-col items-center py-20 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-border/50 bg-muted/30 text-muted-foreground/50">
          <Store className="h-8 w-8" />
        </div>
        <p className="text-base font-semibold tracking-tight text-foreground">No ads match your filters</p>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          Try another asset, fiat, or payment method.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/p2p/create-ad"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <PlusCircle className="h-4 w-4" /> Post ad
          </Link>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-xl border border-border/40 px-5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            >
              Refresh
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ── Mobile: compact cards ── */}
      <div className="space-y-2 md:hidden">
        {filtered.map((ad) => {
          const side = p2pAdSide(ad);
          const rawPrice = p2pAdDisplayPrice(ad);
          const priceShown = formatP2pFiatPrice(rawPrice, fiat);
          const minA = ad.min_amount ?? '0';
          const maxA = ad.max_amount ?? '0';
          const minF = formatP2pFiatPrice(minA, fiat);
          const maxF = formatP2pFiatPrice(maxA, fiat);
          const avail = formatP2pCryptoQty(String(ad.available_amount ?? ''));
          const payments = parsePayments(ad);
          const verified = Boolean((ad as { verified_merchant?: boolean }).verified_merchant);
          const completion = ad.merchant_completion_rate != null ? `${ad.merchant_completion_rate}%` : '—';
          const orders = ad.merchant_total_orders ?? 0;
          const isBuy = side === 'sell';

          return (
            <div key={ad.id} className="rounded-xl border border-border/25 bg-card p-4 transition-colors duration-100 hover:bg-muted/[0.04] sm:p-5">
              {/* top: merchant */}
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    {(ad.username || 'M')[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-foreground">{ad.username || 'Merchant'}</span>
                      {verified && <ShieldCheck className="h-4 w-4 shrink-0 text-[#0ecb81]" />}
                    </div>
                    <span className="text-xs text-muted-foreground">{orders} orders · {completion}</span>
                  </div>
                </div>
                <CoinIcon symbol={ad.crypto_symbol || ''} size={24} />
              </div>

              {/* price */}
              <div className="mb-3">
                <span className={`numeric text-xl font-bold tabular-nums leading-tight ${isBuy ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}>
                  {sym}{priceShown}
                </span>
                <span className="ml-1 text-xs text-muted-foreground">/{ad.crypto_symbol}</span>
              </div>

              {/* stats row */}
              <div className="mb-4 flex gap-6 text-sm">
                <div>
                  <span className="block text-xs font-medium text-muted-foreground">Available</span>
                  <span className="numeric font-medium tabular-nums text-foreground">
                    {avail} {ad.crypto_symbol}
                  </span>
                </div>
                <div>
                  <span className="block text-xs font-medium text-muted-foreground">Limit</span>
                  <span className="numeric font-medium tabular-nums text-foreground">
                    {sym}{minF} – {sym}{maxF}
                  </span>
                </div>
              </div>

              {/* bottom: payments + action */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-1.5">
                  {payments.map((p, i) => (
                    <span key={i} className={`rounded-md border px-2 py-1 text-xs font-medium ${p2pPaymentMethodChipCls(p)}`}>{p}</span>
                  ))}
                </div>
                <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
                  <button
                    type="button"
                    disabled={!authed}
                    onClick={() => onTakeAd(ad)}
                    title={!authed ? 'Log in to trade' : undefined}
                    className={`shrink-0 rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors duration-150 disabled:opacity-40 ${
                      isBuy
                        ? 'bg-[#0ecb81] text-white hover:bg-[#0ecb81]/85'
                        : 'bg-[#f6465d] text-white hover:bg-[#f6465d]/85'
                    }`}
                  >
                    {isBuy ? 'Buy' : 'Sell'} {ad.crypto_symbol}
                  </button>
                  {!authed && (
                    <Link
                      href={loginWithRedirect(P2P_HREF)}
                      className="text-center text-xs font-semibold text-primary hover:underline sm:text-right"
                    >
                      Log in to trade
                    </Link>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Desktop: Binance-style dense table ── */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-border/25">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead>
            <tr className="border-b border-border/25 bg-muted/30 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="py-3.5 pl-4 pr-2">Advertisers</th>
              <th scope="col" className="px-3 py-3.5 text-right">Price</th>
              <th scope="col" className="px-3 py-3.5">Limit / Available</th>
              <th scope="col" className="px-3 py-3.5">Payment</th>
              <th scope="col" className="py-3.5 pl-3 pr-4 text-right">
                Trade <span className="normal-case text-xs font-semibold text-primary/80">0 fee</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((ad) => {
              const side = p2pAdSide(ad);
              const rawPrice = p2pAdDisplayPrice(ad);
              const priceShown = formatP2pFiatPrice(rawPrice, fiat);
              const minA = ad.min_amount ?? '0';
              const maxA = ad.max_amount ?? '0';
              const minF = formatP2pFiatPrice(minA, fiat);
              const maxF = formatP2pFiatPrice(maxA, fiat);
              const avail = formatP2pCryptoQty(String(ad.available_amount ?? ''));
              const payments = parsePayments(ad);
              const verified = Boolean((ad as { verified_merchant?: boolean }).verified_merchant);
              const completion = ad.merchant_completion_rate != null ? String(ad.merchant_completion_rate) : '—';
              const orders = ad.merchant_total_orders ?? 0;
              const uid = ad.user_id;
              const isBuy = side === 'sell';

              return (
                <tr
                  key={ad.id}
                  className="border-b border-border/10 transition-colors duration-100 hover:bg-muted/[0.06]"
                >
                  {/* Advertiser */}
                  <td className="py-4 pl-4 pr-2">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                        {(ad.username || 'M')[0].toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          {uid ? (
                            <Link
                              href={p2pProfilePath(String(uid))}
                              className="text-sm font-semibold text-foreground transition-colors hover:text-primary"
                            >
                              {ad.username || 'Merchant'}
                            </Link>
                          ) : (
                            <span className="text-sm font-semibold text-foreground">{ad.username || 'Merchant'}</span>
                          )}
                          {verified && <ShieldCheck className="h-4 w-4 shrink-0 text-[#0ecb81]" />}
                        </div>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span>{orders} order{orders !== 1 ? 's' : ''}</span>
                          <span className="text-border/40">|</span>
                          <span>{completion}% completion</span>
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* Price */}
                  <td className="px-3 py-4 text-right align-middle">
                    <span className={`numeric text-lg font-bold tabular-nums leading-tight ${isBuy ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}>
                      {sym}{priceShown}
                    </span>
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">/{ad.crypto_symbol}</span>
                  </td>

                  {/* Limit / Available */}
                  <td className="px-3 py-4 align-middle">
                    <div className="space-y-1 text-sm">
                      <p>
                        <span className="text-muted-foreground">Available </span>
                        <span className="numeric font-medium tabular-nums text-foreground">
                          {avail} {ad.crypto_symbol}
                        </span>
                      </p>
                      <p>
                        <span className="text-muted-foreground">Limit </span>
                        <span className="numeric font-medium tabular-nums text-foreground">
                          {sym}{minF} – {sym}{maxF}
                        </span>
                      </p>
                    </div>
                  </td>

                  {/* Payment */}
                  <td className="px-3 py-4">
                    <div className="flex flex-wrap gap-1.5">
                      {payments.length > 0 ? (
                        payments.map((p, i) => (
                          <span
                            key={i}
                            className={`rounded-md border px-2 py-1 text-xs font-medium leading-tight ${p2pPaymentMethodChipCls(p)}`}
                          >
                            {p}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </div>
                  </td>

                  {/* Trade */}
                  <td className="py-4 pl-3 pr-4 text-right align-middle">
                    <div className="flex flex-col items-end gap-2">
                      <button
                        type="button"
                        disabled={!authed}
                        onClick={() => onTakeAd(ad)}
                        title={!authed ? 'Log in to trade' : undefined}
                        className={`inline-flex min-h-10 items-center justify-center rounded-xl px-5 py-2 text-sm font-semibold transition-all duration-150 disabled:opacity-40 ${
                          isBuy
                            ? 'bg-[#0ecb81] text-white hover:bg-[#0ecb81]/85 active:bg-[#0ecb81]/70'
                            : 'bg-[#f6465d] text-white hover:bg-[#f6465d]/85 active:bg-[#f6465d]/70'
                        }`}
                      >
                        {isBuy ? 'Buy' : 'Sell'} {ad.crypto_symbol}
                      </button>
                      {!authed && (
                        <Link
                          href={loginWithRedirect(P2P_HREF)}
                          className="text-xs font-semibold text-primary transition-colors hover:text-primary/80 hover:underline"
                        >
                          Log in to trade
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
