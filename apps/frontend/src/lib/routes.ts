/**
 * Single source of truth for user-app paths (navigation + legacy→canonical maps).
 * Prefer importing `ROUTES` in UI; tier1-shell-routes re-exports for backward compatibility.
 */

/** Prefix-only URLs still reachable when canonical redirects are off (active-state matching). */
export const LEGACY_PATH_PREFIXES = {
  p2pV2: '/p2p-v2',
  dashboardEarn: '/dashboard/earn',
  dashboardSpot: '/dashboard/spot',
} as const;

export const ROUTES = {
  home: '/',
  markets: '/markets',
  orders: '/orders',
  wallet: '/wallet',
  p2p: '/p2p',
  /** Tier-1 earn hub (implementation re-exports dashboard earn page). */
  earn: '/earn',
  tradeSpot: '/trade/spot',
  /** Legacy public URL; middleware may redirect to tradeSpot when canonical mode is on */
  spotLegacy: '/spot',
  login: '/login',
  signup: '/signup',
  forgotPassword: '/forgot-password',
  cookies: '/cookies',
  privacy: '/privacy',
  terms: '/terms',
  dashboard: {
    root: '/dashboard',
    account: '/dashboard/account',
    identity: '/dashboard/identity',
    security: '/dashboard/security',
    securityWithdrawalLimits: '/dashboard/security/withdrawal-limits',
    dataExport: '/dashboard/data-export',
    preferences: '/dashboard/preferences',
    progress: '/dashboard/progress',
    referral: '/dashboard/referral',
    api: '/dashboard/api',
    feeRates: '/dashboard/fee-rates',
    help: '/dashboard/help',
    announcements: '/dashboard/announcements',
    demoTrading: '/dashboard/demo-trading',
    copyTrading: '/dashboard/copy-trading',
  },
} as const;

export const walletPath = {
  overview: ROUTES.wallet,
  funding: `${ROUTES.wallet}/funding`,
  unified: `${ROUTES.wallet}/unified`,
  convert: `${ROUTES.wallet}/convert`,
  history: `${ROUTES.wallet}/history`,
  pnl: `${ROUTES.wallet}/pnl`,
  depositCrypto: `${ROUTES.wallet}/deposit/crypto`,
  withdrawCrypto: `${ROUTES.wallet}/withdraw/crypto`,
  withdrawFiat: `${ROUTES.wallet}/withdraw/fiat`,
  transfer: `${ROUTES.wallet}/transfer`,
} as const;

export const MARKETS_HREF = ROUTES.markets;
export const ORDERS_HREF = ROUTES.orders;
export const WALLET_HREF = ROUTES.wallet;
export const P2P_HREF = ROUTES.p2p;
export const SPOT_TRADE_HREF = ROUTES.tradeSpot;

export function tradeSpotWithSymbol(symbol: string): string {
  const normalized = symbol.replace(/-/g, '_');
  return `${ROUTES.tradeSpot}?${new URLSearchParams({ symbol: normalized }).toString()}`;
}

export function p2pProfilePath(userId: string): string {
  return `${ROUTES.p2p}/profile/${encodeURIComponent(userId)}`;
}

export function p2pOrderPath(orderId: string): string {
  return `${ROUTES.p2p}/orders/${encodeURIComponent(orderId)}`;
}

export function loginWithRedirect(redirectPath: string): string {
  return `${ROUTES.login}?redirect=${encodeURIComponent(redirectPath)}`;
}

export function dashboardAnnouncementPath(id: string): string {
  return `${ROUTES.dashboard.announcements}/${encodeURIComponent(id)}`;
}

/** Map /dashboard/assets/* → /wallet */
export function mapDashboardAssetsPathToWallet(pathname: string): string | null {
  if (pathname === '/dashboard/assets' || pathname === '/dashboard/assets/overview') {
    return ROUTES.wallet;
  }
  if (pathname.startsWith('/dashboard/assets/')) {
    return `${ROUTES.wallet}${pathname.slice('/dashboard/assets'.length)}`;
  }
  return null;
}

/**
 * Legacy dashboard shell → Tier-1 canonical paths.
 * Returns null when the URL should stay on /dashboard (account, security, etc.).
 */
export function mapLegacyDashboardPathToCanonical(pathname: string): string | null {
  const assets = mapDashboardAssetsPathToWallet(pathname);
  if (assets) return assets;

  if (pathname === '/dashboard/earn' || pathname.startsWith('/dashboard/earn/')) {
    return pathname.replace(/^\/dashboard\/earn/, ROUTES.earn);
  }

  if (pathname === '/dashboard/wallet/spot') {
    return ROUTES.wallet;
  }
  if (pathname.startsWith('/dashboard/wallet/')) {
    return `${ROUTES.wallet}${pathname.slice('/dashboard/wallet'.length)}`;
  }

  if (pathname === '/dashboard/markets' || pathname.startsWith('/dashboard/markets/')) {
    return pathname.replace(/^\/dashboard\/markets/, ROUTES.markets);
  }
  if (pathname === '/dashboard/orders' || pathname.startsWith('/dashboard/orders/')) {
    return pathname.replace(/^\/dashboard\/orders/, ROUTES.orders);
  }
  if (pathname.startsWith('/dashboard/deposit/crypto')) {
    return pathname.replace('/dashboard/deposit/crypto', walletPath.depositCrypto);
  }
  if (pathname === '/dashboard/deposit') {
    return walletPath.depositCrypto;
  }
  if (pathname.startsWith('/dashboard/withdraw/crypto')) {
    return pathname.replace('/dashboard/withdraw/crypto', walletPath.withdrawCrypto);
  }
  if (pathname.startsWith('/dashboard/withdraw/fiat')) {
    return pathname.replace('/dashboard/withdraw/fiat', walletPath.withdrawFiat);
  }
  if (pathname === '/dashboard/withdraw') {
    return walletPath.withdrawCrypto;
  }
  if (pathname === '/dashboard/transfer' || pathname.startsWith('/dashboard/transfer/')) {
    return pathname.replace(/^\/dashboard\/transfer/, walletPath.transfer);
  }
  if (pathname === '/dashboard/p2p' || pathname.startsWith('/dashboard/p2p/')) {
    const suffix = pathname.slice('/dashboard/p2p'.length);
    return suffix ? `${ROUTES.p2p}${suffix}` : ROUTES.p2p;
  }
  return null;
}

/**
 * /p2p-v2/* → /p2p/*; /p2p-v2/merchant/:id → /p2p/profile/:id.
 * /p2p/merchant/:id → /p2p/profile/:id (canonical profile URL).
 */
export function mapLegacyP2pPathToCanonical(pathname: string): string | null {
  if (pathname.startsWith('/p2p-v2/merchant/')) {
    return pathname.replace(/^\/p2p-v2\/merchant/, `${ROUTES.p2p}/profile`);
  }
  if (pathname.startsWith('/p2p/merchant/')) {
    return pathname.replace(/^\/p2p\/merchant/, `${ROUTES.p2p}/profile`);
  }
  if (pathname === '/p2p-v2' || pathname.startsWith('/p2p-v2/')) {
    return pathname.replace(/^\/p2p-v2/, ROUTES.p2p);
  }
  return null;
}
