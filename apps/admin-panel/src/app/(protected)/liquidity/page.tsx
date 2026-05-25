'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Bot,
  CheckCircle2,
  ChevronDown,
  Droplets,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Loader2,
  Power,
  Zap,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { adminFetch, AdminApiError, formatAdminError } from '@/lib/api';
import { getLiquidityAnalytics, getLiquidityHistory } from '@/lib/analytics-api';
import { getControlStatus } from '@/lib/control-api';
import { getTradingOrderbook, getTradingMarkets } from '@/lib/trading-api';
import { useAdminAuthStore } from '@/store/auth';
import { useAdminWs } from '@/hooks/useAdminWs';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { ActionAuthModal, type ActionAuthPayload as ModalActionAuthPayload } from '@/components/ops/ActionAuthModal';
import {
  createExternalLiquidityProvider,
  createHybridMarketRow,
  deleteHybridMarketRow,
  fetchExternalLiquidityFailoverHistory,
  fetchExternalLiquidityProviders,
  fetchHedgeRiskOverview,
  fetchHybridConfigs,
  manualFailoverProvider,
  patchExternalLiquidityProvider,
  patchHybridConfig,
  postHedgeEmergencyStop,
  postHedgeGlobalEnabled,
  resetProviderCircuit,
  testExternalLiquidityProvider,
  type HybridConfigRowAdmin,
} from '@/lib/hedge-risk-api';

const REFETCH_MS = 30_000;

type LiquidityBotConfig = {
  enabled: boolean;
  spreadBps: number;
  orderSize: number | string;
  symbols: string[];
  apiKeyConfigured: boolean;
  apiKeyPreview: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function spreadHealthColor(pct: number | null): { bg: string; text: string; label: string } {
  if (pct == null || pct < 0) return { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Inverted' };
  if (pct <= 0.3) return { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'Tight' };
  if (pct <= 1.0) return { bg: 'bg-blue-500/15', text: 'text-blue-400', label: 'Normal' };
  if (pct <= 5.0) return { bg: 'bg-amber-500/15', text: 'text-amber-400', label: 'Wide' };
  return { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Very Wide' };
}

function depthBadge(depth: string | null): { bg: string; text: string } {
  const d = (depth ?? '').toLowerCase();
  if (d === 'high') return { bg: 'bg-emerald-500/15', text: 'text-emerald-400' };
  if (d === 'medium') return { bg: 'bg-blue-500/15', text: 'text-blue-400' };
  return { bg: 'bg-amber-500/15', text: 'text-amber-400' };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
  loading,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon: React.ElementType;
  color: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl border border-admin-border bg-admin-card p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-admin-muted">{label}</span>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      {loading ? (
        <div className="h-7 w-20 animate-pulse rounded-md bg-white/[0.06]" />
      ) : (
        <div className="text-2xl font-bold text-admin-text tabular-nums leading-none">{value}</div>
      )}
      {sub && <p className="text-[11px] text-admin-muted">{sub}</p>}
    </div>
  );
}

