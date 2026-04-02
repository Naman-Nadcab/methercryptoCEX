/**
 * Tier-1 canonical routing (middleware + active-route helpers).
 */
import { ROUTES, LEGACY_PATH_PREFIXES } from './routes';

export const SPOT_TRADE_HREF = ROUTES.tradeSpot;

export function isSpotTradePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === SPOT_TRADE_HREF || pathname === LEGACY_PATH_PREFIXES.dashboardSpot;
}

export type CanonicalRedirect = { from: string; to: string; note?: string };

/** Exact path redirects; middleware preserves `search`. Order: longer `from` first where relevant. */
export const CANONICAL_REDIRECTS_EXACT: CanonicalRedirect[] = [
  { from: '/dashboard/trade/spot', to: ROUTES.tradeSpot, note: 'Legacy simple spot UI → terminal' },
  { from: '/dashboard/trade', to: ROUTES.tradeSpot, note: 'Alias' },
  { from: '/dashboard/spot', to: ROUTES.tradeSpot, note: 'Spot terminal' },
  { from: ROUTES.spotLegacy, to: ROUTES.tradeSpot, note: 'Legacy /spot → canonical terminal' },
];

export const DEPRECATED_ROUTE_PREFIXES = [
  '/dashboard/spot',
  '/dashboard/trade',
  '/p2p-v2',
  '/dashboard/p2p',
  '/dashboard/markets',
  '/dashboard/orders',
  '/dashboard/assets',
  '/dashboard/deposit',
  '/dashboard/withdraw',
  '/dashboard/transfer',
  '/dashboard/wallet',
  '/dashboard/earn',
  '/spot',
] as const;

export function isDeprecatedRoutePath(pathname: string): boolean {
  return DEPRECATED_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
