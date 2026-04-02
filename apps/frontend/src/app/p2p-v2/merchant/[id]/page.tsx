'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { fetchP2PAds, P2P_V2_ADS_KEY } from '@/lib/p2pApi';
import { p2pAdDisplayPrice, formatFiatSymbol } from '@/lib/p2p-v2-utils';
import { P2PMerchantCard } from '@/components/p2p-v2/P2PMerchantCard';
import { Skeleton } from '@/components/ui/Skeleton';

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
      fetchP2PAds({
        advertiser_id: merchantId,
        limit: 50,
        offset: 0,
      }),
    enabled: !!merchantId,
  });

  const head = ads[0];
  const fiat = head?.fiat_currency ?? 'INR';

  return (
    <div className="space-y-6">
      <Link href="/p2p" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
        ← Marketplace
      </Link>
      {isLoading ? (
        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-[#1e2329]">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-full max-w-sm" />
        </div>
      ) : null}
      {!isLoading && !head && <p className="text-sm text-gray-500">No active ads for this user.</p>}
      {head && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-[#1e2329]">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Merchant</h1>
          <div className="mt-2">
            <P2PMerchantCard ad={head} fiat={fiat} />
          </div>
        </div>
      )}

      <h2 className="text-sm font-medium text-gray-900 dark:text-white">Active ads</h2>
      <div className="space-y-2">
        {ads.map((ad) => {
          const sym = formatFiatSymbol(ad.fiat_currency || fiat);
          return (
            <div
              key={ad.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-[#1e2329]"
            >
              <span className="text-sm text-gray-900 dark:text-white">
                {ad.crypto_symbol} · {sym}
                {p2pAdDisplayPrice(ad)}
              </span>
              <Link href="/p2p" className="text-xs text-blue-600 dark:text-blue-400">
                Trade on marketplace
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
