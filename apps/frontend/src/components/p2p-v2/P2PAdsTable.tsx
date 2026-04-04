'use client';

import type { P2PAdRow } from '@/lib/p2pApi';
import { p2pAdDisplayPrice, p2pAdSide, formatFiatSymbol } from '@/lib/p2p-v2-utils';
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

const PM_COLORS: Record<string, string> = {
  bank: 'bg-[#0ecb81]/8 text-[#0ecb81] border-[#0ecb81]/15',
  upi: 'bg-amber-500/8 text-amber-400 border-amber-500/15',
  imps: 'bg-blue-500/8 text-blue-400 border-blue-500/15',
};
function pmCls(name: string): string {
  const l = name.toLowerCase();
  for (const [k, v] of Object.entries(PM_COLORS)) {
    if (l.includes(k)) return v;
  }
  return 'bg-muted/40 text-muted-foreground border-border/20';
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
      <div className="hidden md:block">
        <div className="divide-y divide-border/10">
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
      <div className="flex flex-col items-center py-16 text-center">
        <Store className="h-8 w-8 text-muted-foreground/30 mb-3" />
        <p className="text-sm font-medium text-foreground">No ads match your filters</p>
        <p className="mt-1 text-[12px] text-muted-foreground">Try another asset, fiat, or payment method.</p>
        <div className="mt-4 flex gap-2">
          <Link
            href="/p2p/create-ad"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <PlusCircle className="h-3.5 w-3.5" /> Post Ad
          </Link>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg border border-border/40 px-3.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground hover:bg-muted/30"
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
          const price = p2pAdDisplayPrice(ad);
          const minA = ad.min_amount ?? '0';
          const maxA = ad.max_amount ?? '0';
          const payments = parsePayments(ad);
          const verified = Boolean((ad as { verified_merchant?: boolean }).verified_merchant);
          const completion = ad.merchant_completion_rate != null ? `${ad.merchant_completion_rate}%` : '—';
          const orders = ad.merchant_total_orders ?? 0;
          const isBuy = side === 'sell';

          return (
            <div key={ad.id} className="rounded-lg border border-border/20 bg-card p-4 transition-colors duration-100 hover:bg-muted/5">
              {/* top: merchant */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                    {(ad.username || 'M')[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-[13px] font-medium text-foreground truncate">{ad.username || 'Merchant'}</span>
                      {verified && <ShieldCheck className="h-3 w-3 shrink-0 text-[#0ecb81]" />}
                    </div>
                    <span className="text-[10px] text-muted-foreground">{orders} orders · {completion}</span>
                  </div>
                </div>
                <CoinIcon symbol={ad.crypto_symbol || ''} size={22} />
              </div>

              {/* price */}
              <div className="mb-2.5">
                <span className={`font-mono text-[18px] font-bold leading-tight ${isBuy ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}>
                  {sym}{price}
                </span>
                <span className="ml-1 text-[11px] text-muted-foreground">/{ad.crypto_symbol}</span>
              </div>

              {/* stats row */}
              <div className="mb-3 flex gap-5 text-[11px]">
                <div>
                  <span className="block text-muted-foreground/60">Available</span>
                  <span className="font-mono text-foreground">{ad.available_amount} {ad.crypto_symbol}</span>
                </div>
                <div>
                  <span className="block text-muted-foreground/60">Limit</span>
                  <span className="font-mono text-foreground">{sym}{minA} – {sym}{maxA}</span>
                </div>
              </div>

              {/* bottom: payments + action */}
              <div className="flex items-center justify-between">
                <div className="flex flex-wrap gap-1">
                  {payments.map((p, i) => (
                    <span key={i} className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${pmCls(p)}`}>{p}</span>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={!authed}
                  onClick={() => onTakeAd(ad)}
                  title={!authed ? 'Log in to trade' : undefined}
                  className={`shrink-0 rounded-md px-4 py-1.5 text-[12px] font-semibold transition-colors duration-150 disabled:opacity-40 ${
                    isBuy
                      ? 'bg-[#0ecb81] text-white hover:bg-[#0ecb81]/85'
                      : 'bg-[#f6465d] text-white hover:bg-[#f6465d]/85'
                  }`}
                >
                  {isBuy ? 'Buy' : 'Sell'} {ad.crypto_symbol}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Desktop: Binance-style dense table ── */}
      <div className="hidden md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border/20 text-[11px] text-muted-foreground/70">
              <th className="py-3 pl-4 pr-2 font-medium">Advertisers</th>
              <th className="px-3 py-3 font-medium">Price</th>
              <th className="px-3 py-3 font-medium">Limit/Available</th>
              <th className="px-3 py-3 font-medium">Payment</th>
              <th className="py-3 pl-3 pr-4 text-right font-medium">
                Trade <span className="text-[10px] text-primary/70">0 Fee</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((ad) => {
              const side = p2pAdSide(ad);
              const price = p2pAdDisplayPrice(ad);
              const minA = ad.min_amount ?? '0';
              const maxA = ad.max_amount ?? '0';
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
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                        {(ad.username || 'M')[0].toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          {uid ? (
                            <Link
                              href={p2pProfilePath(String(uid))}
                              className="text-[13px] font-medium text-foreground transition-colors hover:text-primary"
                            >
                              {ad.username || 'Merchant'}
                            </Link>
                          ) : (
                            <span className="text-[13px] font-medium text-foreground">{ad.username || 'Merchant'}</span>
                          )}
                          {verified && <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[#0ecb81]" />}
                        </div>
                        <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span>{orders} order{orders !== 1 ? 's' : ''}</span>
                          <span className="text-border/40">|</span>
                          <span>{completion}% completion</span>
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* Price */}
                  <td className="px-3 py-4">
                    <span className={`font-mono text-[15px] font-bold leading-tight ${isBuy ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}>
                      {sym} {price}
                    </span>
                  </td>

                  {/* Limit / Available */}
                  <td className="px-3 py-4">
                    <div className="space-y-0.5 text-[12px]">
                      <p>
                        <span className="text-muted-foreground/60">Available </span>
                        <span className="font-mono text-foreground">{ad.available_amount} {ad.crypto_symbol}</span>
                      </p>
                      <p>
                        <span className="text-muted-foreground/60">Limit </span>
                        <span className="font-mono text-foreground">{sym}{minA} – {sym}{maxA}</span>
                      </p>
                    </div>
                  </td>

                  {/* Payment */}
                  <td className="px-3 py-4">
                    <div className="flex flex-wrap gap-1">
                      {payments.length > 0 ? (
                        payments.map((p, i) => (
                          <span
                            key={i}
                            className={`rounded border px-2 py-0.5 text-[10px] font-medium leading-tight ${pmCls(p)}`}
                          >
                            {p}
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] text-muted-foreground/40">—</span>
                      )}
                    </div>
                  </td>

                  {/* Trade */}
                  <td className="py-4 pl-3 pr-4 text-right">
                    <button
                      type="button"
                      disabled={!authed}
                      onClick={() => onTakeAd(ad)}
                      title={!authed ? 'Log in to trade' : undefined}
                      className={`inline-flex items-center justify-center rounded-md px-5 py-[7px] text-[12px] font-semibold transition-all duration-150 disabled:opacity-40 ${
                        isBuy
                          ? 'bg-[#0ecb81] text-white hover:bg-[#0ecb81]/85 active:bg-[#0ecb81]/70'
                          : 'bg-[#f6465d] text-white hover:bg-[#f6465d]/85 active:bg-[#f6465d]/70'
                      }`}
                    >
                      {isBuy ? 'Buy' : 'Sell'} {ad.crypto_symbol}
                    </button>
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
