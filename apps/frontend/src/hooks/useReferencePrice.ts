'use client';

import { useState, useEffect, useCallback } from 'react';

/** Map base asset to CoinGecko API id (display-only reference price) */
const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  USDT: 'tether',
  USDC: 'usd-coin',
  BNB: 'binancecoin',
  SOL: 'solana',
  XRP: 'ripple',
  DOGE: 'dogecoin',
  ADA: 'cardano',
  AVAX: 'avalanche-2',
  MATIC: 'matic-network',
  DOT: 'polkadot',
  LINK: 'chainlink',
  UNI: 'uniswap',
  ATOM: 'cosmos',
  LTC: 'litecoin',
  BCH: 'bitcoin-cash',
  NEAR: 'near',
  APT: 'aptos',
  ARB: 'arbitrum',
  OP: 'optimism',
  INJ: 'injective-protocol',
  SUI: 'sui',
  SEI: 'sei-network',
  TIA: 'celestia',
  PEPE: 'pepe',
  WIF: 'dogwifcoin',
  FET: 'fetch-ai',
  RENDER: 'render-token',
};

const COINGECKO_API = 'https://api.coingecko.com/api/v3';

export interface ReferencePrice {
  price: number | null;
  changePercent24h: number | null;
}

function getGeckoId(baseAsset: string): string {
  const upper = (baseAsset || '').toUpperCase();
  return COINGECKO_IDS[upper] ?? upper.toLowerCase().replace(/\s/g, '-');
}

/**
 * Display-only reference price from CoinGecko. Do not use for order execution.
 */
export function useReferencePrice(symbol: string | null, quoteCurrency = 'usd'): ReferencePrice {
  const [data, setData] = useState<ReferencePrice>({ price: null, changePercent24h: null });

  const fetchPrice = useCallback(async () => {
    if (!symbol || !symbol.includes('_')) {
      setData({ price: null, changePercent24h: null });
      return;
    }
    const [base] = symbol.split('_');
    const id = getGeckoId(base);
    const vs = quoteCurrency.toLowerCase();
    try {
      const url = `${COINGECKO_API}/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=${vs}&include_24hr_change=true`;
      const res = await fetch(url);
      if (!res.ok) {
        setData({ price: null, changePercent24h: null });
        return;
      }
      const json = (await res.json()) as Record<string, Record<string, number | null>>;
      const coin = json[id];
      if (!coin) {
        setData({ price: null, changePercent24h: null });
        return;
      }
      const price = (coin[vs] ?? coin.usd ?? coin.usdt) as number | null ?? null;
      const changeKey = `${vs}_24h_change`;
      const changePercent24h = (coin[changeKey] ?? null) as number | null;
      setData({ price: price ?? null, changePercent24h });
    } catch {
      setData({ price: null, changePercent24h: null });
    }
  }, [symbol, quoteCurrency]);

  useEffect(() => {
    fetchPrice();
    const t = setInterval(fetchPrice, 60_000);
    return () => clearInterval(t);
  }, [fetchPrice]);

  return data;
}
