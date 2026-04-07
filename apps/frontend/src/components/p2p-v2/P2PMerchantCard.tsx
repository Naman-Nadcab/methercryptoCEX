'use client';

import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import type { P2PAdRow } from '@/lib/p2pApi';
import { p2pProfilePath } from '@/lib/routes';

type Props = {
  ad: P2PAdRow;
  fiat: string;
};

export function P2PMerchantCard({ ad, fiat }: Props) {
  const uid = ad.user_id;
  const verified = Boolean((ad as { verified_merchant?: boolean }).verified_merchant);
  const completion = ad.merchant_completion_rate != null ? String(ad.merchant_completion_rate) : '—';
  const trades = ad.merchant_total_orders ?? 0;
  const releaseMin = (ad as { merchant_avg_release_time_minutes?: string | number }).merchant_avg_release_time_minutes;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      {uid ? (
        <Link href={p2pProfilePath(String(uid))} className="font-bold text-primary hover:underline transition-colors duration-150">
          {ad.username || 'Merchant'}
        </Link>
      ) : (
        <span className="font-bold text-foreground">{ad.username || 'Merchant'}</span>
      )}
      {verified && (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-[#0ecb81]/10 px-2.5 py-1 text-xs font-bold text-[#0ecb81]">
          <ShieldCheck className="h-3 w-3" />
          Verified
        </span>
      )}
      <span className="text-muted-foreground/30">·</span>
      <span>{completion}%</span>
      <span className="text-muted-foreground/30">·</span>
      <span>{trades} orders</span>
      {releaseMin != null && Number(releaseMin) > 0 && (
        <>
          <span className="text-muted-foreground/30">·</span>
          <span>~{releaseMin}m</span>
        </>
      )}
    </div>
  );
}
