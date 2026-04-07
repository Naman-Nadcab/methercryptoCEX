'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { fetchP2PAds, P2P_V2_ADS_KEY } from '@/lib/p2pApi';
import { p2pAdDisplayPrice, p2pAdSide, formatFiatSymbol } from '@/lib/p2p-v2-utils';
import { Skeleton } from '@/components/ui/Skeleton';
import { CoinIcon } from '@/components/ui/CoinIcon';
import { ArrowLeft, ShieldCheck, Store } from 'lucide-react';

export default function P2PV2MerchantProfilePage() {
  const params = useParams();
  const merchantId =
    typeof params?.id === 'string'
      ? params.id
      : typeof params?.userId === 'string'
        ? params.userId
        : '';

  const { data: ads = [], isLoading } = useQuery({
    queryKey: [...P2P_V2_ADS_KEY, 'merchant', merchantId],
    queryFn: () =>
      fetchP2PAds({ advertiser_id: merchantId, limit: 50, offset: 0 }),
    enabled: !!merchantId,
  });

  const head = ads[0];
  const fiat = head?.fiat_currency ?? 'INR';
  const verified = Boolean((head as { verified_merchant?: boolean } | undefined)?.verified_merchant);
  const orders = head?.merchant_total_orders ?? 0;
  const completion = head?.merchant_completion_rate != null ? `${head.merchant_completion_rate}%` : '—';

  return (
    <div className="mx-auto max-w-[1000px] px-4 sm:px-6">
      <div className="flex items-center border-b border-border/20 py-3">
        <Link href="/p2p" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Marketplace
        </Link>
      </div>

      {isLoading && (
        <div className="mt-5 space-y-3">
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-32 rounded-lg" />
        </div>
      )}

      {!isLoading && !head && (
        <div className="flex flex-col items-center py-16 text-center">
          <Store className="h-8 w-8 text-muted-foreground/20 mb-2" />
          <p className="text-sm text-muted-foreground">No active ads for this merchant.</p>
        </div>
      )}

      {head && (
        <div className="mt-5 space-y-4">
          {/* Merchant info */}
          <div className="flex items-center gap-3 rounded-lg border border-border/30 bg-card p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
              {(head.username || 'M')[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-lg font-semibold text-foreground truncate">{head.username || 'Merchant'}</span>
                {verified && <ShieldCheck className="h-4 w-4 shrink-0 text-[#0ecb81]" />}
              </div>
              <p className="text-xs text-muted-foreground">{orders} orders · {completion} completion</p>
            </div>
          </div>

          {/* Ads table */}
          <h2 className="text-sm font-semibold text-foreground">Active Ads</h2>
          <div className="rounded-lg border border-border/30 bg-card overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border/15 text-xs text-muted-foreground/60">
                  <th className="py-2.5 pl-4 pr-3 font-medium">Asset</th>
                  <th className="px-3 py-2.5 font-medium">Side</th>
                  <th className="px-3 py-2.5 font-medium">Price</th>
                  <th className="px-3 py-2.5 font-medium">Available</th>
                  <th className="py-2.5 pl-3 pr-4 font-medium" />
                </tr>
              </thead>
              <tbody>
                {ads.map((ad) => {
                  const sym = formatFiatSymbol(ad.fiat_currency || fiat);
                  const side = p2pAdSide(ad);
                  const isBuy = side === 'sell';
                  return (
                    <tr key={ad.id} className="border-b border-border/10 hover:bg-muted/[0.04]">
                      <td className="py-3 pl-4 pr-3">
                        <span className="flex items-center gap-1.5">
                          <CoinIcon symbol={ad.crypto_symbol || ''} size={16} />
                          <span className="text-sm font-medium text-foreground">{ad.crypto_symbol}</span>
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                          isBuy ? 'bg-[#0ecb81]/10 text-[#0ecb81]' : 'bg-[#f6465d]/10 text-[#f6465d]'
                        }`}>
                          {isBuy ? 'Buy' : 'Sell'}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`font-mono text-sm font-bold ${isBuy ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}>
                          {sym}{p2pAdDisplayPrice(ad)}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-sm font-mono text-foreground">
                        {ad.available_amount} {ad.crypto_symbol}
                      </td>
                      <td className="py-3 pl-3 pr-4 text-right">
                        <Link href="/p2p" className="text-sm font-medium text-primary hover:underline">
                          Trade
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