function SpreadBar({ pct }: { pct: number | null }) {
  const health = spreadHealthColor(pct);
  const width = pct == null || pct < 0 ? 100 : Math.min(100, (pct / 10) * 100);
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            pct == null || pct < 0 ? 'bg-red-500' : pct <= 0.3 ? 'bg-emerald-500' : pct <= 1 ? 'bg-blue-500' : pct <= 5 ? 'bg-amber-500' : 'bg-red-500'
          }`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className={`text-xs font-medium ${health.text} min-w-[3.5rem] text-right`}>
        {pct == null ? '—' : pct < 0 ? `${pct.toFixed(2)}%` : `${pct.toFixed(3)}%`}
      </span>
    </div>
  );
}

// Custom dark chart tooltip
function DarkTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-admin-border bg-admin-card px-3 py-2 shadow-xl text-xs">
      <p className="font-semibold text-admin-text mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="text-admin-muted">
          {p.name}: <span className="text-indigo-400 font-mono">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

const HYBRID_BAND_POLICIES = ['internal_only', 'prefer_internal', 'prefer_hedge'] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ActionAuthPayload = { reason: string; twofa: string };

function RemoveHybridRowButton({
  rowId,
  market,
  token,
  queryClient,
  setHedgeUiError,
  onRemoved,
  requestActionAuth,
}: {
  rowId: string;
  market: string;
  token: string | null;
  queryClient: QueryClient;
  setHedgeUiError: (msg: string | null) => void;
  onRemoved: () => void;
  requestActionAuth: (actionLabel: string) => Promise<ActionAuthPayload>;
}) {
  const del = useMutation({
    mutationFn: async () => {
      setHedgeUiError(null);
      const action = `Remove hybrid override ${market}`;
      const auth = await requestActionAuth(action);
      return deleteHybridMarketRow(token, rowId, auth.reason, auth.twofa);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'hybrid'] });
      onRemoved();
    },
    onError: (e) => {
      setHedgeUiError(formatAdminError(e, 'Failed to remove hybrid row'));
    },
  });
  return (
    <button
      type="button"
      disabled={del.isPending || !token}
      onClick={() => {
        if (!window.confirm(`Remove hybrid override for ${market}? Global defaults will apply.`)) return;
        del.mutate();
      }}
      className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/16 disabled:opacity-40"
    >
      {del.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      Remove override
    </button>
  );
}

function HybridExecutionRowCard({
  row,
  token,
  queryClient,
  setHedgeUiError,
  onSaved,
  requestActionAuth,
}: {
  row: HybridConfigRowAdmin;
  token: string | null;
  queryClient: QueryClient;
  setHedgeUiError: (msg: string | null) => void;
  onSaved: () => void;
  requestActionAuth: (actionLabel: string) => Promise<ActionAuthPayload>;
}) {
  const [dirty, setDirty] = useState(false);
  const [enabled, setEnabled] = useState(row.enabled);
  const [hedgeEnabled, setHedgeEnabled] = useState(row.hedge_enabled);
  const [fallbackInternal, setFallbackInternal] = useState(row.fallback_to_internal);
  const [smallMax, setSmallMax] = useState(String(row.small_trade_max_notional_usd ?? ''));
  const [largeMin, setLargeMin] = useState(String(row.large_trade_min_notional_usd ?? ''));
  const [bandPolicy, setBandPolicy] = useState(row.between_band_policy ?? 'internal_only');
  const [slippageBps, setSlippageBps] = useState(String(row.max_slippage_bps ?? 0));
  const [maxOrder, setMaxOrder] = useState(String(row.max_hedge_notional_usd_per_order ?? ''));
  const [maxNet, setMaxNet] = useState(String(row.max_net_hedge_exposure_usd ?? ''));
  const [dailyLoss, setDailyLoss] = useState(String(row.hedge_max_daily_loss_usd ?? ''));
  const [counterparty, setCounterparty] = useState(row.system_counterparty_user_id ?? '');

  useEffect(() => {
    if (dirty) return;
    setEnabled(row.enabled);
    setHedgeEnabled(row.hedge_enabled);
    setFallbackInternal(row.fallback_to_internal);
    setSmallMax(String(row.small_trade_max_notional_usd ?? ''));
    setLargeMin(String(row.large_trade_min_notional_usd ?? ''));
    setBandPolicy(row.between_band_policy ?? 'internal_only');
    setSlippageBps(String(row.max_slippage_bps ?? 0));
    setMaxOrder(String(row.max_hedge_notional_usd_per_order ?? ''));
    setMaxNet(String(row.max_net_hedge_exposure_usd ?? ''));
    setDailyLoss(String(row.hedge_max_daily_loss_usd ?? ''));
    setCounterparty(row.system_counterparty_user_id ?? '');
  }, [dirty, row.id, row.updated_at]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      setHedgeUiError(null);
      const cp = counterparty.trim();
      if (cp && !UUID_RE.test(cp)) {
        throw new AdminApiError('System counterparty must be empty or a valid UUID', 'VALIDATION');
      }
      const bp = bandPolicy.trim();
      if (!HYBRID_BAND_POLICIES.includes(bp as (typeof HYBRID_BAND_POLICIES)[number])) {
        throw new AdminApiError('Invalid between-band policy', 'VALIDATION');
      }
      const action = `Update hybrid config ${row.market ?? 'global defaults'}`;
      const auth = await requestActionAuth(action);
      return patchHybridConfig(token, {
        id: row.id,
        enabled,
        hedge_enabled: hedgeEnabled,
        fallback_to_internal: fallbackInternal,
        small_trade_max_notional_usd: smallMax.trim(),
        large_trade_min_notional_usd: largeMin.trim(),
        between_band_policy: bp,
        max_slippage_bps: Math.max(0, parseInt(slippageBps, 10) || 0),
        max_hedge_notional_usd_per_order: maxOrder.trim(),
        max_net_hedge_exposure_usd: maxNet.trim(),
        hedge_max_daily_loss_usd: dailyLoss.trim(),
        system_counterparty_user_id: cp === '' ? null : cp,
      }, auth.reason, auth.twofa);
    },
    onSuccess: () => {
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'hybrid'] });
      onSaved();
    },
    onError: (e) => {
      setHedgeUiError(formatAdminError(e, 'Failed to save hybrid config'));
    },
  });

  const title = row.market == null ? 'Global defaults (all markets)' : `Override · ${row.market}`;
  const markDirty = () => setDirty(true);

  return (
    <div className="rounded-lg border border-admin-border bg-white/[0.02] p-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-admin-border pb-2">
        <div>
          <p className="text-xs font-semibold text-admin-text">{title}</p>
          <p className="text-[10px] text-admin-muted font-mono mt-0.5">id {row.id.slice(0, 8)}… · updated {row.updated_at}</p>
        </div>
        {dirty ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">Unsaved edits</span>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-[11px] text-admin-text cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              markDirty();
              setEnabled(e.target.checked);
            }}
            className="rounded border-admin-border"
          />
          Hybrid routing enabled
        </label>
        <label className="flex items-center gap-2 text-[11px] text-admin-text cursor-pointer">
          <input
            type="checkbox"
            checked={hedgeEnabled}
            onChange={(e) => {
              markDirty();
              setHedgeEnabled(e.target.checked);
            }}
            className="rounded border-admin-border"
          />
          Hedge allowed (row)
        </label>
        <label className="flex items-center gap-2 text-[11px] text-admin-text cursor-pointer">
          <input
            type="checkbox"
            checked={fallbackInternal}
            onChange={(e) => {
              markDirty();
              setFallbackInternal(e.target.checked);
            }}
            className="rounded border-admin-border"
          />
          Fallback to internal
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="space-y-1">
          <span className="text-[10px] text-admin-muted">Small trade max (USD notional)</span>
          <input
            value={smallMax}
            onChange={(e) => {
              markDirty();
              setSmallMax(e.target.value);
            }}
            className="w-full rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 font-mono text-xs text-admin-text"
            inputMode="decimal"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] text-admin-muted">Large trade min (USD notional)</span>
          <input
            value={largeMin}
            onChange={(e) => {
              markDirty();
              setLargeMin(e.target.value);
            }}
            className="w-full rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 font-mono text-xs text-admin-text"
            inputMode="decimal"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] text-admin-muted">Between-band policy</span>
          <select
            value={bandPolicy}
            onChange={(e) => {
              markDirty();
              setBandPolicy(e.target.value);
            }}
            className="w-full rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 text-xs text-admin-text"
          >
            {HYBRID_BAND_POLICIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[10px] text-admin-muted">Max slippage (IOC, bps)</span>
          <input
            value={slippageBps}
            onChange={(e) => {
              markDirty();
              setSlippageBps(e.target.value);
            }}
            className="w-full rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 font-mono text-xs text-admin-text"
            inputMode="numeric"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] text-admin-muted">Max hedge order (USD)</span>
          <input
            value={maxOrder}
            onChange={(e) => {
              markDirty();
              setMaxOrder(e.target.value);
            }}
            className="w-full rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 font-mono text-xs text-admin-text"
            inputMode="decimal"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] text-admin-muted">Max net hedge exposure (USD)</span>
          <input
            value={maxNet}
            onChange={(e) => {
              markDirty();
              setMaxNet(e.target.value);
            }}
            className="w-full rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 font-mono text-xs text-admin-text"
            inputMode="decimal"
          />
        </label>
        <label className="space-y-1 lg:col-span-2">
          <span className="text-[10px] text-admin-muted">Max daily hedge loss (USD)</span>
          <input
            value={dailyLoss}
            onChange={(e) => {
              markDirty();
              setDailyLoss(e.target.value);
            }}
            className="w-full rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 font-mono text-xs text-admin-text"
            inputMode="decimal"
          />
        </label>
        <label className="space-y-1 lg:col-span-3">
          <span className="text-[10px] text-admin-muted">System counterparty user id (UUID, optional)</span>
          <input
            value={counterparty}
            onChange={(e) => {
              markDirty();
              setCounterparty(e.target.value);
            }}
            placeholder="Empty = clear"
            className="w-full rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 font-mono text-xs text-admin-text"
          />
          <span className="text-[9px] text-admin-muted">Used for internal hedge bookkeeping; leave blank to unset.</span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          disabled={saveMutation.isPending || !token}
          onClick={() => saveMutation.mutate()}
          className="inline-flex items-center gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/18 disabled:opacity-40"
        >
          {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Save row
        </button>
        {row.market != null ? (
          <RemoveHybridRowButton
            rowId={row.id}
            market={row.market}
            token={token}
            queryClient={queryClient}
            setHedgeUiError={setHedgeUiError}
            onRemoved={onSaved}
            requestActionAuth={requestActionAuth}
          />
        ) : null}
        <span className="text-[10px] text-admin-muted">Requires markets:manage · Redis healthy for writes</span>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const BOT_SYMBOLS_FALLBACK = ['BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'XRP_USDT', 'BNB_USDT'];

export default function LiquidityPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [historyMarket, setHistoryMarket] = useState('BTC_USDT');

  useAdminWs({
    onEvent: (event) => {
      const type = (event?.type as string) ?? '';
      if (type === 'trade_executed') {
        queryClient.invalidateQueries({ queryKey: ['admin', 'analytics', 'liquidity'] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'liquidity', 'orderbooks'] });
      }
    },
  });

  const handleRefresh = () => {
    void controlQ.refetch();
    void liqQ.refetch();
    void historyQ.refetch();
    void botQ.refetch();
    void marketsQ.refetch();
    void hedgeRiskQ.refetch();
    void hybridCfgQ.refetch();
    void extProvidersQ.refetch();
  };

  const controlQ = useQuery({
    queryKey: ['admin', 'control', 'status', token],
    staleTime: 30_000,
    queryFn: () => getControlStatus(token),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const liqQ = useQuery({
    queryKey: ['admin', 'analytics', 'liquidity', token],
    staleTime: 30_000,
    queryFn: () => getLiquidityAnalytics(token),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const historyQ = useQuery({
    queryKey: ['admin', 'analytics', 'liquidity-history', token, historyMarket],
    staleTime: 30_000,
    queryFn: () => getLiquidityHistory(token, historyMarket),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const botQ = useQuery({
    queryKey: ['admin', 'liquidity-bot', 'config', token],
    staleTime: 30_000,
    queryFn: () => adminFetch<LiquidityBotConfig>('/liquidity-bot/config', { token }),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const marketsQ = useQuery({
    queryKey: ['admin', 'trading', 'markets', token],
    staleTime: 30_000,
    queryFn: () => getTradingMarkets(token),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const hedgeRiskQ = useQuery({
    queryKey: ['admin', 'hybrid', 'risk', 'overview', token],
    staleTime: 30_000,
    queryFn: () => fetchHedgeRiskOverview(token),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const hybridCfgQ = useQuery({
    queryKey: ['admin', 'hybrid', 'config', token],
    staleTime: 30_000,
    queryFn: () => fetchHybridConfigs(token),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const extProvidersQ = useQuery({
    queryKey: ['admin', 'external-liquidity', 'providers', token],
    staleTime: 30_000,
    queryFn: () => fetchExternalLiquidityProviders(token),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const failoverHistoryQ = useQuery({
    queryKey: ['admin', 'external-liquidity', 'failover-history', token],
    staleTime: 30_000,
    queryFn: () => fetchExternalLiquidityFailoverHistory(token, 20),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const [circuitProviderId, setCircuitProviderId] = useState('');
  const [failoverTargetId, setFailoverTargetId] = useState('');
  const [hedgeUiError, setHedgeUiError] = useState<string | null>(null);
  const [providerActionMsg, setProviderActionMsg] = useState<string | null>(null);
  const [provName, setProvName] = useState('Binance');
  const [provBaseUrl, setProvBaseUrl] = useState('https://api.binance.com');
  const [provApiKey, setProvApiKey] = useState('');
  const [provApiSecret, setProvApiSecret] = useState('');
  const [provTestnet, setProvTestnet] = useState(false);
  const [provPriority, setProvPriority] = useState('10');
  const [newHybridMarket, setNewHybridMarket] = useState('');
  const [actionAuthOpen, setActionAuthOpen] = useState(false);
  const [actionAuthLabel, setActionAuthLabel] = useState('');
  const [actionAuthError, setActionAuthError] = useState<string | null>(null);
  const actionAuthResolverRef = useRef<{
    resolve: (payload: ActionAuthPayload) => void;
    reject: (error: Error) => void;
  } | null>(null);

  const requestActionAuth = async (actionLabel: string): Promise<ActionAuthPayload> => {
    if (actionAuthResolverRef.current) {
      throw new AdminApiError('Another sensitive action authorization is already pending.', 'AUTH_PENDING');
    }
    return new Promise<ActionAuthPayload>((resolve, reject) => {
      actionAuthResolverRef.current = { resolve, reject };
      setActionAuthLabel(actionLabel);
      setActionAuthError(null);
      setActionAuthOpen(true);
    });
  };

  const closeActionAuthDialog = (error?: Error): void => {
    const pending = actionAuthResolverRef.current;
    actionAuthResolverRef.current = null;
    setActionAuthOpen(false);
    setActionAuthLabel('');
    setActionAuthError(null);
    if (pending) {
      if (error) pending.reject(error);
      else pending.reject(new AdminApiError('Sensitive action authorization cancelled.', 'CANCELLED'));
    }
  };

  const confirmActionAuth = (payload: ModalActionAuthPayload): void => {
    const pending = actionAuthResolverRef.current;
    actionAuthResolverRef.current = null;
    setActionAuthOpen(false);
    setActionAuthLabel('');
    setActionAuthError(null);
    if (!payload.twofa_code) {
      pending?.reject(new AdminApiError('Valid 6-digit 2FA code is required.', 'STEP_UP_REQUIRED'));
      return;
    }
    pending?.resolve({ reason: payload.reason, twofa: payload.twofa_code });
  };

  useEffect(() => {
    const rows = extProvidersQ.data?.success ? extProvidersQ.data.data : undefined;
    if (!rows?.length) return;
    if (!circuitProviderId || !rows.some((p) => p.id === circuitProviderId)) {
      setCircuitProviderId(rows[0].id);
    }
    if (!failoverTargetId || !rows.some((p) => p.id === failoverTargetId)) {
      setFailoverTargetId(rows[0].id);
    }
  }, [circuitProviderId, failoverTargetId, extProvidersQ.data]);

  const emergencyMutation = useMutation({
    mutationFn: async (active: boolean) => {
      setHedgeUiError(null);
      const action = active ? 'Enable hedge emergency stop' : 'Disable hedge emergency stop';
      const auth = await requestActionAuth(action);
      return postHedgeEmergencyStop(token, active, auth.reason, auth.twofa);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'hybrid'] });
      void hedgeRiskQ.refetch();
    },
    onError: (e) => {
      setHedgeUiError(formatAdminError(e, 'Emergency stop request failed'));
    },
  });

  const globalHedgeMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      setHedgeUiError(null);
      const action = enabled ? 'Enable global hedging' : 'Disable global hedging';
      const auth = await requestActionAuth(action);
      return postHedgeGlobalEnabled(token, enabled, auth.reason, auth.twofa);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'hybrid'] });
      void hedgeRiskQ.refetch();
    },
    onError: (e) => {
      setHedgeUiError(formatAdminError(e, 'Failed to change global hedge flag'));
    },
  });

  const circuitResetMutation = useMutation({
    mutationFn: async () => {
      setHedgeUiError(null);
      if (!circuitProviderId) throw new AdminApiError('No provider selected', 'NO_PROVIDER');
      const action = 'Reset provider circuit';
      const auth = await requestActionAuth(action);
      return resetProviderCircuit(token, circuitProviderId, auth.reason, auth.twofa);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'external-liquidity'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'hybrid'] });
      void extProvidersQ.refetch();
    },
    onError: (e) => {
      setHedgeUiError(formatAdminError(e, 'Circuit reset failed'));
    },
  });

  const manualFailoverMutation = useMutation({
    mutationFn: async () => {
      setProviderActionMsg(null);
      setHedgeUiError(null);
      if (!failoverTargetId) throw new AdminApiError('No failover target selected', 'NO_PROVIDER');
      const auth = await requestActionAuth('Manual external liquidity failover');
      return manualFailoverProvider(
        token,
        failoverTargetId,
        auth.reason,
        true,
        auth.twofa
      );
    },
    onSuccess: (res) => {
      const data = res.data as { to_provider_name?: string } | undefined;
      setProviderActionMsg(`Manual failover completed${data?.to_provider_name ? ` -> ${data.to_provider_name}` : ''}.`);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'external-liquidity'] });
      void extProvidersQ.refetch();
      void failoverHistoryQ.refetch();
    },
    onError: (e) => {
      setHedgeUiError(formatAdminError(e, 'Manual failover failed'));
    },
  });

  const createProviderMutation = useMutation({
    mutationFn: async () => {
      setProviderActionMsg(null);
      setHedgeUiError(null);
      const name = provName.trim();
      const url = provBaseUrl.trim();
      if (!name || !url || !provApiKey.trim() || !provApiSecret.trim()) {
        throw new AdminApiError('Name, base URL, API key and secret are required', 'VALIDATION');
      }
      const action = `Create liquidity provider ${name}`;
      const auth = await requestActionAuth(action);
      return createExternalLiquidityProvider(token, {
        provider_name: name,
        base_url: url,
        api_key: provApiKey.trim(),
        api_secret: provApiSecret.trim(),
        enabled: true,
        is_testnet: provTestnet,
        priority: parseInt(provPriority, 10) || 0,
      }, auth.reason, auth.twofa);
    },
    onSuccess: () => {
      setProviderActionMsg('Provider created.');
      setProvApiKey('');
      setProvApiSecret('');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'external-liquidity'] });
      void extProvidersQ.refetch();
    },
    onError: (e) => {
      setHedgeUiError(formatAdminError(e, 'Create provider failed'));
    },
  });

  const testProviderMutation = useMutation({
    mutationFn: async (providerId: string) => {
      setProviderActionMsg(null);
      setHedgeUiError(null);
      return testExternalLiquidityProvider(token, providerId);
    },
    onSuccess: (res) => {
      const d = res.data as { summary?: string } | undefined;
      setProviderActionMsg(d?.summary ? `Test: ${d.summary}` : 'Test succeeded.');
      void extProvidersQ.refetch();
    },
    onError: (e) => {
      setHedgeUiError(formatAdminError(e, 'Provider test failed'));
    },
  });

  const toggleProviderMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      setProviderActionMsg(null);
      setHedgeUiError(null);
      const auth = await requestActionAuth(`${enabled ? 'Enable' : 'Disable'} external provider`);
      return patchExternalLiquidityProvider(
        token,
        id,
        { enabled },
        auth.reason,
        auth.twofa
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'external-liquidity'] });
      void extProvidersQ.refetch();
    },
    onError: (e) => {
      setHedgeUiError(formatAdminError(e, 'Update provider failed'));
    },
  });

  const addHybridMarketMutation = useMutation({
    mutationFn: async () => {
      setHedgeUiError(null);
      const sym = newHybridMarket.trim();
      if (!sym) throw new AdminApiError('Select an active market', 'VALIDATION');
      const action = `Create hybrid override ${sym}`;
      const auth = await requestActionAuth(action);
      await createHybridMarketRow(token, sym, auth.reason, auth.twofa);
      return sym;
    },
    onSuccess: (sym) => {
      setProviderActionMsg(`Hybrid row added for ${sym} (copied from global).`);
      setNewHybridMarket('');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'hybrid'] });
      void hybridCfgQ.refetch();
      void hedgeRiskQ.refetch();
    },
    onError: (e) => {
      setHedgeUiError(formatAdminError(e, 'Could not add hybrid row'));
    },
  });

  const bot = botQ.data?.success ? botQ.data.data : undefined;
  const botSymbols: string[] = bot?.symbols?.length ? bot.symbols : BOT_SYMBOLS_FALLBACK;

  // Fetch all orderbooks in a single query to avoid hooks-in-loop
  const orderbooksQ = useQuery({
    queryKey: ['admin', 'liquidity', 'orderbooks', botSymbols.join(','), token],
    staleTime: 15_000,
    queryFn: async () => {
      const results = await Promise.all(
        botSymbols.map((sym) => getTradingOrderbook(token, sym).then((r) => ({ sym, data: r?.data ?? null })))
      );
      return results;
    },
    enabled: !!token && botSymbols.length > 0,
    refetchInterval: 15_000,
  });

  const engine = controlQ.data?.success ? controlQ.data.data?.liquidity_engine_status : undefined;
  const analyticsData = liqQ.data?.success ? liqQ.data.data : undefined;

  const historyRows = useMemo(() => {
    const raw = historyQ.data?.data?.history ?? [];
    return (raw as Array<{ date: string; liquidity_score: number }>).map((d) => ({
      date: d.date?.slice(5, 10) ?? '',
      score: typeof d.liquidity_score === 'number' ? d.liquidity_score : 0,
    }));
  }, [historyQ.data]);

  const totalMarkets = marketsQ.data?.data?.markets?.length ?? 0;
  const runningMarkets = marketsQ.data?.data?.marketsRunning ?? 0;
  const haltedMarkets = marketsQ.data?.data?.marketsHalted ?? 0;

  // Build live orderbook rows
  const obMap = useMemo(() => {
    const map = new Map<string, { spread_pct: number | null; depth: string | null; bids: number; asks: number; top_bid: string | null; top_ask: string | null }>();
    for (const entry of orderbooksQ.data ?? []) {
      const d = entry.data;
      map.set(entry.sym, {
        spread_pct: d?.spread_pct ?? null,
        depth: d?.depth ?? null,
        bids: d?.bids?.length ?? 0,
        asks: d?.asks?.length ?? 0,
        top_bid: d?.bids?.[0]?.price ?? null,
        top_ask: d?.asks?.[0]?.price ?? null,
      });
    }
    return map;
  }, [orderbooksQ.data]);

  const liveRows = useMemo(() => {
    return botSymbols.map((sym) => ({
      symbol: sym,
      loading: orderbooksQ.isLoading,
      ...(obMap.get(sym) ?? { spread_pct: null, depth: null, bids: 0, asks: 0, top_bid: null, top_ask: null }),
    }));
  }, [botSymbols, obMap, orderbooksQ.isLoading]);

  // Aggregate spread score from live rows
  const validSpreads = liveRows.filter((r) => r.spread_pct != null && r.spread_pct >= 0);
  const avgSpread = validSpreads.length
    ? validSpreads.reduce((acc, r) => acc + (r.spread_pct ?? 0), 0) / validSpreads.length
    : null;
  const overallScore = avgSpread != null ? Math.max(0, Math.min(100, 100 - avgSpread)).toFixed(1) : null;

  const hedgeOverview = hedgeRiskQ.data?.success ? hedgeRiskQ.data.data : undefined;
  const extProviders = extProvidersQ.data?.success ? extProvidersQ.data.data : undefined;
  const failoverHistory = failoverHistoryQ.data?.success ? failoverHistoryQ.data.data ?? [] : [];

  const hybridRows = useMemo(() => {
    const rows = hybridCfgQ.data?.success ? hybridCfgQ.data.data ?? [] : [];
    return [...rows].sort((a, b) => {
      if (a.market == null && b.market != null) return -1;
      if (a.market != null && b.market == null) return 1;
      return (a.market ?? '').localeCompare(b.market ?? '');
    });
  }, [hybridCfgQ.data]);

  const hybridMarketSymbolSet = useMemo(() => new Set(hybridRows.map((r) => r.market).filter(Boolean) as string[]), [hybridRows]);

  const hasGlobalHybridRow = useMemo(() => hybridRows.some((r) => r.market == null), [hybridRows]);

  const hybridOverrideCandidates = useMemo(() => {
    const rows = marketsQ.data?.data?.markets ?? [];
    return rows
      .map((m) => m.symbol)
      .filter((sym) => sym && !hybridMarketSymbolSet.has(sym))
      .sort((a, b) => a.localeCompare(b));
  }, [marketsQ.data, hybridMarketSymbolSet]);

  const allFetching =
    controlQ.isFetching ||
    liqQ.isFetching ||
    botQ.isFetching ||
    historyQ.isFetching ||
    orderbooksQ.isFetching ||
    hedgeRiskQ.isFetching ||
    hybridCfgQ.isFetching ||
    extProvidersQ.isFetching ||
    failoverHistoryQ.isFetching;

  const engineStatus = (engine ?? '').toLowerCase();
  const engineOk = engineStatus.includes('up') || engineStatus === 'active' || engineStatus === 'running' || engineStatus === 'healthy';

  return (
    <AdminPageFrame
      title="Liquidity"
      description="Monitor live spread health, orderbook depth, and bot configuration."
      status="active"
      quickActions={
        <button
          type="button"
          onClick={handleRefresh}
          className="flex items-center gap-1.5 rounded-lg border border-admin-border bg-admin-card px-3 py-2 text-sm font-medium text-admin-muted hover:text-admin-text transition-colors"
        >
          <RefreshCw className={`h-4 w-4 ${allFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      }
    >
      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Engine Status"
          value={
            <span className={engineOk ? 'text-emerald-400' : 'text-red-400'}>
              {engine ?? '—'}
            </span>
          }
          sub="Liquidity engine health"
          icon={engineOk ? CheckCircle2 : AlertTriangle}
          color={engineOk ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}
          loading={controlQ.isLoading}
        />
        <KpiCard
          label="Markets Online"
          value={
            <span>
              {runningMarkets}
              <span className="text-sm font-normal text-admin-muted ml-1">/ {totalMarkets}</span>
            </span>
          }
          sub={haltedMarkets > 0 ? `${haltedMarkets} halted` : 'All markets running'}
          icon={Activity}
          color={haltedMarkets > 0 ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'}
          loading={marketsQ.isLoading}
        />
        <KpiCard
          label="Spread Score"
          value={overallScore ?? '—'}
          sub={avgSpread != null ? `Avg spread ${avgSpread.toFixed(3)}% across ${validSpreads.length} markets` : 'No live data'}
          icon={TrendingUp}
          color="bg-indigo-500/10 text-indigo-400"
          loading={orderbooksQ.isLoading}
        />
        <KpiCard
          label="Bot Status"
          value={
            bot ? (
              <span className={bot.enabled ? 'text-emerald-400' : 'text-admin-muted'}>
                {bot.enabled ? 'Enabled' : 'Disabled'}
              </span>
            ) : (
              '—'
            )
          }
          sub={bot ? `${bot.symbols?.length ?? 0} symbols · ${bot.spreadBps} bps` : undefined}
          icon={Bot}
          color={bot?.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-admin-muted/10 text-admin-muted'}
          loading={botQ.isLoading}
        />
      </div>

      {/* Hybrid hedge execution — risk gates (never blocks internal matching) */}
      <div className="rounded-xl border border-amber-500/25 bg-admin-card overflow-hidden shadow-[0_0_0_1px_rgba(245,158,11,0.08)_inset]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-admin-border px-4 py-3">
          <div className="flex items-start gap-3 min-w-[200px]">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/12 text-amber-400 ring-1 ring-amber-500/20">
              <Power className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-admin-text">Hybrid hedge & routing risk</h3>
              <p className="text-[11px] text-admin-muted mt-0.5 max-w-2xl">
                Gates apply to external hedge jobs only — user balances and internal order matching stay on hot paths regardless of these switches.
              </p>
            </div>
          </div>
          <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-400/90">
            Safety
          </span>
        </div>
        <div className="space-y-4 p-4">
          {hedgeUiError && (
            <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">{hedgeUiError}</div>
          )}
          {hedgeRiskQ.isError && (
            <p className="text-xs text-amber-400/90">Hedge risk overview unavailable (check permissions: monitoring:view).</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                hedgeOverview?.flags.hedge_global_enabled
                  ? 'bg-emerald-500/12 text-emerald-400 ring-1 ring-emerald-500/20'
                  : 'bg-white/[0.04] text-admin-muted ring-1 ring-admin-border'
              }`}
            >
              DB hedge master: {hedgeOverview?.flags.hedge_global_enabled ? 'ON' : 'OFF'}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                hedgeOverview?.flags.hedge_emergency_stop
                  ? 'bg-red-500/12 text-red-400 ring-1 ring-red-500/25'
                  : 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/15'
              }`}
            >
              Emergency stop: {hedgeOverview?.flags.hedge_emergency_stop ? 'ACTIVE' : 'clear'}
            </span>
            {hedgeOverview != null && (
              <span className="text-[11px] text-admin-muted">
                Circuit trips after {hedgeOverview.circuit_trip_failure_count} consecutive provider failures
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={globalHedgeMutation.isPending || emergencyMutation.isPending || !token}
              onClick={() => globalHedgeMutation.mutate(true)}
              className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/15 disabled:opacity-40"
            >
              {globalHedgeMutation.isPending ? (
                <>
                  <Loader2 className="inline h-3.5 w-3.5 animate-spin mr-2" aria-hidden /> Enabling…
                </>
              ) : (
                'Enable hedge (DB)'
              )}
            </button>
            <button
              type="button"
              disabled={globalHedgeMutation.isPending || emergencyMutation.isPending || !token}
              onClick={() => globalHedgeMutation.mutate(false)}
              className="rounded-lg border border-admin-border bg-white/[0.03] px-3 py-2 text-xs font-semibold text-admin-muted hover:text-admin-text disabled:opacity-40"
            >
              Disable hedge (DB)
            </button>
            <button
              type="button"
              disabled={globalHedgeMutation.isPending || emergencyMutation.isPending || !token}
              onClick={() => emergencyMutation.mutate(true)}
              className="rounded-lg border border-red-500/35 bg-red-500/12 px-3 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/18 disabled:opacity-40"
            >
              Emergency stop ON
            </button>
            <button
              type="button"
              disabled={globalHedgeMutation.isPending || emergencyMutation.isPending || !token}
              onClick={() => emergencyMutation.mutate(false)}
              className="rounded-lg border border-emerald-500/25 bg-white/[0.02] px-3 py-2 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/8 disabled:opacity-40"
            >
              Clear emergency stop
            </button>
          </div>
          {hedgeOverview && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-admin-border bg-white/[0.02] px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-admin-muted">Today realized (signed)</p>
                <p className="mt-1 font-mono text-sm font-semibold text-admin-text tabular-nums">
                  {Number(hedgeOverview.pnlToday.signed_realized_usd).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{' '}
                  USD
                </p>
              </div>
              <div className="rounded-lg border border-admin-border bg-white/[0.02] px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-admin-muted">Adverse hedge PnL (today)</p>
                <p className="mt-1 font-mono text-sm font-semibold text-amber-400 tabular-nums">
                  {Number(hedgeOverview.pnlToday.adverse_usd).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{' '}
                  USD
                </p>
              </div>
              <div className="rounded-lg border border-admin-border bg-white/[0.02] px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-admin-muted">Configured ceilings</p>
                <p className="mt-1 text-xs text-admin-muted leading-relaxed tabular-nums">
                  Order cap{' '}
                  <span className="text-admin-text font-mono">
                    {hedgeOverview.limits?.max_hedge_notional_usd_per_order ?? '—'}
                  </span>
                  {' · '}Net exp{' '}
                  <span className="text-admin-text font-mono">{hedgeOverview.limits?.max_net_hedge_exposure_usd ?? '—'}</span>
                  {' · '}Daily loss max{' '}
                  <span className="text-admin-text font-mono">{hedgeOverview.limits?.hedge_max_daily_loss_usd ?? '—'}</span>
                </p>
              </div>
            </div>
          )}
          {hedgeOverview && hedgeOverview.exposures.length > 0 && (
            <div className="rounded-lg border border-admin-border bg-white/[0.02] overflow-hidden">
              <p className="border-b border-admin-border px-3 py-2 text-[11px] font-semibold text-admin-muted">Per-market hedge exposure (gauge)</p>
              <div className="overflow-x-auto max-h-[200px]">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-white/[0.02] text-[10px] uppercase tracking-wide text-admin-muted">
                    <tr>
                      <th className="px-3 py-2">Market</th>
                      <th className="px-3 py-2 tabular-nums">Exposure USD</th>
                      <th className="px-3 py-2 tabular-nums">Realized</th>
                      <th className="px-3 py-2 tabular-nums">Unrealized</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-admin-border">
                    {hedgeOverview.exposures.map((row) => (
                      <tr key={row.market} className="text-admin-text">
                        <td className="px-3 py-1.5 font-mono">{row.market}</td>
                        <td className="px-3 py-1.5 font-mono tabular-nums text-indigo-300">{row.exposure_usd}</td>
                        <td className="px-3 py-1.5 font-mono tabular-nums">{row.realized_pnl}</td>
                        <td className="px-3 py-1.5 font-mono tabular-nums">{row.unrealized_pnl}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {hybridCfgQ.data?.success && hybridRows.length === 0 && (
            <p className="text-xs text-amber-400/90">
              No hybrid_execution_config rows returned — check DB migrations or API permissions (<span className="font-mono">monitoring:view</span>).
            </p>
          )}
          {hybridRows.length > 0 && (
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-admin-muted">Hybrid execution config</p>
                <p className="text-[10px] text-admin-muted max-w-3xl">
                  Global row (<span className="font-mono">market</span> empty) is the default for all symbols. Per-market rows override routing bands,
                  hedge flags, and limits for that symbol only. Each card saves independently with{' '}
                  <span className="font-mono text-admin-text/80">Save row</span>.
                </p>
              </div>
              {hasGlobalHybridRow ? (
                <div className="flex flex-wrap items-end gap-3 rounded-lg border border-admin-border bg-white/[0.03] p-3">
                  <label className="flex flex-col gap-1 min-w-[220px]">
                    <span className="text-[10px] font-semibold uppercase text-admin-muted">New per-market override</span>
                    <select
                      value={newHybridMarket}
                      onChange={(e) => setNewHybridMarket(e.target.value)}
                      className="rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 text-xs font-mono text-admin-text"
                    >
                      <option value="">Choose symbol…</option>
                      {hybridOverrideCandidates.map((sym) => (
                        <option key={sym} value={sym}>
                          {sym}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={
                      !newHybridMarket || addHybridMarketMutation.isPending || !token || hybridOverrideCandidates.length === 0
                    }
                    onClick={() => addHybridMarketMutation.mutate()}
                    className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/15 disabled:opacity-40"
                  >
                    {addHybridMarketMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Clone global → row
                  </button>
                  <p className="text-[10px] text-admin-muted max-w-md leading-snug">
                    Active spot markets without a row yet. New rows copy numeric/policy fields from global — then edit the card.
                  </p>
                </div>
              ) : null}
              <div className="space-y-3 max-h-[min(70vh,720px)] overflow-y-auto pr-1">
                {hybridRows.map((r) => (
                  <HybridExecutionRowCard
                    key={r.id}
                    row={r}
                    token={token}
                    queryClient={queryClient}
                    setHedgeUiError={setHedgeUiError}
                    onSaved={() => void hedgeRiskQ.refetch()}
                    requestActionAuth={requestActionAuth}
                  />
                ))}
              </div>
            </div>
          )}
          <div className="rounded-lg border border-admin-border bg-white/[0.02] p-3 space-y-4">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-admin-muted">External liquidity providers</p>
              <p className="text-[10px] text-admin-muted">
                Tier 1 hedge routes IOC orders here when hybrid execution is on. Adding or editing providers requires{' '}
                <span className="font-mono text-admin-text/80">markets:manage</span>; Redis must be healthy for writes.
              </p>
            </div>
            {providerActionMsg ? <p className="text-xs text-indigo-300">{providerActionMsg}</p> : null}
            {extProviders != null && extProviders.length === 0 ? (
              <p className="text-xs text-amber-400/90">No providers configured — hedge worker has nowhere to route.</p>
            ) : null}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6 border-t border-admin-border pt-3">
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase text-admin-muted">Add provider</p>
                <label className="block space-y-1">
                  <span className="text-[10px] text-admin-muted">Display name</span>
                  <input
                    value={provName}
                    onChange={(e) => setProvName(e.target.value)}
                    className="w-full rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 text-xs text-admin-text"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] text-admin-muted">Base URL (no trailing slash)</span>
                  <input
                    value={provBaseUrl}
                    onChange={(e) => setProvBaseUrl(e.target.value)}
                    className="w-full rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 font-mono text-xs text-admin-text"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] text-admin-muted">API key</span>
                  <input
                    type="password"
                    autoComplete="off"
                    value={provApiKey}
                    onChange={(e) => setProvApiKey(e.target.value)}
                    className="w-full rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 font-mono text-xs text-admin-text"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] text-admin-muted">API secret</span>
                  <input
                    type="password"
                    autoComplete="off"
                    value={provApiSecret}
                    onChange={(e) => setProvApiSecret(e.target.value)}
                    className="w-full rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 font-mono text-xs text-admin-text"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-[11px] text-admin-text cursor-pointer">
                    <input type="checkbox" checked={provTestnet} onChange={(e) => setProvTestnet(e.target.checked)} className="rounded border-admin-border" />
                    Testnet
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="text-[10px] text-admin-muted">Priority</span>
                    <input
                      value={provPriority}
                      onChange={(e) => setProvPriority(e.target.value)}
                      className="w-20 rounded-lg border border-admin-border bg-admin-surface px-2 py-1 font-mono text-xs text-admin-text"
                      inputMode="numeric"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  disabled={createProviderMutation.isPending || !token}
                  onClick={() => createProviderMutation.mutate()}
                  className="inline-flex items-center gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/18 disabled:opacity-40"
                >
                  {createProviderMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Add provider
                </button>
              </div>

              {extProviders != null && extProviders.length > 0 ? (
                <div className="space-y-3 lg:border-l lg:border-admin-border lg:pl-6">
                  <p className="text-[10px] font-semibold uppercase text-admin-muted">Configured</p>
                  <div className="overflow-x-auto rounded-lg border border-admin-border">
                    <table className="min-w-full text-left text-xs">
                      <thead className="bg-white/[0.02] text-[10px] font-semibold uppercase tracking-wider text-admin-muted">
                        <tr>
                          <th className="px-2 py-2">Name</th>
                          <th className="px-2 py-2">URL</th>
                          <th className="px-2 py-2">Creds</th>
                          <th className="px-2 py-2">Health</th>
                          <th className="px-2 py-2">Jobs</th>
                          <th className="px-2 py-2">Failovers</th>
                          <th className="px-2 py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-admin-border text-admin-text">
                        {extProviders.map((p) => (
                          <tr key={p.id}>
                            <td className="px-2 py-2 font-medium">
                              {p.provider_name}
                              {p.is_testnet ? (
                                <span className="ml-1 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] text-amber-400">net</span>
                              ) : null}
                              <span className="ml-1 text-[10px] text-admin-muted">p{p.priority}</span>
                            </td>
                            <td className="max-w-[140px] truncate px-2 py-2 font-mono text-[10px]" title={p.base_url}>
                              {p.base_url}
                            </td>
                            <td className="px-2 py-2 tabular-nums text-[10px]">
                              {p.api_key_configured && p.api_secret_configured ? (
                                <span className="text-emerald-400">OK</span>
                              ) : (
                                <span className="text-red-400">—</span>
                              )}
                            </td>
                            <td className="px-2 py-2">
                              <div className="space-y-0.5">
                                <p className="tabular-nums text-[10px]">
                                  fails <span className={p.consecutive_failures > 0 ? 'text-red-400' : 'text-emerald-400'}>{p.consecutive_failures}</span>
                                </p>
                                <p className="text-[9px] text-admin-muted">
                                  ok {p.last_health_ok_at ? new Date(p.last_health_ok_at).toLocaleString() : 'never'}
                                </p>
                                {p.last_failure_reason ? (
                                  <p className="max-w-[180px] truncate text-[9px] text-amber-400" title={p.last_failure_reason}>
                                    {p.last_failure_reason}
                                  </p>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-2 py-2 tabular-nums">{p.active_hedge_jobs}</td>
                            <td className="px-2 py-2 tabular-nums">{p.failover_count_7d}</td>
                            <td className="px-2 py-2">
                              <div className="flex flex-wrap gap-1">
                                <button
                                  type="button"
                                  disabled={testProviderMutation.isPending || !token}
                                  onClick={() => testProviderMutation.mutate(p.id)}
                                  className="rounded border border-admin-border bg-white/[0.04] px-2 py-1 text-[10px] font-semibold hover:bg-white/[0.08] disabled:opacity-40"
                                >
                                  Test
                                </button>
                                <button
                                  type="button"
                                  disabled={toggleProviderMutation.isPending || !token}
                                  onClick={() => toggleProviderMutation.mutate({ id: p.id, enabled: !p.enabled })}
                                  className="rounded border border-admin-border bg-white/[0.04] px-2 py-1 text-[10px] font-semibold hover:bg-white/[0.08] disabled:opacity-40"
                                >
                                  {p.enabled ? 'Disable' : 'Enable'}
                                </button>
                                <button
                                  type="button"
                                  disabled={manualFailoverMutation.isPending || !token}
                                  onClick={() => {
                                    setFailoverTargetId(p.id);
                                    manualFailoverMutation.mutate();
                                  }}
                                  className="rounded border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-[10px] font-semibold text-indigo-300 hover:bg-indigo-500/18 disabled:opacity-40"
                                >
                                  Promote
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="flex flex-col gap-1 min-w-[220px]">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-admin-muted">Manual failover target</span>
                        <select
                          value={failoverTargetId}
                          onChange={(e) => setFailoverTargetId(e.target.value)}
                          className="rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 text-xs font-medium text-admin-text"
                        >
                          {extProviders.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.provider_name} — p{p.priority} — active jobs {p.active_hedge_jobs}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        disabled={manualFailoverMutation.isPending || !token}
                        onClick={() => manualFailoverMutation.mutate()}
                        className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/16 disabled:opacity-40"
                      >
                        {manualFailoverMutation.isPending ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> : null}
                        Manual failover
                      </button>
                    </div>
                    <label className="flex flex-col gap-1 min-w-[200px]">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-admin-muted">Reset provider circuit</span>
                      <select
                        value={circuitProviderId}
                        onChange={(e) => setCircuitProviderId(e.target.value)}
                        className="rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 text-xs font-medium text-admin-text"
                      >
                        {extProviders.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.provider_name} — failures {p.consecutive_failures} {p.enabled ? '' : '(disabled)'}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={circuitResetMutation.isPending || !token}
                      onClick={() => circuitResetMutation.mutate()}
                      className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-400 hover:bg-amber-500/16 disabled:opacity-40"
                    >
                      {circuitResetMutation.isPending ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> : null}
                      Reset streak & enable
                    </button>
                  </div>
                  <div className="rounded-lg border border-admin-border bg-white/[0.02] p-2">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-admin-muted">Failover history (recent)</p>
                    {failoverHistory.length === 0 ? (
                      <p className="text-[10px] text-admin-muted">No failover events recorded yet.</p>
                    ) : (
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {failoverHistory.map((h) => (
                          <div key={h.id} className="rounded border border-admin-border/70 bg-admin-surface px-2 py-1.5 text-[10px]">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-medium text-admin-text">
                                {`${h.from_provider_name ?? 'none'} -> ${h.to_provider_name}`}
                              </span>
                              <span className="text-admin-muted">{new Date(h.created_at).toLocaleString()}</span>
                            </div>
                            <p className="mt-0.5 text-admin-muted">{h.reason}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center lg:border-l lg:border-admin-border lg:pl-6">
                  <p className="text-[11px] text-admin-muted">Providers you add appear here with Test / Enable controls.</p>
                </div>
              )}
            </div>
          </div>
          {hybridCfgQ.isError && (
            <p className="text-xs text-admin-muted">Hybrid config unavailable — limits cannot be edited until the API succeeds.</p>
          )}
        </div>
      </div>

      {/* Live Orderbook Depth Table */}
      <div className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-admin-border px-4 py-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-admin-text">Live Orderbook Depth</h3>
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              15s refresh
            </span>
          </div>
          <span className="text-xs text-admin-muted">{botSymbols.length} monitored symbols</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white/[0.02] text-[11px] font-semibold uppercase tracking-wider text-admin-muted">
              <tr>
                <th className="px-4 py-2.5">Market</th>
                <th className="px-4 py-2.5">Spread</th>
                <th className="px-4 py-2.5">Health</th>
                <th className="px-4 py-2.5">Depth</th>
                <th className="px-4 py-2.5">Bids</th>
                <th className="px-4 py-2.5">Asks</th>
                <th className="px-4 py-2.5">Top Bid</th>
                <th className="px-4 py-2.5">Top Ask</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {liveRows.map((row) => {
                const health = spreadHealthColor(row.spread_pct);
                const depth = depthBadge(row.depth);
                return (
                  <tr key={row.symbol} className="hover:bg-white/[0.03] transition-colors group">
                    <td className="px-4 py-3">
                      <span className="rounded-md border border-admin-border bg-white/[0.04] px-2 py-0.5 text-xs font-mono font-semibold text-admin-text">
                        {row.symbol}
                      </span>
                    </td>
                    <td className="px-4 py-3 min-w-[160px]">
                      {row.loading ? (
                        <div className="h-2.5 w-24 animate-pulse rounded bg-white/[0.06]" />
                      ) : (
                        <SpreadBar pct={row.spread_pct} />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.loading ? (
                        <div className="h-5 w-16 animate-pulse rounded-full bg-white/[0.06]" />
                      ) : (
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${health.bg} ${health.text}`}>
                          {health.label}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.loading ? (
                        <div className="h-5 w-14 animate-pulse rounded-full bg-white/[0.06]" />
                      ) : (
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${depth.bg} ${depth.text}`}>
                          {row.depth ?? '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-admin-text">
                      <span className="flex items-center gap-1">
                        <ArrowUpRight className="h-3 w-3 text-emerald-400" />
                        {row.bids}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-admin-text">
                      <span className="flex items-center gap-1">
                        <ArrowDownLeft className="h-3 w-3 text-red-400" />
                        {row.asks}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-emerald-400">
                      {row.top_bid != null ? Number(row.top_bid).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-red-400">
                      {row.top_ask != null ? Number(row.top_ask).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Analytics Summary (Trade Count, Volume, M/T Ratio) */}
      {analyticsData && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-admin-border bg-admin-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-admin-muted mb-1">Trade Count</p>
            <p className="text-xl font-bold text-admin-text tabular-nums">
              {(analyticsData as { tradeCount?: number }).tradeCount?.toLocaleString() ?? '—'}
            </p>
          </div>
          <div className="rounded-xl border border-admin-border bg-admin-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-admin-muted mb-1">Total Volume</p>
            <p className="text-xl font-bold text-admin-text tabular-nums">
              {(analyticsData as { totalVolume?: number }).totalVolume
                ? `$${Number((analyticsData as { totalVolume?: number }).totalVolume).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                : '—'}
            </p>
          </div>
          <div className="rounded-xl border border-admin-border bg-admin-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-admin-muted mb-1">Maker/Taker Ratio</p>
            <p className="text-xl font-bold text-admin-text tabular-nums">
              {(analyticsData as { makerTakerRatio?: number }).makerTakerRatio != null
                ? Number((analyticsData as { makerTakerRatio?: number }).makerTakerRatio).toFixed(2)
                : '—'}
            </p>
          </div>
        </div>
      )}

      {/* 14d Liquidity Score Trend */}
      <div className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-admin-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-admin-text">Liquidity Score Trend (14d)</h3>
            <p className="text-xs text-admin-muted mt-0.5">Historical score for selected market</p>
          </div>
          <div className="relative">
            <select
              value={historyMarket}
              onChange={(e) => setHistoryMarket(e.target.value)}
              className="appearance-none rounded-lg border border-admin-border bg-admin-surface pl-3 pr-8 py-1.5 text-xs font-medium text-admin-text focus:outline-none focus:ring-2 focus:ring-indigo-500/40 cursor-pointer"
            >
              {botSymbols.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-admin-muted" />
          </div>
        </div>
        <div className="p-4">
          <div className="h-[220px]">
            {historyQ.isLoading ? (
              <div className="flex h-full items-center justify-center">
                <RefreshCw className="h-5 w-5 animate-spin text-admin-muted" />
              </div>
            ) : historyRows.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-admin-muted">
                <BarChart3 className="h-8 w-8 opacity-30" />
                <p className="text-sm">No history data for {historyMarket}</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={historyRows} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.35)' }}
                    axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.35)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<DarkTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="score"
                    name="Score"
                    stroke="#6366F1"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: '#6366F1', stroke: '#fff', strokeWidth: 1.5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Bot Configuration */}
      <div className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-admin-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-admin-muted" />
            <h3 className="text-sm font-semibold text-admin-text">Liquidity Bot Configuration</h3>
          </div>
          {bot && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                bot.enabled
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'bg-admin-muted/10 text-admin-muted'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${bot.enabled ? 'bg-emerald-400 animate-pulse' : 'bg-admin-muted'}`} />
              {bot.enabled ? 'Active' : 'Inactive'}
            </span>
          )}
        </div>
        <div className="p-4">
          {botQ.isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <div key={i} className="h-4 w-full animate-pulse rounded bg-white/[0.06]" />)}
            </div>
          ) : !bot ? (
            <p className="text-sm text-admin-muted">No configuration returned.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-4">
                <div className="rounded-lg border border-admin-border bg-white/[0.02] p-3">
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-admin-muted mb-1">Spread</dt>
                  <dd className="text-lg font-bold font-mono text-admin-text">
                    {bot.spreadBps}
                    <span className="text-xs font-normal text-admin-muted ml-1">bps</span>
                  </dd>
                  <dd className="text-[10px] text-admin-muted mt-0.5">
                    ≈ {(bot.spreadBps / 100).toFixed(2)}%
                  </dd>
                </div>
                <div className="rounded-lg border border-admin-border bg-white/[0.02] p-3">
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-admin-muted mb-1">Order Size</dt>
                  <dd className="text-lg font-bold font-mono text-admin-text">{bot.orderSize}</dd>
                  <dd className="text-[10px] text-admin-muted mt-0.5">Base asset per order</dd>
                </div>
                <div className="rounded-lg border border-admin-border bg-white/[0.02] p-3">
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-admin-muted mb-1">API Key</dt>
                  <dd className="text-sm font-mono text-admin-text">
                    {bot.apiKeyConfigured ? bot.apiKeyPreview ?? 'Configured' : 'Not configured'}
                  </dd>
                  <dd className="mt-0.5">
                    {bot.apiKeyConfigured ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                        <ShieldCheck className="h-3 w-3" /> Configured
                      </span>
                    ) : (
                      <span className="text-[10px] text-red-400">Missing</span>
                    )}
                  </dd>
                </div>
                <div className="rounded-lg border border-admin-border bg-white/[0.02] p-3">
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-admin-muted mb-1">Symbols</dt>
                  <dd className="text-lg font-bold text-admin-text">{bot.symbols?.length ?? 0}</dd>
                  <dd className="text-[10px] text-admin-muted mt-0.5">Active pairs</dd>
                </div>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-admin-muted mb-2">Monitored Symbols</p>
                <div className="flex flex-wrap gap-2">
                  {bot.symbols?.map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-1 rounded-lg border border-admin-border bg-white/[0.04] px-2.5 py-1 text-xs font-mono font-medium text-admin-text"
                    >
                      <Droplets className="h-3 w-3 text-indigo-400" />
                      {s}
                    </span>
                  ))}
                </div>
              </div>
              <p className="mt-4 text-[11px] text-admin-muted border-t border-admin-border pt-3">
                Read-only view of server-side configuration. Bot parameters can only be changed via server environment variables.
              </p>
            </>
          )}
        </div>
      </div>
      <ActionAuthModal
        open={actionAuthOpen}
        onClose={() => closeActionAuthDialog()}
        onConfirm={confirmActionAuth}
        title="Authorize Sensitive Action"
        actionLabel={actionAuthLabel}
        externalError={actionAuthError}
        twofaRequired
      />
    </AdminPageFrame>
  );
}
