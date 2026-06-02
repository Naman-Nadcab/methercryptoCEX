'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import {
  Star,
  ChevronRight,
  Check,
  Shield,
  HelpCircle,
  TrendingUp,
  TrendingDown,
  User,
  Copy,
  Wallet,
  Gift,
  Bell,
  Zap,
  BarChart3,
  ArrowRight,
  Target,
  Clock,
  CheckCircle2,
  Send,
  ClipboardList,
  Users,
  LineChart,
  Receipt,
  AlertCircle,
  LayoutGrid,
  ExternalLink,
  ArrowLeftRight,
  History,
} from 'lucide-react';
import { useBalancesSummary } from '@/lib/balances';
import { EXCHANGE_PROGRESS_STEPS } from '@/data/exchangeProgressSteps';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { TOOLTIP_PAIR, TOOLTIP_LAST_PRICE, TOOLTIP_24H_CHANGE } from '@/lib/marketDataUxCopy';
import { MiniSparkline } from '@/components/dashboard/MiniSparkline';
import { DashboardPageShell } from '@/components/dashboard/DashboardPageShell';
import { CoinIcon } from '@/components/ui/CoinIcon';
import { useDisplayCurrency } from '@/context/DisplayCurrencyProvider';

interface AnnouncementItem {
  id: string;
  title: string;
  summary: string | null;
  type: string;
  is_pinned: boolean;
  published_at: string | null;
  created_at: string;
}

type TickerRow = { pair: string; quote: string; price: number; change: number | null };

function parseTickerChangePct(ch: unknown): number | null {
  if (typeof ch === 'number' && Number.isFinite(ch)) return ch;
  if (ch == null || ch === '') return null;
  const n = Number(ch);
  return Number.isFinite(n) ? n : null;
}

const OVERVIEW_SHORTCUTS: { href: string; label: string; icon: typeof BarChart3; desc: string }[] = [
  { href: '/markets', label: 'Markets', icon: LineChart, desc: 'All pairs' },
  { href: '/trade/spot', label: 'Spot', icon: BarChart3, desc: 'Trade' },
  { href: '/p2p', label: 'P2P', icon: Users, desc: 'Buy / Sell' },
  { href: '/orders', label: 'Orders', icon: ClipboardList, desc: 'History' },
  { href: '/dashboard/fee-rates', label: 'Fees', icon: Receipt, desc: 'Your tier' },
];

function formatUsd(n: number) {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Matches Help Center page topic count (static preview). */
const HELP_CENTER_TOPIC_COUNT = 12;
const HELP_PREVIEW_SNIPPETS = 'Deposits, fees, VIP, passkeys & P2P';

const P2P_TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'expired', 'failed']);

type ReferralRailPreview = { code: string; referrals: number; earnings: number; commissionPct: number };
type FeeRailPreview = {
  vipLevel: number;
  vipName: string;
  maker: number;
  taker: number;
  mnt: boolean;
  volumeTierLabel?: string;
};
type P2PRailPreview = { total: number; active: number };

const DEFAULT_FEE_RAIL: FeeRailPreview = {
  vipLevel: 0,
  vipName: 'Regular User',
  maker: 0.1,
  taker: 0.1,
  mnt: false,
};

const HELP_TOPIC_PREVIEW_LINES = [
  'How to make a deposit',
  'Trading fees & VIP tiers',
  'P2P pay, confirm & release',
];

const DASHBOARD_TIPS_WHEN_NO_NEWS = [
  { t: 'Security', d: 'Turn on 2FA and passkeys under Account → Security.' },
  { t: 'Spot', d: 'Use limit orders to control price; check min notional on the order form.' },
  { t: 'P2P', d: 'Only pay using listed methods; never transfer off-platform.' },
];

/** Avoid infinite skeletons when API or Redis is slow. */
async function fetchJsonWithTimeout<T = unknown>(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const { timeoutMs = 14000, ...init } = options;
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let parsed: T | null = null;
    try {
      parsed = text ? (JSON.parse(text) as T) : null;
    } catch {
      parsed = null;
    }
    return { ok: res.ok, status: res.status, data: parsed };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(id);
  }
}

function normalizeTickerPayload(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray((raw as { tickers?: unknown[] }).tickers)) {
    return (raw as { tickers: unknown[] }).tickers;
  }
  return [];
}

