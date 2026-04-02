'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchP2PReferencePrice } from '@/lib/p2pApi';

export type P2pReferencePriceState = {
  price: number | null;
  market: string | null;
  source: string | null;
  updatedAt: string | null;
};

/**
 * Backend-controlled reference price (internal spot), refreshed on interval.
 */
export function useP2pReferencePrice(asset: string, fiat: string, refetchMs = 4000): P2pReferencePriceState {
  const upperAsset = (asset || 'USDT').toUpperCase();
  const upperFiat = (fiat || 'INR').toUpperCase();

  const q = useQuery({
    queryKey: ['p2p', 'reference-price', upperAsset, upperFiat],
    queryFn: () => fetchP2PReferencePrice(upperAsset, upperFiat),
    enabled: !!upperAsset && !!upperFiat,
    refetchInterval: refetchMs,
    staleTime: Math.min(refetchMs, 3000),
  });

  const d = q.data;
  const n = d?.reference_price != null ? parseFloat(String(d.reference_price)) : NaN;
  return {
    price: Number.isFinite(n) && n > 0 ? n : null,
    market: d?.market ?? null,
    source: d?.source ?? null,
    updatedAt: d?.updated_at ?? null,
  };
}
