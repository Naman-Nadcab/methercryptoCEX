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
} from 'lucide-react';
import { useBalancesSummary } from '@/lib/balances';
import { EXCHANGE_PROGRESS_STEPS } from '@/data/exchangeProgressSteps';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { TOOLTIP_PAIR, TOOLTIP_LAST_PRICE, TOOLTIP_24H_CHANGE } from '@/lib/marketDataUxCopy';
import { MiniSparkline } from '@/components/dashboard/MiniSparkline';
import { DashboardPageShell } from '@/components/dashboard/DashboardPageShell';

const PAIR_ICONS: Record<string, { icon: string; color: string }> = {
  BTC: { icon: '₿', color: '#F7931A' },
  ETH: { icon: 'Ξ', color: '#627EEA' },
  USDC: { icon: '$', color: '#2775CA' },
  USDT: { icon: '$', color: '#26A17B' },
  SOL: { icon: '◎', color: '#9945FF' },
  XAUT: { icon: '🪙', color: '#D4AF37' },
  XRP: { icon: '✕', color: '#23292F' },
};

interface AnnouncementItem {
  id: string;
  title: string;
  summary: string | null;
  type: string;
  is_pinned: boolean;
  published_at: string | null;
  created_at: string;
}

type TickerRow = { pair: string; quote: string; price: number; change: number | null; icon: string; color: string };

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
    <div className="mt-3 flex min-h-[148px] flex-1 flex-col rounded-xl border border-gray-100 bg-gray-50/80 p-3 dark:border-gray-800 dark:bg-gray-800/40">
      <div className="flex flex-1 flex-col justify-center gap-3">
        <div className="h-4 w-[90%] animate-pulse rounded-md bg-gray-200 dark:bg-gray-700" />
        <div className="grid grid-cols-2 gap-2">
          <div className="h-14 animate-pulse rounded-lg bg-gray-200/80 dark:bg-gray-700/80" />
          <div className="h-14 animate-pulse rounded-lg bg-gray-200/80 dark:bg-gray-700/80" />
        </div>
        <div className="h-3 w-2/3 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, accessToken, _hasHydrated } = useAuthStore();
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

  const progressDone = EXCHANGE_PROGRESS_STEPS.filter((s) => s.status === 'done').length;
  const progressTotal = EXCHANGE_PROGRESS_STEPS.length;
  const progressPct = progressTotal > 0 ? Math.round((progressDone / progressTotal) * 100) : 0;

  useEffect(() => {
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
  }, [accessToken]);

  useEffect(() => {
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
        const info = PAIR_ICONS[base] ?? { icon: base.slice(0, 1), color: '#6B7280' };
        const lp = (t.last_price ?? t.lastPrice) as string | null | undefined;
        const price = parseFloat(String(lp || '0')) || 0;
        const change = parseTickerChangePct(t.change_pct ?? t.changePct);
        rows.push({ pair: base, quote, price, change, icon: info.icon, color: info.color });
      }
      setMarketData(rows);
      setMarketsLoadFailed(!ok || rows.length === 0);
      setMarketsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    fetch(`${getApiBaseUrl()}/api/v1/wallet/kyc-status`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((res) => res.json())
      .then((data) => {
        if (data?.success) setKycVerified(!!data.data?.verified);
      })
      .catch(() => setKycVerified(false));
  }, [accessToken]);

  // Right-rail cards: lightweight previews (same APIs as destination pages)
  useEffect(() => {
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
  }, [_hasHydrated, accessToken, user?.id]);

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
    <div className="min-h-full bg-gray-50 dark:bg-[#0b0e11]">
      <DashboardPageShell
        title="Overview"
        description="Spot prices, P2P shortcuts, balances, and announcements — your daily trading hub."
        breadcrumbs={[{ label: 'Overview' }]}
      >
        <div className="flex flex-col xl:flex-row gap-6 lg:gap-8">
          <div className="flex-1 space-y-5 lg:space-y-6">
            {/* Hero — denser, account + balance split (API-backed) */}
            <div className="relative overflow-hidden rounded-2xl border border-gray-200/90 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04),0_12px_40px_-24px_rgba(15,23,42,0.18)] dark:border-gray-800 dark:bg-[#181a20] dark:shadow-[0_1px_0_rgba(255,255,255,0.04),0_12px_40px_-24px_rgba(0,0,0,0.5)]">
              <div
                className="pointer-events-none absolute inset-0 opacity-[0.65] dark:opacity-40"
                style={{
                  backgroundImage: `radial-gradient(900px 280px at 10% -20%, rgba(59, 130, 246, 0.09), transparent 55%),
                    radial-gradient(600px 200px at 90% 0%, rgba(16, 185, 129, 0.06), transparent 50%)`,
                }}
              />
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(105deg,transparent_40%,rgba(255,255,255,0.4)_50%,transparent_60%)] dark:bg-[linear-gradient(105deg,transparent_40%,rgba(255,255,255,0.03)_50%,transparent_60%)] opacity-30" />
              <div className="relative p-5 sm:p-6 lg:p-7">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex gap-4 min-w-0">
                    <div className="relative shrink-0">
                      <div className="absolute -inset-px rounded-2xl bg-gradient-to-br from-blue-400/50 to-blue-600/20 opacity-80 blur-[2px]" aria-hidden />
                      <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-100 to-white ring-1 ring-blue-200/80 dark:from-blue-950/80 dark:to-[#1e2430] dark:ring-blue-800/50">
                        <User className="h-7 w-7 text-blue-600 dark:text-blue-400" />
                      </div>
                    </div>
                    <div className="min-w-0 space-y-2">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">Account</p>
                        <h2 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-2xl">Welcome back</h2>
                        <p className="mt-0.5 truncate text-sm text-gray-600 dark:text-gray-400">{maskEmail(user?.email || '')}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 font-mono text-[11px] text-gray-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300">
                          UID {user?.id?.slice(0, 8) || '••••••••'}
                          <button
                            type="button"
                            onClick={copyUID}
                            className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-white"
                            aria-label="Copy full user ID"
                          >
                            {uidCopied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </span>
                        <span className="hidden text-[11px] text-gray-400 sm:inline dark:text-gray-500">Secured session</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex w-full flex-col gap-4 lg:max-w-xl xl:max-w-md">
                    <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
                      <div>
                        <p className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">
                          Total balance (est.)
                          <InfoTooltip content="Combined funding and trading account balance in USD." />
                        </p>
                        <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight text-gray-900 dark:text-white sm:text-4xl">
                          {Number.isFinite(totalUsd) ? formatUsd(totalUsd) : '—'}{' '}
                          <span className="text-lg font-semibold text-gray-500 dark:text-gray-400 sm:text-xl">USD</span>
                        </p>
                        {lastBalUpdate ? (
                          <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                            Balances updated {lastBalUpdate.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href="/wallet/deposit/crypto"
                          className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-500/25 transition hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/30"
                        >
                          <Wallet className="h-4 w-4" /> Deposit
                        </Link>
                        <Link
                          href="/wallet/withdraw/crypto"
                          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 shadow-sm transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                        >
                          <Send className="h-4 w-4" /> Withdraw
                        </Link>
                        <Link
                          href="/trade/spot"
                          className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 transition hover:bg-emerald-600"
                        >
                          <BarChart3 className="h-4 w-4" /> Trade
                        </Link>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-gray-100 bg-gray-50/90 p-3.5 ring-1 ring-gray-900/[0.03] dark:border-gray-700/80 dark:bg-gray-800/40 dark:ring-white/[0.04]">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Funding</p>
                        <p className="mt-1 text-lg font-bold tabular-nums text-gray-900 dark:text-white">${formatUsd(fundingUsd)}</p>
                        <p className="mt-0.5 text-[10px] leading-snug text-gray-500 dark:text-gray-500">Deposits &amp; P2P</p>
                      </div>
                      <div className="rounded-xl border border-gray-100 bg-gray-50/90 p-3.5 ring-1 ring-gray-900/[0.03] dark:border-gray-700/80 dark:bg-gray-800/40 dark:ring-white/[0.04]">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Trading</p>
                        <p className="mt-1 text-lg font-bold tabular-nums text-gray-900 dark:text-white">${formatUsd(tradingUsd)}</p>
                        <p className="mt-0.5 text-[10px] leading-snug text-gray-500 dark:text-gray-500">Spot &amp; open orders</p>
                      </div>
                    </div>

                    {balanceErrorMsg ? (
                      <div className="flex items-start gap-2 rounded-xl border border-amber-200/80 bg-amber-50/90 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        <span>{balanceErrorMsg}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            {/* Quick shortcuts — high density nav strip */}
            <div className="rounded-2xl border border-gray-200/80 bg-white/90 px-3 py-3 shadow-sm dark:border-gray-800 dark:bg-[#181a20]/95 dark:shadow-none">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">Shortcuts</span>
                <LayoutGrid className="h-3.5 w-3.5 text-gray-300 dark:text-gray-600" aria-hidden />
              </div>
              <div className="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {OVERVIEW_SHORTCUTS.map((s) => {
                  const Icon = s.icon;
                  return (
                    <Link
                      key={s.href}
                      href={s.href}
                      className="group flex min-w-[118px] shrink-0 flex-col gap-0.5 rounded-xl border border-gray-100 bg-gray-50/80 px-3 py-2.5 transition hover:border-blue-200 hover:bg-white hover:shadow-md dark:border-gray-700/80 dark:bg-gray-800/50 dark:hover:border-blue-800 dark:hover:bg-gray-800"
                    >
                      <span className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-blue-600 shadow-sm ring-1 ring-gray-200/80 dark:bg-gray-900 dark:text-blue-400 dark:ring-gray-700">
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">{s.label}</span>
                      </span>
                      <span className="pl-9 text-[10px] text-gray-500 dark:text-gray-400">{s.desc}</span>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Build progress — visual bar */}
            <Link
              href="/dashboard/progress"
              className="group relative block overflow-hidden rounded-2xl border border-gray-200/90 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow-md dark:border-gray-800 dark:bg-[#181a20] dark:hover:border-blue-800"
            >
              <div className="pointer-events-none absolute right-0 top-0 h-24 w-24 translate-x-6 -translate-y-6 rounded-full bg-blue-500/5 blur-2xl dark:bg-blue-400/10" />
              <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-950/80 dark:to-indigo-950/60">
                    <ClipboardList className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-bold text-gray-900 dark:text-white">Platform build progress</h2>
                      {progressPct === 100 ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                          Complete
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {progressDone} / {progressTotal} milestones · Roadmap visibility
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 sm:shrink-0">
                  <div className="min-w-0 flex-1 sm:w-40">
                    <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500 dark:from-blue-500 dark:to-blue-400"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <p className="mt-1 text-right text-[11px] font-semibold tabular-nums text-gray-500 dark:text-gray-400">{progressPct}%</p>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-blue-500" />
                </div>
              </div>
            </Link>

            {kycVerified === false && (
              <div className="overflow-hidden rounded-2xl border border-gray-200/90 bg-white shadow-sm dark:border-gray-800 dark:bg-[#181a20]">
                <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-900/40">
                    <Target className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">Get started</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Unlock limits and full access</p>
                  </div>
                </div>

                <div className="p-5 sm:p-6">
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex flex-1 flex-col items-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/25">
                        <CheckCircle2 className="h-6 w-6 text-white" />
                      </div>
                      <div className="mt-3 h-1 w-full max-w-[80px] rounded-full bg-emerald-500" />
                      <p className="mt-3 text-xs font-semibold text-emerald-600 dark:text-emerald-400">Sign up</p>
                      <p className="text-[10px] text-gray-400">Done</p>
                    </div>
                    <div className="mb-8 h-px w-6 shrink-0 bg-gray-200 dark:bg-gray-700 sm:w-10" />
                    <div className="flex flex-1 flex-col items-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500 shadow-lg shadow-blue-500/30">
                        <Shield className="h-6 w-6 text-white" />
                      </div>
                      <div className="mt-3 h-1 w-full max-w-[80px] overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                        <div className="h-full w-1/2 rounded-full bg-blue-500" />
                      </div>
                      <p className="mt-3 text-xs font-semibold text-blue-600 dark:text-blue-400">Verify</p>
                      <p className="text-[10px] text-gray-400">In progress</p>
                    </div>
                    <div className="mb-8 h-px w-6 shrink-0 bg-gray-200 dark:bg-gray-700 sm:w-10" />
                    <div className="flex flex-1 flex-col items-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700">
                        <Wallet className="h-6 w-6 text-gray-400" />
                      </div>
                      <div className="mt-3 h-1 w-full max-w-[80px] rounded-full bg-gray-200 dark:bg-gray-700" />
                      <p className="mt-3 text-xs font-medium text-gray-400">Deposit</p>
                      <p className="text-[10px] text-gray-400">Locked</p>
                    </div>
                  </div>

                  <div className="mt-6 rounded-xl border border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 p-4 dark:border-blue-900/40 dark:from-blue-950/40 dark:to-indigo-950/30">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <ul className="space-y-1.5 text-sm text-gray-600 dark:text-gray-400">
                        <li className="flex items-center gap-2">
                          <Clock className="h-4 w-4 shrink-0 text-blue-500" />
                          2–5 minutes with a valid ID
                        </li>
                        <li className="flex items-center gap-2">
                          <Shield className="h-4 w-4 shrink-0 text-blue-500" />
                          Encrypted storage — your data stays private
                        </li>
                      </ul>
                      <Link
                        href="/dashboard/identity"
                        className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-blue-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 hover:bg-blue-600"
                      >
                        Get verified <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Markets */}
            <div className="overflow-hidden rounded-2xl border border-gray-200/90 bg-white shadow-sm dark:border-gray-800 dark:bg-[#181a20] dark:shadow-none">
              <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-100 to-green-50 ring-1 ring-emerald-200/60 dark:from-emerald-950/60 dark:to-green-950/40 dark:ring-emerald-900/40">
                    <BarChart3 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-bold text-gray-900 dark:text-white">Markets</h2>
                      <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                        Spot
                      </span>
                      <span className="flex items-center gap-1.5 text-[10px] font-medium text-gray-400 dark:text-gray-500">
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                        </span>
                        Live tickers
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Top pairs by activity — open Spot for full depth</p>
                  </div>
                </div>
                <Link
                  href="/markets"
                  className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                >
                  All markets <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                </Link>
              </div>

              <div className="flex items-center gap-2 overflow-x-auto border-b border-gray-100 px-4 py-2.5 dark:border-gray-800 sm:px-5">
                {marketTabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveMarketTab(tab.id)}
                      className={`flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-semibold transition-all sm:min-h-0 sm:py-2 sm:text-sm ${
                        activeMarketTab === tab.id
                          ? 'bg-blue-500 text-white shadow-md shadow-blue-500/25'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
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
                      <tr className="bg-gray-50/95 dark:bg-[#1e2329]/90">
                        <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                          Pair
                        </th>
                        <th className="px-5 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                          Last price
                        </th>
                        <th className="px-5 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                          24h change
                        </th>
                        <th className="w-28 px-5 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800/80">
                      {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                        <tr key={i}>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className="h-9 w-9 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
                              <div className="space-y-1.5">
                                <div className="h-3.5 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                                <div className="h-2.5 w-14 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <div className="ml-auto h-4 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <div className="ml-auto flex justify-end gap-2">
                              <div className="h-6 w-12 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
                              <div className="h-7 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <div className="ml-auto h-8 w-[72px] animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : activeMarketTab === 'favorites' && displayedMarketData.length === 0 ? (
                  <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                    <Star className="mb-3 h-12 w-12 text-amber-300 dark:text-amber-700/50" />
                    <p className="text-base font-semibold text-gray-900 dark:text-white">No favorites yet</p>
                    <p className="mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400">
                      Star pairs in the table below once markets load, or browse Spot to add them.
                    </p>
                    <Link href="/trade/spot" className="mt-4 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline">
                      Open Spot
                    </Link>
                  </div>
                ) : showMarketsEmpty ? (
                  <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                    <LineChart className="mb-3 h-12 w-12 text-gray-300 dark:text-gray-600" />
                    <p className="text-base font-semibold text-gray-900 dark:text-white">
                      {marketsLoadFailed ? "Couldn't load markets" : 'No tickers right now'}
                    </p>
                    <p className="mt-1 max-w-md text-sm text-gray-500 dark:text-gray-400">
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
                                  const info = PAIR_ICONS[t.base_asset] ?? { icon: t.base_asset.slice(0, 1), color: '#6B7280' };
                                  const price = parseFloat(t.last_price || '0') || 0;
                                  const change = parseTickerChangePct(t.change_pct);
                                  return { pair: t.base_asset, quote: t.quote_asset, price, change, icon: info.icon, color: info.color };
                                });
                                setMarketData(rows);
                              }
                            })
                            .catch(() => setMarketsLoadFailed(true))
                            .finally(() => setMarketsLoading(false));
                        }}
                        className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                      >
                        Retry
                      </button>
                      <Link
                        href="/trade/spot"
                        className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-blue-600"
                      >
                        Go to Spot
                      </Link>
                    </div>
                  </div>
                ) : (
                    <table className="w-full min-w-[640px]">
                      <thead>
                        <tr className="bg-gray-50/95 dark:bg-[#1e2329]/90">
                          <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            <span className="inline-flex items-center gap-1">
                              Pair
                              <InfoTooltip content={TOOLTIP_PAIR} className="text-gray-400" />
                            </span>
                          </th>
                          <th className="px-5 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            <span className="inline-flex items-center justify-end gap-1">
                              Last price
                              <InfoTooltip content={TOOLTIP_LAST_PRICE} className="text-gray-400" />
                            </span>
                          </th>
                          <th className="px-5 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            <span className="inline-flex items-center justify-end gap-1">
                              24h change
                              <InfoTooltip content={TOOLTIP_24H_CHANGE} className="text-gray-400" />
                            </span>
                          </th>
                          <th className="w-28 px-5 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800/80">
                        {displayedMarketData.map((item, idx) => {
                          const rowKey = `${item.pair}_${item.quote}`;
                          const flash = dashPriceFlash[rowKey];
                          const rowFlash =
                            flash === 'up'
                              ? 'bg-emerald-500/10'
                              : flash === 'down'
                                ? 'bg-red-500/10'
                                : '';
                          const chgUp = item.change != null && item.change > 0;
                          const chgDown = item.change != null && item.change < 0;
                          const chgNull = item.change == null;
                          const chgBadge =
                            chgNull
                              ? 'bg-gray-100 text-gray-500 dark:bg-gray-800/80 dark:text-gray-500'
                              : chgUp
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/35 dark:text-emerald-400'
                                : chgDown
                                  ? 'bg-red-100 text-red-700 dark:bg-red-900/35 dark:text-red-400'
                                  : 'bg-gray-100 text-gray-600 dark:bg-gray-800/80 dark:text-gray-400';
                          const priceCls =
                            flash === 'up'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : flash === 'down'
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-gray-900 dark:text-white';
                          return (
                            <tr
                              key={`${item.pair}-${item.quote}`}
                              className={`transition-[background-color,color] duration-300 ease-out hover:bg-gray-50/90 dark:hover:bg-gray-800/40 ${idx % 2 === 1 ? 'bg-gray-50/40 dark:bg-gray-900/20' : ''} ${rowFlash}`}
                            >
                              <td className="px-5 py-3">
                                <div className="flex items-center gap-3">
                                  <button
                                    type="button"
                                    onClick={() => toggleFavorite(item.pair)}
                                    className="min-h-11 min-w-11 rounded-md p-2 text-gray-300 transition hover:bg-gray-100 hover:text-amber-400 dark:text-gray-600 dark:hover:bg-gray-800 sm:min-h-0 sm:min-w-0 sm:p-0.5"
                                    aria-label={favorites.includes(item.pair) ? 'Remove from favorites' : 'Add to favorites'}
                                  >
                                    <Star className={`h-5 w-5 ${favorites.includes(item.pair) ? 'fill-amber-400 text-amber-400' : ''}`} />
                                  </button>
                                  <div
                                    className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold text-white shadow-sm"
                                    style={{ backgroundColor: item.color }}
                                  >
                                    {item.icon}
                                  </div>
                                  <div>
                                    <span className="font-semibold text-gray-900 dark:text-white">{item.pair}</span>
                                    <span className="text-sm text-gray-400 dark:text-gray-500">/{item.quote}</span>
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
                                  className="inline-flex min-h-11 min-w-[5.5rem] items-center justify-center rounded-lg bg-blue-500 px-4 text-xs font-bold text-white shadow-sm transition-colors hover:bg-blue-600 sm:min-h-0 sm:min-w-0 sm:px-3 sm:py-1.5"
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

            {/* Announcements */}
            <div className="overflow-hidden rounded-2xl border border-gray-200/90 bg-white shadow-sm dark:border-gray-800 dark:bg-[#181a20]">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-amber-100 to-orange-50 ring-1 ring-amber-200/70 dark:from-amber-950/50 dark:to-orange-950/40 dark:ring-amber-900/40">
                    <Bell className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">Announcements</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Product &amp; maintenance updates</p>
                  </div>
                </div>
                <Link
                  href="/dashboard/announcements"
                  className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                >
                  View all
                </Link>
              </div>

              <div className="divide-y divide-gray-100 dark:divide-gray-800/80">
                {announcementsLoading ? (
                  <div className="flex items-center justify-center gap-2 px-5 py-10">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500/30 border-t-blue-500" />
                    <span className="text-sm text-gray-500 dark:text-gray-400">Loading…</span>
                  </div>
                ) : announcementsError ? (
                  <div className="px-5 py-4">
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                      {announcementsError}
                    </div>
                    <p className="mb-2 mt-4 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                      Quick tips
                    </p>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {DASHBOARD_TIPS_WHEN_NO_NEWS.map((tip) => (
                        <div
                          key={`err-${tip.t}`}
                          className="rounded-xl border border-gray-100 bg-gray-50/90 px-3 py-2.5 dark:border-gray-800 dark:bg-gray-800/40"
                        >
                          <p className="text-[11px] font-bold text-gray-900 dark:text-white">{tip.t}</p>
                          <p className="mt-0.5 text-[10px] leading-snug text-gray-600 dark:text-gray-400">{tip.d}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : announcements.length === 0 ? (
                  <div className="px-5 py-6 sm:px-6">
                    <div className="mb-5 text-center">
                      <Bell className="mx-auto mb-2 h-10 w-10 text-gray-300 dark:text-gray-600" />
                      <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">No pinned announcements</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Listing updates, maintenance windows, and campaigns appear here when published.
                      </p>
                    </div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                      While you wait — quick tips
                    </p>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {DASHBOARD_TIPS_WHEN_NO_NEWS.map((tip) => (
                        <div
                          key={tip.t}
                          className="rounded-xl border border-gray-100 bg-gray-50/90 px-3 py-2.5 text-left dark:border-gray-800 dark:bg-gray-800/40"
                        >
                          <p className="text-[11px] font-bold text-gray-900 dark:text-white">{tip.t}</p>
                          <p className="mt-0.5 text-[10px] leading-snug text-gray-600 dark:text-gray-400">{tip.d}</p>
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
                        className="group/ann flex items-center justify-between gap-4 px-5 py-4 transition hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {isNew ? (
                              <span className="shrink-0 rounded bg-red-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                                New
                              </span>
                            ) : null}
                            <p className="truncate text-sm font-semibold text-gray-800 group-hover/ann:text-blue-600 dark:text-gray-200 dark:group-hover/ann:text-blue-400">
                              {announcement.title}
                            </p>
                          </div>
                          {dateLabel ? (
                            <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">{dateLabel}</p>
                          ) : null}
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-gray-400 transition group-hover/ann:translate-x-0.5 group-hover/ann:text-blue-500" />
                      </Link>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Right rail — 2×2, fixed min-height + inner panel so cards feel filled */}
          <div className="grid shrink-0 grid-cols-2 gap-3 xl:w-80 xl:grid-cols-1 xl:gap-4">
            <Link
              href="/dashboard/help"
              className="group relative flex min-h-[268px] flex-col overflow-hidden rounded-2xl border border-gray-200/90 bg-white p-4 shadow-sm transition hover:border-indigo-300 hover:shadow-md sm:min-h-[280px] sm:p-5 dark:border-gray-800 dark:bg-[#181a20] dark:hover:border-indigo-800"
            >
              <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-indigo-500/10 blur-2xl" />
              <div className="relative flex shrink-0 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-100 to-violet-100 dark:from-indigo-950/60 dark:to-violet-950/50">
                  <HelpCircle className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div className="min-w-0 flex-1 pr-1">
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">Help Center</h3>
                  <p className="text-[11px] leading-snug text-gray-500 dark:text-gray-400">Self-service guides</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-400 group-hover:text-indigo-500" />
              </div>
              <div className="relative mt-3 flex min-h-0 flex-1 flex-col rounded-xl border border-indigo-100/80 bg-gradient-to-b from-indigo-50/90 to-white p-3 dark:border-indigo-900/30 dark:from-indigo-950/25 dark:to-[#1a1f28]">
                <p className="shrink-0 text-xs font-bold leading-snug text-gray-800 dark:text-gray-200">
                  {HELP_CENTER_TOPIC_COUNT} step-by-step guides
                </p>
                <p className="mt-1 shrink-0 text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">{HELP_PREVIEW_SNIPPETS}</p>
                <ul className="mt-3 flex flex-1 flex-col justify-center gap-2.5 border-t border-indigo-100/60 py-3 dark:border-indigo-900/25">
                  {HELP_TOPIC_PREVIEW_LINES.map((line) => (
                    <li key={line} className="flex gap-2.5 text-[12px] leading-snug text-gray-700 dark:text-gray-300">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" aria-hidden />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto flex shrink-0 items-center justify-between border-t border-indigo-100/60 pt-2.5 dark:border-indigo-900/25">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">More inside</span>
                  <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">Open →</span>
                </div>
              </div>
            </Link>

            <Link
              href="/dashboard/referral"
              className="group relative flex min-h-[268px] flex-col overflow-hidden rounded-2xl border border-gray-200/90 bg-white p-4 shadow-sm transition hover:border-emerald-300 hover:shadow-md sm:min-h-[280px] sm:p-5 dark:border-gray-800 dark:bg-[#181a20] dark:hover:border-emerald-800"
            >
              <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-emerald-500/10 blur-2xl" />
              <div className="relative flex shrink-0 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-100 to-green-100 dark:from-emerald-950/50 dark:to-green-950/40">
                  <Gift className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="min-w-0 flex-1 pr-1">
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">Referrals</h3>
                  <p className="text-[11px] leading-snug text-gray-500 dark:text-gray-400">Invite &amp; earn</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-400 group-hover:text-emerald-500" />
              </div>
              {railPreviewsLoading ? (
                <RailCardPreviewSkeleton />
              ) : (
                <div className="relative mt-3 flex min-h-0 flex-1 flex-col rounded-xl border border-emerald-100/80 bg-gradient-to-b from-emerald-50/90 to-white p-3 dark:border-emerald-900/30 dark:from-emerald-950/20 dark:to-[#1a1f28]">
                  <div className="shrink-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Your code</p>
                    <p className="mt-1 break-all font-mono text-lg font-bold leading-tight tracking-tight text-emerald-700 dark:text-emerald-400">
                      {referralRailDisplay.code}
                    </p>
                  </div>
                  <div className="mt-3 grid flex-1 grid-cols-2 gap-2">
                    <div className="flex flex-col justify-center rounded-lg border border-emerald-100/90 bg-white/80 px-2.5 py-2.5 text-center dark:border-emerald-900/35 dark:bg-gray-900/40">
                      <span className="text-2xl font-bold tabular-nums leading-none text-gray-900 dark:text-white">
                        {referralRailDisplay.referrals}
                      </span>
                      <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        Invited
                      </span>
                    </div>
                    <div className="flex flex-col justify-center rounded-lg border border-emerald-100/90 bg-white/80 px-2.5 py-2.5 text-center dark:border-emerald-900/35 dark:bg-gray-900/40">
                      <span className="text-lg font-bold tabular-nums leading-none text-gray-900 dark:text-white">
                        ${formatUsd(referralRailDisplay.earnings)}
                      </span>
                      <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        Earned
                      </span>
                    </div>
                  </div>
                  <p className="mt-3 shrink-0 text-center text-[11px] font-medium text-gray-600 dark:text-gray-400">
                    {referralRailDisplay.commissionPct.toFixed(0)}% commission · Link &amp; banners on full page
                  </p>
                  <div className="mt-auto flex shrink-0 items-center justify-between border-t border-emerald-100/60 pt-2.5 dark:border-emerald-900/25">
                    {referralFromApi ? (
                      <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">● Live</span>
                    ) : (
                      <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">○ Sync pending</span>
                    )}
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">Open →</span>
                  </div>
                </div>
              )}
            </Link>

            <Link
              href="/p2p"
              className="group relative flex min-h-[268px] flex-col overflow-hidden rounded-2xl border border-gray-200/90 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow-md sm:min-h-[280px] sm:p-5 dark:border-gray-800 dark:bg-[#181a20] dark:hover:border-blue-800"
            >
              <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-blue-500/10 blur-2xl" />
              <div className="relative flex shrink-0 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-100 to-cyan-100 dark:from-blue-950/50 dark:to-cyan-950/40">
                  <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="min-w-0 flex-1 pr-1">
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">P2P</h3>
                  <p className="text-[11px] leading-snug text-gray-500 dark:text-gray-400">Buy / sell fiat</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-400 group-hover:text-blue-500" />
              </div>
              {railPreviewsLoading ? (
                <RailCardPreviewSkeleton />
              ) : (
                <div className="relative mt-3 flex min-h-0 flex-1 flex-col rounded-xl border border-blue-100/80 bg-gradient-to-b from-blue-50/90 to-white p-3 dark:border-blue-900/30 dark:from-blue-950/20 dark:to-[#1a1f28]">
                  <div className="grid flex-1 grid-cols-2 gap-2">
                    <div className="flex flex-col justify-center rounded-lg border border-blue-100/90 bg-white/80 px-2 py-3 text-center dark:border-blue-900/35 dark:bg-gray-900/40">
                      <span className="text-2xl font-bold tabular-nums leading-none text-blue-700 dark:text-blue-400">
                        {p2pRailDisplay.active}
                      </span>
                      <span className="mt-1.5 text-[10px] font-bold uppercase leading-tight tracking-wide text-gray-500 dark:text-gray-400">
                        In progress
                      </span>
                    </div>
                    <div className="flex flex-col justify-center rounded-lg border border-blue-100/90 bg-white/80 px-2 py-3 text-center dark:border-blue-900/35 dark:bg-gray-900/40">
                      <span className="text-2xl font-bold tabular-nums leading-none text-gray-900 dark:text-white">
                        {p2pRailDisplay.total}
                      </span>
                      <span className="mt-1.5 text-[10px] font-bold uppercase leading-tight tracking-wide text-gray-500 dark:text-gray-400">
                        All orders
                      </span>
                    </div>
                  </div>
                  <p className="mt-3 text-[12px] font-medium leading-relaxed text-gray-700 dark:text-gray-300">
                    USDT, BTC, ETH vs INR — bank, UPI &amp; listed methods only.
                  </p>
                  <p className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
                    Escrow-protected trades · Manage payment methods &amp; order history from the hub.
                  </p>
                  <div className="mt-auto flex shrink-0 items-center justify-between border-t border-blue-100/60 pt-2.5 dark:border-blue-900/25">
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">Orders → P2P</span>
                    <span className="text-xs font-bold text-blue-600 dark:text-blue-400">Trade →</span>
                  </div>
                </div>
              )}
            </Link>

            <Link
              href="/dashboard/fee-rates"
              className="group relative flex min-h-[268px] flex-col overflow-hidden rounded-2xl border border-gray-200/90 bg-white p-4 shadow-sm transition hover:border-amber-300 hover:shadow-md sm:min-h-[280px] sm:p-5 dark:border-gray-800 dark:bg-[#181a20] dark:hover:border-amber-800"
            >
              <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-amber-500/10 blur-2xl" />
              <div className="relative flex shrink-0 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-100 to-yellow-50 dark:from-amber-950/50 dark:to-yellow-950/30">
                  <Receipt className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="min-w-0 flex-1 pr-1">
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">Fee tier</h3>
                  <p className="text-[11px] leading-snug text-gray-500 dark:text-gray-400">Spot rates</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-400 group-hover:text-amber-500" />
              </div>
              {railPreviewsLoading ? (
                <RailCardPreviewSkeleton />
              ) : (
                <div className="relative mt-3 flex min-h-0 flex-1 flex-col rounded-xl border border-amber-100/80 bg-gradient-to-b from-amber-50/90 to-white p-3 dark:border-amber-900/30 dark:from-amber-950/20 dark:to-[#1a1f28]">
                  <div className="flex shrink-0 items-center justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Status</p>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">
                        VIP {feeRailDisplay.vipLevel}
                        <span className="font-semibold text-gray-500 dark:text-gray-400"> · {feeRailDisplay.vipName}</span>
                      </p>
                    </div>
                    {!feePreview ? (
                      <span className="shrink-0 rounded-md bg-amber-100 px-2 py-1 text-[9px] font-bold uppercase text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                        Default
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-md bg-emerald-100 px-2 py-1 text-[9px] font-bold uppercase text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                        Live
                      </span>
                    )}
                  </div>
                  <div className="mt-3 grid flex-1 grid-cols-2 gap-2">
                    <div className="flex flex-col justify-center rounded-lg border border-amber-200/80 bg-white/90 px-2 py-3 text-center dark:border-amber-900/40 dark:bg-gray-900/45">
                      <span className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400">Maker</span>
                      <span className="mt-1 text-xl font-bold tabular-nums text-amber-700 dark:text-amber-400">
                        {feeRailDisplay.maker}%
                      </span>
                    </div>
                    <div className="flex flex-col justify-center rounded-lg border border-amber-200/80 bg-white/90 px-2 py-3 text-center dark:border-amber-900/40 dark:bg-gray-900/45">
                      <span className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400">Taker</span>
                      <span className="mt-1 text-xl font-bold tabular-nums text-amber-700 dark:text-amber-400">
                        {feeRailDisplay.taker}%
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-1 flex-col justify-center gap-1.5 text-[11px] leading-snug text-gray-600 dark:text-gray-400">
                    {feeRailDisplay.volumeTierLabel ? (
                      <p>
                        <span className="font-semibold text-gray-800 dark:text-gray-200">Volume tier:</span> {feeRailDisplay.volumeTierLabel}
                      </p>
                    ) : (
                      <p>Trade more in 30d to unlock lower maker &amp; taker fees.</p>
                    )}
                    {feeRailDisplay.mnt ? (
                      <p className="font-medium text-emerald-600 dark:text-emerald-400">MNT discount is on for spot.</p>
                    ) : (
                      <p>Fiat pairs may use a separate schedule — see full table inside.</p>
                    )}
                  </div>
                  <div className="mt-auto flex shrink-0 items-center justify-between border-t border-amber-100/60 pt-2.5 dark:border-amber-900/25">
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">VIP &amp; volume</span>
                    <span className="text-xs font-bold text-amber-700 dark:text-amber-400">Details →</span>
                  </div>
                </div>
              )}
            </Link>
          </div>
        </div>
      </DashboardPageShell>

      <Link
        href="/dashboard/help"
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500 shadow-xl shadow-blue-500/30 ring-2 ring-white/25 transition hover:scale-105 hover:bg-blue-600 hover:shadow-2xl dark:ring-gray-900/40 sm:bottom-8 sm:right-8"
        aria-label="Help"
      >
        <HelpCircle className="h-6 w-6 text-white" />
      </Link>
    </div>
  );
}