function RailCardPreviewSkeleton() {
  return (
    <div className="mt-3 flex min-h-[148px] flex-1 flex-col rounded-xl border border-border bg-muted/20 p-3">
      <div className="flex flex-1 flex-col justify-center gap-3">
        <div className="h-4 w-[90%] animate-pulse rounded-md bg-muted" />
        <div className="grid grid-cols-2 gap-2">
          <div className="h-14 animate-pulse rounded-lg bg-muted" />
          <div className="h-14 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, accessToken, _hasHydrated } = useAuthStore();
  const { displayCurrency, formatFromUsdt } = useDisplayCurrency();
  const { data: balanceData } = useBalancesSummary(!!_hasHydrated && !!accessToken);
  const totalUsd = (balanceData?.fundingBalance?.totalUsd ?? 0) + (balanceData?.tradingBalance?.totalUsd ?? 0);
  const fundingUsd = balanceData?.fundingBalance?.totalUsd ?? 0;
  const tradingUsd = balanceData?.tradingBalance?.totalUsd ?? 0;
  const balanceErrorMsg = balanceData?.balanceError ?? null;
  const lastBalUpdate = balanceData?.lastUpdated ? new Date(balanceData.lastUpdated) : null;

  const [activeMarketTab, setActiveMarketTab] = useState('hot');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [uidCopied, setUidCopied] = useState(false);
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(true);
  const [announcementsError, setAnnouncementsError] = useState<string | null>(null);
  const [marketData, setMarketData] = useState<TickerRow[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [marketsLoadFailed, setMarketsLoadFailed] = useState(false);
  const [kycVerified, setKycVerified] = useState<boolean | null>(null);

  const [railPreviewsLoading, setRailPreviewsLoading] = useState(true);
  const [referralPreview, setReferralPreview] = useState<ReferralRailPreview | null>(null);
  const [feePreview, setFeePreview] = useState<FeeRailPreview | null>(null);
  const [p2pPreview, setP2pPreview] = useState<P2PRailPreview | null>(null);
  // Defer non-critical dashboard data so first paint feels snappier.
  const [deferSecondaryLoads, setDeferSecondaryLoads] = useState(false);
  // Defer heavy panel rendering/fetch for faster initial dashboard open.
  const [deferHeavyPanels, setDeferHeavyPanels] = useState(false);

  const progressDone = EXCHANGE_PROGRESS_STEPS.filter((s) => s.status === 'done').length;
  const progressTotal = EXCHANGE_PROGRESS_STEPS.length;
  const progressPct = progressTotal > 0 ? Math.round((progressDone / progressTotal) * 100) : 0;

  useEffect(() => {
    const t = window.setTimeout(() => setDeferSecondaryLoads(true), 700);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setDeferHeavyPanels(true), 450);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!deferSecondaryLoads) return;
    let cancelled = false;
    setAnnouncementsLoading(true);
    setAnnouncementsError(null);
    const url = getApiBaseUrl();
    if (!url) {
      setAnnouncementsLoading(false);
      setAnnouncementsError('API URL not configured');
      return;
    }
    (async () => {
      const { ok, status, data } = await fetchJsonWithTimeout<{
        success?: boolean;
        data?: { announcements?: AnnouncementItem[] };
      }>(`${url}/api/v1/user/announcements?limit=5`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        timeoutMs: 12000,
      });
      if (cancelled) return;
      if (status === 401) {
        setAnnouncements([]);
      } else if (data?.success && Array.isArray(data?.data?.announcements)) {
        setAnnouncements(data.data!.announcements!);
      } else if (!ok) {
        setAnnouncements([]);
        setAnnouncementsError(status === 0 ? 'Request timed out or network error' : 'Could not load announcements');
      } else {
        setAnnouncements([]);
      }
      setAnnouncementsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, deferSecondaryLoads]);

  useEffect(() => {
    if (!deferHeavyPanels) return;
    let cancelled = false;
    const url = getApiBaseUrl();
    setMarketsLoading(true);
    setMarketsLoadFailed(false);
    if (!url) {
      setMarketsLoading(false);
      setMarketsLoadFailed(true);
      return;
    }
    (async () => {
      const { ok, status, data } = await fetchJsonWithTimeout<{
        success?: boolean;
        data?: unknown;
      }>(`${url}/api/v1/spot/tickers`, { timeoutMs: 15000 });
      if (cancelled) return;
      if (status === 401) {
        setMarketData([]);
        setMarketsLoadFailed(true);
        setMarketsLoading(false);
        return;
      }
      const list = data?.success ? normalizeTickerPayload(data.data) : [];
      const rows: TickerRow[] = [];
      for (const item of list.slice(0, 16)) {
        if (!item || typeof item !== 'object') continue;
        const t = item as Record<string, unknown>;
        const base = (t.base_asset ?? t.baseAsset) as string | undefined;
        const quote = (t.quote_asset ?? t.quoteAsset) as string | undefined;
        if (!base || !quote) continue;
        const lp = (t.last_price ?? t.lastPrice) as string | null | undefined;
        const price = parseFloat(String(lp || '0')) || 0;
        const change = parseTickerChangePct(t.change_pct ?? t.changePct);
        rows.push({ pair: base, quote, price, change });
      }
      setMarketData(rows);
      setMarketsLoadFailed(!ok || rows.length === 0);
      setMarketsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [deferHeavyPanels]);

  useEffect(() => {
    if (!deferSecondaryLoads) return;
    if (!accessToken) return;
    fetch(`${getApiBaseUrl()}/api/v1/wallet/kyc-status`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((res) => res.json())
      .then((data) => {
        if (data?.success) setKycVerified(!!data.data?.verified);
      })
      .catch(() => setKycVerified(false));
  }, [accessToken, deferSecondaryLoads]);

  // Right-rail cards: lightweight previews (same APIs as destination pages)
  useEffect(() => {
    if (!deferSecondaryLoads) return;
    if (!_hasHydrated) return;

    if (!accessToken) {
      setRailPreviewsLoading(false);
      setReferralPreview(null);
      setFeePreview(null);
      setP2pPreview(null);
      return;
    }

    const apiUrl = getApiBaseUrl();
    if (!apiUrl) {
      setRailPreviewsLoading(false);
      return;
    }
    const headers = { Authorization: `Bearer ${accessToken}` };
    let cancelled = false;
    setRailPreviewsLoading(true);

    (async () => {
      try {
        const [refRes, feeRes, tierRes, p2pRes] = await Promise.allSettled([
          fetchJsonWithTimeout<{ success?: boolean; data?: unknown }>(`${apiUrl}/api/v1/user/referrals`, {
            headers,
            timeoutMs: 12000,
          }),
          fetchJsonWithTimeout<{ success?: boolean; data?: unknown }>(`${apiUrl}/api/v1/auth/fee-rates`, {
            headers,
            timeoutMs: 12000,
          }),
          fetchJsonWithTimeout<{ success?: boolean; data?: unknown }>(`${apiUrl}/api/v1/user/fee-tier`, {
            headers,
            timeoutMs: 12000,
          }),
          fetchJsonWithTimeout<{ success?: boolean; data?: unknown }>(`${apiUrl}/api/v1/p2p/my-orders`, {
            headers,
            timeoutMs: 12000,
          }),
        ]);

        if (cancelled) return;

        if (refRes.status === 'fulfilled') {
          const body = refRes.value.data as { success?: boolean; data?: unknown } | null;
          if (body?.success && body.data) {
            const d = body.data as {
              referralCode?: Record<string, unknown> | null;
              referrals?: unknown[];
            };
            const rc = d.referralCode;
            const codeFromRow =
              rc && typeof rc === 'object' ? String((rc.code as string | undefined) || '').trim() : '';
            const code = codeFromRow || user?.id?.slice(0, 8).toUpperCase() || '—';
            const totalEarningsRaw =
              rc && typeof rc === 'object'
                ? (rc.total_earnings as string | undefined) ?? (rc.totalEarnings as string | undefined)
                : undefined;
            const earnings = totalEarningsRaw != null ? parseFloat(String(totalEarningsRaw)) || 0 : 0;
            const rateRaw =
              rc && typeof rc === 'object'
                ? (rc.referrer_commission_rate as string | undefined) ?? (rc.referrerCommissionRate as string | undefined)
                : undefined;
            const commissionPct = rateRaw != null ? parseFloat(String(rateRaw)) * 100 : 20;
            const currentRefs =
              rc && typeof rc === 'object'
                ? (rc.current_referrals as number | undefined) ?? (rc.currentReferrals as number | undefined)
                : undefined;
            const referrals =
              typeof currentRefs === 'number'
                ? currentRefs
                : Array.isArray(d.referrals)
                  ? d.referrals.length
                  : 0;
            setReferralPreview({ code, referrals, earnings, commissionPct });
          } else {
            setReferralPreview(null);
          }
        } else {
          setReferralPreview(null);
        }

        let volumeTierLabel: string | undefined;
        if (tierRes.status === 'fulfilled') {
          const tBody = tierRes.value.data as { success?: boolean; data?: unknown } | null;
          if (tBody?.success && tBody.data) {
            const t = tBody.data as { tierName?: string; tierLevel?: number };
            if (t.tierName != null && String(t.tierName).trim()) volumeTierLabel = String(t.tierName).trim();
            else if (typeof t.tierLevel === 'number') volumeTierLabel = `Volume tier ${t.tierLevel}`;
          }
        }

        if (feeRes.status === 'fulfilled') {
          const fBody = feeRes.value.data as { success?: boolean; data?: unknown } | null;
          if (fBody?.success && fBody.data) {
            const d = fBody.data as {
              vipLevel?: number;
              vipLevelName?: string;
              spotFees?: { maker?: string | number; taker?: string | number };
              mntDiscount?: boolean;
            };
            const maker = parseFloat(String(d.spotFees?.maker ?? '0.1'));
            const taker = parseFloat(String(d.spotFees?.taker ?? '0.1'));
            setFeePreview({
              vipLevel: d.vipLevel ?? 0,
              vipName: d.vipLevelName || 'Regular User',
              maker,
              taker,
              mnt: !!d.mntDiscount,
              volumeTierLabel,
            });
          } else {
            setFeePreview(null);
          }
        } else {
          setFeePreview(null);
        }

        if (p2pRes.status === 'fulfilled') {
          const pBody = p2pRes.value.data as { success?: boolean; data?: unknown } | null;
          if (pBody?.success && Array.isArray(pBody.data)) {
          const orders = pBody.data as { status?: string }[];
          const total = orders.length;
          const active = orders.filter((o) => {
            const s = String(o.status || '').toLowerCase();
            return s.length > 0 && !P2P_TERMINAL_STATUSES.has(s);
          }).length;
          setP2pPreview({ total, active });
          } else {
            setP2pPreview(null);
          }
        } else {
          setP2pPreview(null);
        }
      } finally {
        if (!cancelled) setRailPreviewsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [_hasHydrated, accessToken, user?.id, deferSecondaryLoads]);

  const marketTabs = [
    { id: 'favorites', label: 'Favorites', icon: Star },
    { id: 'hot', label: 'Hot', icon: Zap },
    { id: 'gainers', label: 'Gainers', icon: TrendingUp },
    { id: 'losers', label: 'Losers', icon: TrendingDown },
  ];

  const toggleFavorite = (pair: string) => {
    setFavorites((prev) =>
      prev.includes(pair) ? prev.filter((p) => p !== pair) : [...prev, pair]
    );
  };

  const displayedMarketData = useMemo(() => {
    const data = [...marketData];
    if (activeMarketTab === 'favorites') {
      return data.filter((d) => favorites.includes(d.pair));
    }
    if (activeMarketTab === 'gainers') {
      return data.sort((a, b) => {
        const av = a.change;
        const bv = b.change;
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return bv - av;
      });
    }
    if (activeMarketTab === 'losers') {
      return data.sort((a, b) => {
        const av = a.change;
        const bv = b.change;
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av - bv;
      });
    }
    return data;
  }, [marketData, activeMarketTab, favorites]);

  const topMoverGainers = useMemo(() => {
    return [...marketData]
      .filter((d) => d.change != null && d.change > 0)
      .sort((a, b) => (b.change ?? 0) - (a.change ?? 0))
      .slice(0, 5);
  }, [marketData]);

  const topMoverLosers = useMemo(() => {
    return [...marketData]
      .filter((d) => d.change != null && d.change < 0)
      .sort((a, b) => (a.change ?? 0) - (b.change ?? 0))
      .slice(0, 5);
  }, [marketData]);

  const prevDashPriceRef = useRef<Record<string, number>>({});
  const [dashPriceFlash, setDashPriceFlash] = useState<Record<string, 'up' | 'down'>>({});
  useEffect(() => {
    const prev = prevDashPriceRef.current;
    const next: Record<string, 'up' | 'down'> = {};
    displayedMarketData.forEach((item) => {
      const k = `${item.pair}_${item.quote}`;
      const old = prev[k];
      const p = item.price;
      if (old !== undefined && Number.isFinite(old) && Number.isFinite(p) && p !== old) {
        if (p > old) next[k] = 'up';
        else if (p < old) next[k] = 'down';
      }
    });
    displayedMarketData.forEach((item) => {
      prev[`${item.pair}_${item.quote}`] = item.price;
    });
    if (Object.keys(next).length === 0) return;
    setDashPriceFlash(next);
    const id = window.setTimeout(() => setDashPriceFlash({}), 1000);
    return () => clearTimeout(id);
  }, [displayedMarketData]);

  const maskEmail = (email: string) => {
    if (!email) return '***@****';
    const [local, domain] = email.split('@');
    if (!domain) return '***@****';
    const maskedLocal = local.slice(0, 3) + '***';
    return `${maskedLocal}@${domain}`;
  };

  const copyUID = () => {
    if (user?.id) {
      navigator.clipboard.writeText(user.id);
      setUidCopied(true);
      setTimeout(() => setUidCopied(false), 2000);
    }
  };

  const showMarketsEmpty = !marketsLoading && marketData.length === 0;

  const feeRailDisplay: FeeRailPreview = feePreview ?? DEFAULT_FEE_RAIL;
  const p2pRailDisplay: P2PRailPreview = p2pPreview ?? { total: 0, active: 0 };
  const referralRailDisplay: ReferralRailPreview =
    referralPreview ?? {
      code: user?.id?.slice(0, 8).toUpperCase() || '—',
      referrals: 0,
      earnings: 0,
      commissionPct: 20,
    };
  const referralFromApi = referralPreview !== null;

  return (
    <div className="min-h-full bg-background">
      <DashboardPageShell
        title="Overview"
        description="Portfolio, markets, and account activity — your trading command center."
        breadcrumbs={[{ label: 'Overview' }]}
      >
        <div className="flex flex-col gap-6 lg:gap-8 xl:flex-row">
          <div className="min-w-0 flex-1 space-y-5 lg:space-y-6">
            {/* Portfolio summary */}
            <section className="rounded-xl border border-border bg-card shadow-sm">
              <div className="border-b border-border p-4 sm:p-5">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-4">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Estimated total balance
                        <InfoTooltip content="Combined funding and trading account balance in your selected display currency." className="ml-1" />
                      </p>
                      <p className="mt-1.5 text-3xl font-bold tabular-nums tracking-tight text-foreground sm:text-4xl">
                        {Number.isFinite(totalUsd) ? formatFromUsdt(totalUsd, 2) : '—'}
                        <span className="ml-2 text-lg font-semibold text-muted-foreground sm:text-xl">{displayCurrency}</span>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          24h portfolio PnL
                          <InfoTooltip content="Day-over-day portfolio change is not available from this summary yet." className="ml-1" />
                        </p>
                        <p className="mt-0.5 text-sm font-semibold tabular-nums text-muted-foreground">—</p>
                      </div>
                      {lastBalUpdate ? (
                        <p className="text-[11px] text-muted-foreground">
                          Updated {lastBalUpdate.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                        </p>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg border border-border bg-muted/50 p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Funding</p>
                        <p className="mt-1 text-base font-bold tabular-nums text-foreground sm:text-lg">{formatFromUsdt(fundingUsd, 2)}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">Deposits &amp; P2P</p>
                      </div>
                      <div className="rounded-lg border border-border bg-muted/50 p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Trading</p>
                        <p className="mt-1 text-base font-bold tabular-nums text-foreground sm:text-lg">{formatFromUsdt(tradingUsd, 2)}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">Spot &amp; open orders</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:max-w-xs sm:shrink-0">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <User className="h-6 w-6 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Account</p>
                      <p className="truncate text-sm font-semibold text-foreground">{maskEmail(user?.email || '')}</p>
                      <span className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 font-mono text-[10px] text-muted-foreground">
                        UID {user?.id?.slice(0, 8) || '••••••••'}
                        <button
                          type="button"
                          onClick={copyUID}
                          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label="Copy full user ID"
                        >
                          {uidCopied ? <Check className="h-3 w-3 text-buy" /> : <Copy className="h-3 w-3" />}
                        </button>
                      </span>
                    </div>
                  </div>
                </div>
                {balanceErrorMsg ? (
                  <div className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-muted px-3 py-2.5 text-xs text-foreground">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <span>{balanceErrorMsg}</span>
                  </div>
                ) : null}
              </div>

              {/* Quick actions */}
              <div className="p-4 sm:p-5 sm:pt-0">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Quick actions</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                  <Link
                    href="/wallet/deposit/crypto"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-center text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90"
                  >
                    <Wallet className="h-4 w-4 shrink-0" />
                    <span>Deposit</span>
                  </Link>
                  <Link
                    href="/wallet/withdraw/crypto"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-center text-sm font-semibold text-foreground transition hover:bg-muted"
                  >
                    <Send className="h-4 w-4 shrink-0" />
                    <span>Withdraw</span>
                  </Link>
                  <Link
                    href="/wallet/transfer"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-center text-sm font-semibold text-foreground transition hover:bg-muted"
                  >
                    <ArrowLeftRight className="h-4 w-4 shrink-0" />
                    <span>Transfer</span>
                  </Link>
                  <Link
                    href="/trade/spot"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-center text-sm font-semibold text-primary transition hover:bg-muted"
                  >
                    <BarChart3 className="h-4 w-4 shrink-0" />
                    <span>Trade</span>
                  </Link>
                </div>
              </div>
            </section>

            {/* Shortcuts */}
            <div className="rounded-xl border border-border bg-card px-3 py-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">More</span>
                <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              </div>
              <div className="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {OVERVIEW_SHORTCUTS.map((s) => {
                  const Icon = s.icon;
                  return (
                    <Link
                      key={s.href}
                      href={s.href}
                      className="group flex min-w-[118px] shrink-0 flex-col gap-0.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5 transition hover:border-primary/30 hover:bg-muted/50"
                    >
                      <span className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-card text-primary shadow-sm ring-1 ring-border">
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="text-sm font-semibold text-foreground">{s.label}</span>
                      </span>
                      <span className="pl-9 text-[10px] text-muted-foreground">{s.desc}</span>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Build progress — visual bar */}
            <Link
              href="/dashboard/progress"
              className="group relative block overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm transition hover:border-primary/30"
            >
              <div className="pointer-events-none absolute right-0 top-0 h-24 w-24 translate-x-6 -translate-y-6 rounded-full bg-primary/5 blur-2xl" />
              <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                    <ClipboardList className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-bold text-foreground">Platform build progress</h2>
                      {progressPct === 100 ? (
                        <span className="rounded-full bg-buy/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-buy">
                          Complete
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {progressDone} / {progressTotal} milestones · Roadmap visibility
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 sm:shrink-0">
                  <div className="min-w-0 flex-1 sm:w-40">
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <p className="mt-1 text-right text-[11px] font-semibold tabular-nums text-muted-foreground">{progressPct}%</p>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
                </div>
              </div>
            </Link>

            {kycVerified === false && (
              <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                <div className="flex items-center gap-3 border-b border-border px-4 py-4 sm:px-5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Target className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-foreground">Get started</h2>
                    <p className="text-xs text-muted-foreground">Unlock limits and full access</p>
                  </div>
                </div>

                <div className="p-5 sm:p-6">
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex flex-1 flex-col items-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-buy text-primary-foreground shadow-sm">
                        <CheckCircle2 className="h-6 w-6" />
                      </div>
                      <div className="mt-3 h-1 w-full max-w-[80px] rounded-full bg-buy" />
                      <p className="mt-3 text-xs font-semibold text-buy">Sign up</p>
                      <p className="text-[10px] text-muted-foreground">Done</p>
                    </div>
                    <div className="mb-8 h-px w-6 shrink-0 bg-border sm:w-10" />
                    <div className="flex flex-1 flex-col items-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                        <Shield className="h-6 w-6" />
                      </div>
                      <div className="mt-3 h-1 w-full max-w-[80px] overflow-hidden rounded-full bg-muted">
                        <div className="h-full w-1/2 rounded-full bg-primary" />
                      </div>
                      <p className="mt-3 text-xs font-semibold text-primary">Verify</p>
                      <p className="text-[10px] text-muted-foreground">In progress</p>
                    </div>
                    <div className="mb-8 h-px w-6 shrink-0 bg-border sm:w-10" />
                    <div className="flex flex-1 flex-col items-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                        <Wallet className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <div className="mt-3 h-1 w-full max-w-[80px] rounded-full bg-muted" />
                      <p className="mt-3 text-xs font-medium text-muted-foreground">Deposit</p>
                      <p className="text-[10px] text-muted-foreground">Locked</p>
                    </div>
                  </div>

                  <div className="mt-6 rounded-xl border border-border bg-muted/30 p-4">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <ul className="space-y-1.5 text-sm text-muted-foreground">
                        <li className="flex items-center gap-2">
                          <Clock className="h-4 w-4 shrink-0 text-primary" />
                          2–5 minutes with a valid ID
                        </li>
                        <li className="flex items-center gap-2">
                          <Shield className="h-4 w-4 shrink-0 text-primary" />
                          Encrypted storage — your data stays private
                        </li>
                      </ul>
                      <Link
                        href="/dashboard/identity"
                        className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
                      >
                        Get verified <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Market overview — top movers from live tickers */}
            <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <div className="flex flex-col gap-2 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <TrendingUp className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-foreground sm:text-lg">Market overview</h2>
                    <p className="text-xs text-muted-foreground">Top movers by 24h change (live tickers)</p>
                  </div>
                </div>
                <Link
                  href="/markets"
                  className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:opacity-90"
                >
                  All markets <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                </Link>
              </div>
              <div className="p-4 sm:p-5">
                {marketsLoading ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {[0, 1].map((k) => (
                      <div key={k} className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
                        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
                        {[1, 2, 3].map((i) => (
                          <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
                        ))}
                      </div>
                    ))}
                  </div>
                ) : showMarketsEmpty ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Market data unavailable. Open Spot or retry from the watchlist below.
                  </p>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-lg border border-border bg-muted/20">
                      <div className="border-b border-border px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Top gainers</p>
                      </div>
                      <ul className="divide-y divide-border">
                        {topMoverGainers.length === 0 ? (
                          <li className="px-3 py-4 text-center text-xs text-muted-foreground">No change data</li>
                        ) : (
                          topMoverGainers.map((item) => (
                            <li key={`g-${item.pair}-${item.quote}`}>
                              <Link
                                href={`/trade/spot?symbol=${item.pair}_${item.quote}`}
                                className="flex items-center justify-between gap-2 px-3 py-2.5 transition hover:bg-muted/50"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <CoinIcon symbol={item.pair} size={24} />
                                  <span className="font-semibold text-foreground">
                                    {item.pair}
                                    <span className="font-normal text-muted-foreground">/{item.quote}</span>
                                  </span>
                                </div>
                                <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-buy">
                                  {item.change != null && item.change > 0 ? '+' : ''}
                                  {item.change?.toFixed(2)}%
                                </span>
                              </Link>
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/20">
                      <div className="border-b border-border px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Top losers</p>
                      </div>
                      <ul className="divide-y divide-border">
                        {topMoverLosers.length === 0 ? (
                          <li className="px-3 py-4 text-center text-xs text-muted-foreground">No change data</li>
                        ) : (
                          topMoverLosers.map((item) => (
                            <li key={`l-${item.pair}-${item.quote}`}>
                              <Link
                                href={`/trade/spot?symbol=${item.pair}_${item.quote}`}
                                className="flex items-center justify-between gap-2 px-3 py-2.5 transition hover:bg-muted/50"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <CoinIcon symbol={item.pair} size={24} />
                                  <span className="font-semibold text-foreground">
                                    {item.pair}
                                    <span className="font-normal text-muted-foreground">/{item.quote}</span>
                                  </span>
                                </div>
                                <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-sell">
                                  {item.change?.toFixed(2)}%
                                </span>
                              </Link>
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* Markets — watchlist & full ticker table */}
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <BarChart3 className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-bold text-foreground sm:text-lg">Watchlist &amp; pairs</h2>
                      <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Spot
                      </span>
                      <span className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-buy opacity-40" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-buy" />
                        </span>
                        Live
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">Favorites, movers, or full list — jump to Spot anytime</p>
                  </div>
                </div>
                <Link href="/markets" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:opacity-90">
                  Markets <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                </Link>
              </div>

              <div className="flex items-center gap-2 overflow-x-auto border-b border-border px-4 py-2.5 dark:border-border sm:px-5">
                {marketTabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveMarketTab(tab.id)}
                      className={`flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-semibold transition-all sm:min-h-0 sm:py-2 sm:text-sm ${
                        activeMarketTab === tab.id
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <div className="overflow-x-auto">
                {marketsLoading ? (
                  <table className="w-full min-w-[640px]">
                    <thead>
                      <tr className="bg-muted/40">
                        <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Pair
                        </th>
                        <th className="px-5 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Last price
                        </th>
                        <th className="px-5 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          24h change
                        </th>
                        <th className="w-28 px-5 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/80">
                      {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                        <tr key={i}>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className="h-9 w-9 animate-pulse rounded-lg bg-accent" />
                              <div className="space-y-1.5">
                                <div className="h-3.5 w-24 animate-pulse rounded bg-accent" />
                                <div className="h-2.5 w-14 animate-pulse rounded bg-accent" />
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <div className="ml-auto h-4 w-20 animate-pulse rounded bg-accent" />
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <div className="ml-auto flex justify-end gap-2">
                              <div className="h-6 w-12 animate-pulse rounded bg-accent" />
                              <div className="h-7 w-16 animate-pulse rounded bg-accent" />
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <div className="ml-auto h-8 w-[72px] animate-pulse rounded-lg bg-accent" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : activeMarketTab === 'favorites' && displayedMarketData.length === 0 ? (
                  <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                    <Star className="mb-3 h-12 w-12 text-muted-foreground/40" />
                    <p className="text-base font-semibold text-foreground">No favorites yet</p>
                    <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                      Star pairs in the table below once markets load, or browse Spot to add them.
                    </p>
                    <Link href="/trade/spot" className="mt-4 text-sm font-semibold text-primary hover:underline">
                      Open Spot
                    </Link>
                  </div>
                ) : showMarketsEmpty ? (
                  <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                    <LineChart className="mb-3 h-12 w-12 text-muted-foreground/50" />
                    <p className="text-base font-semibold text-foreground">
                      {marketsLoadFailed ? "Couldn't load markets" : 'No tickers right now'}
                    </p>
                    <p className="mt-1 max-w-md text-sm text-muted-foreground">
                      {marketsLoadFailed
                        ? 'Check your connection or try again. Spot trading may still be available from the terminal.'
                        : 'The market service returned no pairs. Try again later or open Spot directly.'}
                    </p>
                    <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const url = getApiBaseUrl();
                          if (!url) return;
                          setMarketsLoading(true);
                          setMarketsLoadFailed(false);
                          fetch(`${url}/api/v1/spot/tickers`)
                            .then((r) => r.json())
                            .then((data) => {
                              if (data?.success && Array.isArray(data?.data)) {
                                const rows: TickerRow[] = data.data.slice(0, 12).map((t: { base_asset: string; quote_asset: string; last_price: string | null; change_pct?: number }) => {
                                  const price = parseFloat(t.last_price || '0') || 0;
                                  const change = parseTickerChangePct(t.change_pct);
                                  return { pair: t.base_asset, quote: t.quote_asset, price, change };
                                });
                                setMarketData(rows);
                              }
                            })
                            .catch(() => setMarketsLoadFailed(true))
                            .finally(() => setMarketsLoading(false));
                        }}
                        className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm hover:bg-muted"
                      >
                        Retry
                      </button>
                      <Link
                        href="/trade/spot"
                        className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-md hover:bg-primary/90"
                      >
                        Go to Spot
                      </Link>
                    </div>
                  </div>
                ) : (
                    <table className="w-full min-w-[640px]">
                      <thead>
                        <tr className="bg-muted/40">
                          <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              Pair
                              <InfoTooltip content={TOOLTIP_PAIR} className="text-muted-foreground" />
                            </span>
                          </th>
                          <th className="px-5 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            <span className="inline-flex items-center justify-end gap-1">
                              Last price
                              <InfoTooltip content={TOOLTIP_LAST_PRICE} className="text-muted-foreground" />
                            </span>
                          </th>
                          <th className="px-5 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            <span className="inline-flex items-center justify-end gap-1">
                              24h change
                              <InfoTooltip content={TOOLTIP_24H_CHANGE} className="text-muted-foreground" />
                            </span>
                          </th>
                          <th className="w-28 px-5 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/80">
                        {displayedMarketData.map((item, idx) => {
                          const rowKey = `${item.pair}_${item.quote}`;
                          const flash = dashPriceFlash[rowKey];
                          const rowFlash =
                            flash === 'up' ? 'bg-buy/10' : flash === 'down' ? 'bg-sell/10' : '';
                          const chgUp = item.change != null && item.change > 0;
                          const chgDown = item.change != null && item.change < 0;
                          const chgNull = item.change == null;
                          const chgBadge = chgNull
                            ? 'bg-muted text-muted-foreground'
                            : chgUp
                              ? 'bg-buy/15 text-buy'
                              : chgDown
                                ? 'bg-sell/15 text-sell'
                                : 'bg-muted text-muted-foreground';
                          const priceCls =
                            flash === 'up' ? 'text-buy' : flash === 'down' ? 'text-sell' : 'text-foreground';
                          return (
                            <tr
                              key={`${item.pair}-${item.quote}`}
                              className={`transition-[background-color,color] duration-300 ease-out hover:bg-muted/50 ${idx % 2 === 1 ? 'bg-muted/25' : ''} ${rowFlash}`}
                            >
                              <td className="px-5 py-3">
                                <div className="flex items-center gap-3">
                                  <button
                                    type="button"
                                    onClick={() => toggleFavorite(item.pair)}
                                    className="min-h-11 min-w-11 rounded-md p-2 text-muted-foreground transition hover:bg-muted hover:text-primary sm:min-h-0 sm:min-w-0 sm:p-0.5"
                                    aria-label={favorites.includes(item.pair) ? 'Remove from favorites' : 'Add to favorites'}
                                  >
                                    <Star
                                      className={`h-5 w-5 ${favorites.includes(item.pair) ? 'fill-primary/25 text-primary' : ''}`}
                                    />
                                  </button>
                                  <CoinIcon symbol={item.pair} size={36} />
                                  <div>
                                    <span className="font-semibold text-foreground">{item.pair}</span>
                                    <span className="text-sm text-muted-foreground">/{item.quote}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="px-5 py-3 text-right">
                                <span
                                  className={`font-mono text-sm font-semibold tabular-nums transition-colors duration-300 ${priceCls}`}
                                >
                                  $
                                  {item.price >= 1
                                    ? item.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                    : item.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                                </span>
                              </td>
                              <td className="px-5 py-3">
                                <div className="flex items-center justify-end gap-2">
                                  <MiniSparkline change={item.change} />
                                  <span
                                    className={`inline-flex min-w-[4.5rem] items-center justify-end gap-1 rounded-lg px-2 py-1 text-xs font-bold tabular-nums transition-colors duration-200 ${chgBadge}`}
                                  >
                                    {item.change == null ? (
                                      '—'
                                    ) : (
                                      <>
                                        {chgUp ? <TrendingUp className="h-3.5 w-3.5" /> : chgDown ? <TrendingDown className="h-3.5 w-3.5" /> : null}
                                        {chgUp ? '+' : ''}
                                        {item.change.toFixed(2)}%
                                      </>
                                    )}
                                  </span>
                                </div>
                              </td>
                              <td className="px-5 py-3 text-right">
                                <Link
                                  href={`/trade/spot?symbol=${item.pair}_${item.quote}`}
                                  className="inline-flex min-h-11 min-w-[5.5rem] items-center justify-center rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 sm:min-h-0 sm:min-w-0 sm:px-3 sm:py-1.5"
                                >
                                  Trade
                                </Link>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                )}
              </div>
            </div>

            {/* Recent activity — links + P2P snapshot from existing rail data (no extra API) */}
            <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <div className="flex flex-col gap-1 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <History className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-foreground sm:text-lg">Recent activity</h2>
                    <p className="text-xs text-muted-foreground">Orders and funding movements</p>
                  </div>
                </div>
              </div>
              <div className="space-y-4 p-4 sm:p-5">
                {accessToken && p2pPreview != null ? (
                  <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">P2P snapshot</p>
                    <p className="mt-1 text-sm text-foreground">
                      <span className="font-semibold tabular-nums text-primary">{p2pPreview.active}</span>
                      <span className="text-muted-foreground"> active · </span>
                      <span className="font-semibold tabular-nums">{p2pPreview.total}</span>
                      <span className="text-muted-foreground"> total orders</span>
                    </p>
                    <Link
                      href="/p2p"
                      className="mt-2 inline-flex items-center gap-0.5 text-xs font-semibold text-primary hover:opacity-90"
                    >
                      Open P2P hub <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-3">
                  <Link
                    href="/dashboard/orders"
                    className="flex min-h-14 items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-3 transition hover:bg-muted/40"
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <ClipboardList className="h-4 w-4 shrink-0 text-primary" />
                      Orders hub
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                  <Link
                    href="/dashboard/orders/spot"
                    className="flex min-h-14 items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-3 transition hover:bg-muted/40"
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <BarChart3 className="h-4 w-4 shrink-0 text-primary" />
                      Spot orders
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                  <Link
                    href="/dashboard/assets/history"
                    className="flex min-h-14 items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-3 transition hover:bg-muted/40"
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Receipt className="h-4 w-4 shrink-0 text-primary" />
                      Funding history
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                </div>
                {!accessToken ? (
                  <p className="text-center text-xs text-muted-foreground">Sign in to see P2P order counts on the dashboard.</p>
                ) : null}
              </div>
            </section>

            {/* Announcements */}
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <div className="flex items-center justify-between border-b border-border px-4 py-4 sm:px-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <Bell className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-foreground">Announcements</h2>
                    <p className="text-xs text-muted-foreground">Product &amp; maintenance updates</p>
                  </div>
                </div>
                <Link
                  href="/dashboard/announcements"
                  className="text-sm font-semibold text-primary hover:underline"
                >
                  View all
                </Link>
              </div>

              <div className="divide-y divide-border/80">
                {announcementsLoading ? (
                  <div className="flex items-center justify-center gap-2 px-5 py-10">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
                    <span className="text-sm text-muted-foreground">Loading…</span>
                  </div>
                ) : announcementsError ? (
                  <div className="px-4 py-4 sm:px-5">
                    <div className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-foreground">
                      {announcementsError}
                    </div>
                    <p className="mb-2 mt-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Quick tips
                    </p>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {DASHBOARD_TIPS_WHEN_NO_NEWS.map((tip) => (
                        <div
                          key={`err-${tip.t}`}
                          className="rounded-lg border border-border bg-muted/30 px-3 py-2.5"
                        >
                          <p className="text-[11px] font-bold text-foreground">{tip.t}</p>
                          <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{tip.d}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : announcements.length === 0 ? (
                  <div className="px-4 py-6 sm:px-6">
                    <div className="mb-5 text-center">
                      <Bell className="mx-auto mb-2 h-10 w-10 text-muted-foreground/50" />
                      <p className="text-sm font-semibold text-foreground">No pinned announcements</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Listing updates, maintenance windows, and campaigns appear here when published.
                      </p>
                    </div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      While you wait — quick tips
                    </p>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {DASHBOARD_TIPS_WHEN_NO_NEWS.map((tip) => (
                        <div
                          key={tip.t}
                          className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-left"
                        >
                          <p className="text-[11px] font-bold text-foreground">{tip.t}</p>
                          <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{tip.d}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  announcements.map((announcement) => {
                    const isNew =
                      announcement.is_pinned ||
                      (announcement.published_at &&
                        Date.now() - new Date(announcement.published_at).getTime() < 7 * 24 * 60 * 60 * 1000);
                    const dateLabel = announcement.published_at
                      ? new Date(announcement.published_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                      : null;
                    return (
                      <Link
                        key={announcement.id}
                        href={`/dashboard/announcements/${announcement.id}`}
                        className="group/ann flex items-center justify-between gap-4 px-4 py-4 transition hover:bg-muted/50 sm:px-5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {isNew ? (
                              <span className="shrink-0 rounded bg-destructive px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-destructive-foreground">
                                New
                              </span>
                            ) : null}
                            <p className="truncate text-sm font-semibold text-foreground group-hover/ann:text-primary">
                              {announcement.title}
                            </p>
                          </div>
                          {dateLabel ? (
                            <p className="mt-0.5 text-[11px] text-muted-foreground">{dateLabel}</p>
                          ) : null}
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover/ann:translate-x-0.5 group-hover/ann:text-primary" />
                      </Link>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Right rail */}
          <div className="grid shrink-0 grid-cols-2 gap-3 xl:w-80 xl:grid-cols-1 xl:gap-4">
            {!deferHeavyPanels ? (
              <>
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={`rail-skeleton-${i}`}
                    className="min-h-[268px] rounded-xl border border-border bg-card p-4 shadow-sm sm:min-h-[280px] sm:p-5"
                  >
                    <div className="h-10 w-10 animate-pulse rounded-xl bg-muted" />
                    <div className="mt-3 space-y-2">
                      <div className="h-4 w-28 animate-pulse rounded bg-muted" />
                      <div className="h-3 w-40 animate-pulse rounded bg-muted" />
                    </div>
                    <div className="mt-4 h-[148px] animate-pulse rounded-xl border border-border bg-muted/40" />
                    <div className="mt-3 h-3 w-24 animate-pulse rounded bg-muted" />
                  </div>
                ))}
              </>
            ) : (
              <>
            <Link
              href="/dashboard/help"
              className="group relative flex min-h-[268px] flex-col overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm transition hover:border-primary/30 sm:min-h-[280px] sm:p-5"
            >
              <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-primary/5 blur-2xl" />
              <div className="relative flex shrink-0 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <HelpCircle className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1 pr-1">
                  <h3 className="text-sm font-bold text-foreground">Help Center</h3>
                  <p className="text-[11px] leading-snug text-muted-foreground">Self-service guides</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
              </div>
              <div className="relative mt-3 flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-muted/25 p-3">
                <p className="shrink-0 text-xs font-bold leading-snug text-foreground">
                  {HELP_CENTER_TOPIC_COUNT} step-by-step guides
                </p>
                <p className="mt-1 shrink-0 text-[11px] leading-relaxed text-muted-foreground">{HELP_PREVIEW_SNIPPETS}</p>
                <ul className="mt-3 flex flex-1 flex-col justify-center gap-2.5 border-t border-border py-3">
                  {HELP_TOPIC_PREVIEW_LINES.map((line) => (
                    <li key={line} className="flex gap-2.5 text-[12px] leading-snug text-muted-foreground">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto flex shrink-0 items-center justify-between border-t border-border pt-2.5">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">More inside</span>
                  <span className="text-xs font-bold text-primary">Open →</span>
                </div>
              </div>
            </Link>

            <Link
              href="/dashboard/referral"
              className="group relative flex min-h-[268px] flex-col overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm transition hover:border-primary/30 sm:min-h-[280px] sm:p-5"
            >
              <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-buy/10 blur-2xl" />
              <div className="relative flex shrink-0 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-buy/15">
                  <Gift className="h-5 w-5 text-buy" />
                </div>
                <div className="min-w-0 flex-1 pr-1">
                  <h3 className="text-sm font-bold text-foreground">Referrals</h3>
                  <p className="text-[11px] leading-snug text-muted-foreground">Invite &amp; earn</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-buy" />
              </div>
              {railPreviewsLoading ? (
                <RailCardPreviewSkeleton />
              ) : (
                <div className="relative mt-3 flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-muted/25 p-3">
                  <div className="shrink-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Your code</p>
                    <p className="mt-1 break-all font-mono text-lg font-bold leading-tight tracking-tight text-buy">
                      {referralRailDisplay.code}
                    </p>
                  </div>
                  <div className="mt-3 grid flex-1 grid-cols-2 gap-2">
                    <div className="flex flex-col justify-center rounded-lg border border-border bg-card/80 px-2.5 py-2.5 text-center">
                      <span className="text-2xl font-bold tabular-nums leading-none text-foreground">
                        {referralRailDisplay.referrals}
                      </span>
                      <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Invited
                      </span>
                    </div>
                    <div className="flex flex-col justify-center rounded-lg border border-border bg-card/80 px-2.5 py-2.5 text-center">
                      <span className="text-lg font-bold tabular-nums leading-none text-foreground">
                        {formatFromUsdt(referralRailDisplay.earnings, 2)}
                      </span>
                      <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Earned
                      </span>
                    </div>
                  </div>
                  <p className="mt-3 shrink-0 text-center text-[11px] font-medium text-muted-foreground">
                    {referralRailDisplay.commissionPct.toFixed(0)}% commission · Link &amp; banners on full page
                  </p>
                  <div className="mt-auto flex shrink-0 items-center justify-between border-t border-border pt-2.5">
                    {referralFromApi ? (
                      <span className="text-[10px] font-semibold text-buy">● Live</span>
                    ) : (
                      <span className="text-[10px] font-medium text-muted-foreground">○ Sync pending</span>
                    )}
                    <span className="text-xs font-bold text-buy">Open →</span>
                  </div>
                </div>
              )}
            </Link>

            <Link
              href="/p2p"
              className="group relative flex min-h-[268px] flex-col overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm transition hover:border-primary/30 sm:min-h-[280px] sm:p-5"
            >
              <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-primary/5 blur-2xl" />
              <div className="relative flex shrink-0 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1 pr-1">
                  <h3 className="text-sm font-bold text-foreground">P2P</h3>
                  <p className="text-[11px] leading-snug text-muted-foreground">Buy / sell fiat</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
              </div>
              {railPreviewsLoading ? (
                <RailCardPreviewSkeleton />
              ) : (
                <div className="relative mt-3 flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-muted/25 p-3">
                  <div className="grid flex-1 grid-cols-2 gap-2">
                    <div className="flex flex-col justify-center rounded-lg border border-border bg-card/80 px-2 py-3 text-center">
                      <span className="text-2xl font-bold tabular-nums leading-none text-primary">
                        {p2pRailDisplay.active}
                      </span>
                      <span className="mt-1.5 text-[10px] font-bold uppercase leading-tight tracking-wide text-muted-foreground">
                        In progress
                      </span>
                    </div>
                    <div className="flex flex-col justify-center rounded-lg border border-border bg-card/80 px-2 py-3 text-center">
                      <span className="text-2xl font-bold tabular-nums leading-none text-foreground">
                        {p2pRailDisplay.total}
                      </span>
                      <span className="mt-1.5 text-[10px] font-bold uppercase leading-tight tracking-wide text-muted-foreground">
                        All orders
                      </span>
                    </div>
                  </div>
                  <p className="mt-3 text-[12px] font-medium leading-relaxed text-foreground">
                    USDT, BTC, ETH vs INR — bank, UPI &amp; listed methods only.
                  </p>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    Escrow-protected trades · Manage payment methods &amp; order history from the hub.
                  </p>
                  <div className="mt-auto flex shrink-0 items-center justify-between border-t border-border pt-2.5">
                    <span className="text-[10px] text-muted-foreground">Orders → P2P</span>
                    <span className="text-xs font-bold text-primary">Trade →</span>
                  </div>
                </div>
              )}
            </Link>

            <Link
              href="/dashboard/fee-rates"
              className="group relative flex min-h-[268px] flex-col overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm transition hover:border-primary/30 sm:min-h-[280px] sm:p-5"
            >
              <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-primary/5 blur-2xl" />
              <div className="relative flex shrink-0 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                  <Receipt className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1 pr-1">
                  <h3 className="text-sm font-bold text-foreground">Fee tier</h3>
                  <p className="text-[11px] leading-snug text-muted-foreground">Spot rates</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
              </div>
              {railPreviewsLoading ? (
                <RailCardPreviewSkeleton />
              ) : (
                <div className="relative mt-3 flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-muted/25 p-3">
                  <div className="flex shrink-0 items-center justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status</p>
                      <p className="text-sm font-bold text-foreground">
                        VIP {feeRailDisplay.vipLevel}
                        <span className="font-semibold text-muted-foreground"> · {feeRailDisplay.vipName}</span>
                      </p>
                    </div>
                    {!feePreview ? (
                      <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-[9px] font-bold uppercase text-muted-foreground">
                        Default
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-md bg-buy/15 px-2 py-1 text-[9px] font-bold uppercase text-buy">
                        Live
                      </span>
                    )}
                  </div>
                  <div className="mt-3 grid flex-1 grid-cols-2 gap-2">
                    <div className="flex flex-col justify-center rounded-lg border border-border bg-card/90 px-2 py-3 text-center">
                      <span className="text-[10px] font-bold uppercase text-muted-foreground">Maker</span>
                      <span className="mt-1 text-xl font-bold tabular-nums text-primary">{feeRailDisplay.maker}%</span>
                    </div>
                    <div className="flex flex-col justify-center rounded-lg border border-border bg-card/90 px-2 py-3 text-center">
                      <span className="text-[10px] font-bold uppercase text-muted-foreground">Taker</span>
                      <span className="mt-1 text-xl font-bold tabular-nums text-primary">{feeRailDisplay.taker}%</span>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-1 flex-col justify-center gap-1.5 text-[11px] leading-snug text-muted-foreground">
                    {feeRailDisplay.volumeTierLabel ? (
                      <p>
                        <span className="font-semibold text-foreground">Volume tier:</span> {feeRailDisplay.volumeTierLabel}
                      </p>
                    ) : (
                      <p>Trade more in 30d to unlock lower maker &amp; taker fees.</p>
                    )}
                    {feeRailDisplay.mnt ? (
                      <p className="font-medium text-buy">MNT discount is on for spot.</p>
                    ) : (
                      <p>Fiat pairs may use a separate schedule — see full table inside.</p>
                    )}
                  </div>
                  <div className="mt-auto flex shrink-0 items-center justify-between border-t border-border pt-2.5">
                    <span className="text-[10px] text-muted-foreground">VIP &amp; volume</span>
                    <span className="text-xs font-bold text-primary">Details →</span>
                  </div>
                </div>
              )}
            </Link>
              </>
            )}
          </div>
        </div>
      </DashboardPageShell>

      <Link
        href="/dashboard/help"
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg ring-2 ring-border transition hover:scale-105 hover:bg-primary/90 sm:bottom-8 sm:right-8"
        aria-label="Help"
      >
        <HelpCircle className="h-6 w-6" />
      </Link>
    </div>
  );
}
