/**
 * Coin Info Service
 * Fetches and caches coin metadata from CoinGecko free API.
 */
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

const LOG_CAT = 'coin-info';
const CACHE_PREFIX = 'coininfo:';
const CACHE_TTL = 3600;

const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', BNB: 'binancecoin', SOL: 'solana',
  XRP: 'ripple', ADA: 'cardano', AVAX: 'avalanche-2', DOT: 'polkadot',
  ATOM: 'cosmos', NEAR: 'near', SUI: 'sui', APT: 'aptos',
  SEI: 'sei-network', TRX: 'tron', LTC: 'litecoin', MATIC: 'matic-network',
  ARB: 'arbitrum', OP: 'optimism', IMX: 'immutable-x', UNI: 'uniswap',
  AAVE: 'aave', LINK: 'chainlink', MKR: 'maker', LDO: 'lido-dao',
  INJ: 'injective-protocol', DOGE: 'dogecoin', SHIB: 'shiba-inu',
  PEPE: 'pepe', WIF: 'dogwifcoin', FLOKI: 'floki', BONK: 'bonk',
  FET: 'fetch-ai', RENDER: 'render-token', WLD: 'worldcoin-wld',
  FIL: 'filecoin', GRT: 'the-graph', AR: 'arweave', ICP: 'internet-computer',
  HBAR: 'hedera-hashgraph', VET: 'vechain',
  USDT: 'tether', USDC: 'usd-coin', DAI: 'dai',
};

export interface CoinInfo {
  symbol: string;
  name: string;
  description: string;
  image: string;
  market_cap: number;
  market_cap_rank: number | null;
  current_price: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  total_volume: number;
  circulating_supply: number;
  total_supply: number | null;
  max_supply: number | null;
  ath: number;
  ath_date: string;
  atl: number;
  atl_date: string;
  homepage: string;
  blockchain_site: string;
}

export async function getCoinInfo(symbol: string): Promise<CoinInfo | null> {
  const upper = symbol.toUpperCase();
  const cacheKey = `${CACHE_PREFIX}${upper}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch { /* ignore */ }

  const geckoId = COINGECKO_IDS[upper];
  if (!geckoId) {
    return buildFallbackInfo(upper);
  }

  try {
    const url = `https://api.coingecko.com/api/v3/coins/${geckoId}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      logger.debug(`[${LOG_CAT}] CoinGecko request failed for ${upper}, status=${res.status}`);
      return buildFallbackInfo(upper);
    }

    const data = await res.json() as Record<string, unknown>;
    const market = (data.market_data ?? {}) as Record<string, unknown>;
    const usd = (k: string) => {
      const obj = market[k] as Record<string, unknown> | undefined;
      return typeof obj?.usd === 'number' ? obj.usd : 0;
    };

    const info: CoinInfo = {
      symbol: upper,
      name: String(data.name ?? upper),
      description: truncate(String((data.description as Record<string, string>)?.en ?? ''), 500),
      image: String((data.image as Record<string, string>)?.large ?? ''),
      market_cap: usd('market_cap'),
      market_cap_rank: typeof data.market_cap_rank === 'number' ? data.market_cap_rank : null,
      current_price: usd('current_price'),
      price_change_24h: usd('price_change_24h'),
      price_change_percentage_24h: typeof market.price_change_percentage_24h === 'number' ? market.price_change_percentage_24h : 0,
      total_volume: usd('total_volume'),
      circulating_supply: typeof market.circulating_supply === 'number' ? market.circulating_supply : 0,
      total_supply: typeof market.total_supply === 'number' ? market.total_supply : null,
      max_supply: typeof market.max_supply === 'number' ? market.max_supply : null,
      ath: usd('ath'),
      ath_date: String((market.ath_date as Record<string, string>)?.usd ?? ''),
      atl: usd('atl'),
      atl_date: String((market.atl_date as Record<string, string>)?.usd ?? ''),
      homepage: String(((data.links as Record<string, unknown>)?.homepage as string[])?.[0] ?? ''),
      blockchain_site: String(((data.links as Record<string, unknown>)?.blockchain_site as string[])?.[0] ?? ''),
    };

    try {
      await redis.set(cacheKey, JSON.stringify(info), CACHE_TTL);
    } catch { /* ignore */ }

    return info;
  } catch (e) {
    logger.debug(`[${LOG_CAT}] CoinGecko fetch error for ${upper}: ${e instanceof Error ? e.message : 'unknown'}`);
    return buildFallbackInfo(upper);
  }
}

function buildFallbackInfo(symbol: string): CoinInfo {
  return {
    symbol,
    name: symbol,
    description: '',
    image: '',
    market_cap: 0,
    market_cap_rank: null,
    current_price: 0,
    price_change_24h: 0,
    price_change_percentage_24h: 0,
    total_volume: 0,
    circulating_supply: 0,
    total_supply: null,
    max_supply: null,
    ath: 0,
    ath_date: '',
    atl: 0,
    atl_date: '',
    homepage: '',
    blockchain_site: '',
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/<[^>]*$/, '') + '…';
}
