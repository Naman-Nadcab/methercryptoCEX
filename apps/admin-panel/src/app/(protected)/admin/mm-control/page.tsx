'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircuitBoard,
  DollarSign,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { useAdminAuthStore } from '@/store/auth';
import {
  getMmControlGlobal,
  getMmControlPair,
  getMmControlStatus,
  postMmControlGlobal,
  postMmControlPair,
  deleteMmControlPair,
  isMmControlOk,
  type MMGlobalRuntimeConfig,
  type MMPairRuntimeConfig,
} from '@/lib/mm-control-api';
import { defaultPairResetBody } from '@/lib/mm-desk-helpers';
import { buildDeskAlerts, type DeskAlertFixId } from '@/lib/mm-desk-signals';
import { parseEliteSymbolMetrics } from '@/lib/mm-desk-elite-parse';
import { getMmEliteProfitability, getMmCircuitState, postAdminCancelAllOrders } from '@/lib/mm-desk-extra-api';
import { adminFetch } from '@/lib/api';
import { getTradingMarkets } from '@/lib/trading-api';
import {
  MmDeskStatusBar,
  MmDeskAlertBanner,
  MmPairTable,
  type PairSparkHistory,
  MmPairSettingsPanel,
  MmLiveMetricsPanel,
  MmIntelligencePanel,
  MmExecutionDepthPanel,
  MmDeskOverrideStrip,
} from '@/components/mm-desk';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Input,
  Badge,
  Skeleton,
  Modal,
  SafeActionModal,
} from '@/components/ui';
import { AdminPageFrame, type AdminPageStatus } from '@/components/admin-shell/AdminPageFrame';
import { ProtectedAction } from '@/components/rbac/ProtectedAction';
import { cn } from '@/lib/cn';

const REFETCH_MS = 12_000;
const SPARK_MAX_POINTS = 18;

// ── Types ─────────────────────────────────────────────────────────────────────

type MmHealthData = {
  level: 'ok' | 'warning' | 'critical';
  pauseBot: boolean;
  spreadMultiplier: number;
  oracleMaxAgeSec: number;
  settlementLagSec: number;
  pendingSettlementCount: number;
  botErrorRate: number;
  quoteAgeSec: number | null;
  externalMaxDivergenceBps: number;
  reasons: string[];
};

type MmRiskData = {
  apiKeysCount: number;
  topTraders: unknown[];
  usersWithKeys: Array<{ userId: string; keysCount: number }>;
  topTradersDailyPnl: unknown[];
  inventoryImbalance: unknown[];
  emergencyStoppedUsers: unknown[];
};

// ── Small helpers ─────────────────────────────────────────────────────────────

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
}

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ type, msg, onClose }: { type: 'success' | 'error'; msg: string; onClose: () => void }) {
  return (
    <div
      className={cn(
        'fixed bottom-6 right-6 z-[9999] flex items-center gap-3 rounded-xl border px-4 py-3 shadow-2xl text-sm font-medium',
        type === 'success'
          ? 'border-emerald-500/30 bg-emerald-950/90 text-emerald-300'
          : 'border-red-500/30 bg-red-950/90 text-red-300'
      )}
    >
      {type === 'success' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
      {msg}
      <button type="button" onClick={onClose} className="ml-2 opacity-60 hover:opacity-100">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function useToast() {
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = useCallback((type: 'success' | 'error', msg: string) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ type, msg });
    timer.current = setTimeout(() => setToast(null), 4500);
  }, []);
  return { toast, show, dismiss: () => setToast(null) };
}

// ── KPI strip ─────────────────────────────────────────────────────────────────

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
  sub?: React.ReactNode;
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
        <div className="h-7 w-24 animate-pulse rounded bg-white/[0.06]" />
      ) : (
        <div className="text-2xl font-bold text-admin-text tabular-nums leading-none">{value}</div>
      )}
      {sub && <div className="text-[11px] text-admin-muted">{sub}</div>}
    </div>
  );
}

// ── MM Health Banner ──────────────────────────────────────────────────────────

function MmHealthBanner({
  health,
  onDismiss,
}: {
  health: MmHealthData;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (health.level === 'ok') return null;

  const isCritical = health.level === 'critical';
  const fmtSec = (s: number) => {
    if (s < 60) return `${s.toFixed(0)}s`;
    if (s < 3600) return `${(s / 60).toFixed(0)}m`;
    return `${(s / 3600).toFixed(1)}h`;
  };

  return (
    <div
      className={cn(
        'rounded-xl border px-4 py-3',
        isCritical
          ? 'border-red-500/30 bg-red-950/40'
          : 'border-amber-500/30 bg-amber-950/30'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <ShieldAlert className={cn('h-5 w-5 shrink-0', isCritical ? 'text-red-400' : 'text-amber-400')} />
          <div>
            <p className={cn('font-semibold text-sm', isCritical ? 'text-red-300' : 'text-amber-300')}>
              MM Health {isCritical ? 'Critical' : 'Warning'}
              {health.pauseBot && (
                <span className="ml-2 inline-flex items-center rounded-full bg-red-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-red-400">
                  BOT PAUSED
                </span>
              )}
            </p>
            <p className="text-xs text-admin-muted mt-0.5">
              {health.reasons.join(' · ') || 'Health check returned degraded state'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-admin-muted hover:text-admin-text"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button type="button" onClick={onDismiss} className="text-admin-muted hover:text-admin-text">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs font-mono border-t border-white/10 pt-3">
          <div>
            <p className="text-admin-muted">Settlement lag</p>
            <p className={cn('font-semibold', health.settlementLagSec > 3600 ? 'text-red-400' : 'text-admin-text')}>
              {fmtSec(health.settlementLagSec)}
            </p>
          </div>
          <div>
            <p className="text-admin-muted">Pending settlements</p>
            <p className={cn('font-semibold', health.pendingSettlementCount > 100 ? 'text-red-400' : 'text-admin-text')}>
              {health.pendingSettlementCount.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-admin-muted">Oracle max age</p>
            <p className="font-semibold text-admin-text">{fmtSec(health.oracleMaxAgeSec)}</p>
          </div>
          <div>
            <p className="text-admin-muted">Spread multiplier</p>
            <p className={cn('font-semibold', health.spreadMultiplier > 1 ? 'text-amber-400' : 'text-admin-text')}>
              {health.spreadMultiplier}×
            </p>
          </div>
          <div>
            <p className="text-admin-muted">External divergence</p>
            <p className="font-semibold text-admin-text">{health.externalMaxDivergenceBps.toFixed(2)} bps</p>
          </div>
          <div>
            <p className="text-admin-muted">Bot error rate</p>
            <p className={cn('font-semibold', health.botErrorRate > 0.1 ? 'text-red-400' : 'text-admin-text')}>
              {fmtPct(health.botErrorRate)}
            </p>
          </div>
          {health.quoteAgeSec != null && (
            <div>
              <p className="text-admin-muted">Quote age</p>
              <p className="font-semibold text-admin-text">{fmtSec(health.quoteAgeSec)}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Add Pair Modal ────────────────────────────────────────────────────────────

const DEFAULT_NEW_PAIR_CFG: MMPairRuntimeConfig = {
  enabled: true,
  spread_mode: 'auto',
  spread_bps: 15,
  order_size: 0.1,
  ladder_levels: 3,
  refresh_mode: 'normal',
  volatility_mode: 'medium',
  flow_mode: 'neutral',
};

function AddPairModal({
  open,
  onClose,
  onAdd,
  existingSymbols,
  envSymbols,
  token,
  adding,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (symbol: string, cfg: MMPairRuntimeConfig) => void;
  existingSymbols: string[];
  envSymbols: string[];
  token: string | null;
  adding: boolean;
}) {
  const [symbol, setSymbol] = useState('');
  const [cfg, setCfg] = useState<MMPairRuntimeConfig>({ ...DEFAULT_NEW_PAIR_CFG });
  const [search, setSearch] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const marketsQ = useQuery({
    queryKey: ['admin', 'trading', 'markets', token],
    queryFn: () => getTradingMarkets(token),
    enabled: !!token && open,
    staleTime: 60_000,
  });

  const allMarkets = useMemo(() => {
    return (marketsQ.data?.data?.markets ?? []).map((m) => m.symbol).sort();
  }, [marketsQ.data]);

  const filteredMarkets = useMemo(() => {
    const q = search.trim().toUpperCase();
    return allMarkets.filter((s) => !q || s.includes(q));
  }, [allMarkets, search]);

  const alreadyActive = symbol ? existingSymbols.includes(symbol.toUpperCase().replace(/-/g, '_')) : false;
  const isEnvPair = symbol ? envSymbols.includes(symbol.toUpperCase().replace(/-/g, '_')) : false;
  const canSubmit = !!symbol && !adding && confirmed;

  const handleClose = () => {
    setSymbol('');
    setCfg({ ...DEFAULT_NEW_PAIR_CFG });
    setSearch('');
    setConfirmed(false);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-admin-border bg-admin-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-admin-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-admin-text">Add New Pair to Market Making</h2>
            <p className="text-xs text-admin-muted mt-0.5">Select a trading market and configure initial MM parameters</p>
          </div>
          <button type="button" onClick={handleClose} className="text-admin-muted hover:text-admin-text">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Market selector */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-admin-muted">
              Trading Market
            </label>
            <input
              className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text placeholder-admin-muted focus:outline-none focus:ring-2 focus:ring-blue-500/40 mb-2"
              placeholder="Search markets…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="h-36 overflow-y-auto rounded-lg border border-admin-border bg-admin-surface">
              {marketsQ.isLoading ? (
                <div className="flex items-center justify-center h-full text-admin-muted text-xs">Loading markets…</div>
              ) : filteredMarkets.length === 0 ? (
                <div className="flex items-center justify-center h-full text-admin-muted text-xs">No markets found</div>
              ) : (
                filteredMarkets.map((s) => {
                  const isActive = existingSymbols.includes(s);
                  const isSelected = symbol === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => { setSymbol(s); setConfirmed(false); }}
                      className={cn(
                        'w-full flex items-center justify-between px-3 py-1.5 text-left text-sm transition-colors',
                        isSelected
                          ? 'bg-blue-600/20 text-blue-300 font-semibold'
                          : 'text-admin-text hover:bg-white/[0.04]'
                      )}
                    >
                      <span className="font-mono">{s}</span>
                      <div className="flex items-center gap-1.5">
                        {envSymbols.includes(s) && (
                          <span className="text-[10px] rounded-full bg-indigo-500/15 text-indigo-400 px-1.5 py-0.5 font-semibold">ENV</span>
                        )}
                        {isActive && (
                          <span className="text-[10px] rounded-full bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 font-semibold">ACTIVE</span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
            {symbol && (
              <p className="mt-1.5 text-xs text-admin-muted">
                Selected: <span className="font-mono font-semibold text-admin-text">{symbol}</span>
                {alreadyActive && <span className="ml-2 text-amber-400">⚠ Already active — this will update its config</span>}
                {isEnvPair && !alreadyActive && <span className="ml-2 text-indigo-400">• Env pair — override will be applied</span>}
              </p>
            )}
          </div>

          {/* Config */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-admin-muted">Spread (bps)</label>
              <input
                type="number"
                min={1} max={500}
                className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                value={cfg.spread_bps}
                onChange={(e) => setCfg({ ...cfg, spread_bps: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-admin-muted">Order size</label>
              <input
                type="number"
                min={0.000001}
                className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                value={cfg.order_size}
                onChange={(e) => setCfg({ ...cfg, order_size: Math.max(0.000001, Number(e.target.value) || 0.001) })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-admin-muted">Ladder levels</label>
              <input
                type="number"
                min={1} max={20}
                className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                value={cfg.ladder_levels}
                onChange={(e) => setCfg({ ...cfg, ladder_levels: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-admin-muted">Flow mode</label>
              <select
                className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:outline-none"
                value={cfg.flow_mode}
                onChange={(e) => setCfg({ ...cfg, flow_mode: e.target.value as MMPairRuntimeConfig['flow_mode'] })}
              >
                <option value="neutral">Neutral</option>
                <option value="aggressive">Aggressive</option>
                <option value="defensive">Defensive</option>
              </select>
            </div>
          </div>

          {/* Confirmation checkbox */}
          <label className="flex items-start gap-2.5 cursor-pointer rounded-lg border border-amber-500/25 bg-amber-950/20 p-3">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-admin-border"
            />
            <span className="text-xs text-amber-300/90">
              I confirm: this will start market making on <strong>{symbol || 'the selected pair'}</strong> with the above config. The bot will begin placing orders immediately.
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-3 border-t border-admin-border px-5 py-4">
          <button type="button" onClick={handleClose} className="rounded-lg border border-admin-border bg-admin-card px-4 py-2 text-sm text-admin-muted hover:text-admin-text transition-colors">
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => canSubmit && onAdd(symbol, cfg)}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {adding ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {alreadyActive ? 'Update pair' : 'Start market making'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Remove Pair Confirm Modal ─────────────────────────────────────────────────

function RemovePairModal({
  symbol,
  isEnvPair,
  onClose,
  onConfirm,
  busy,
}: {
  symbol: string | null;
  isEnvPair: boolean;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  const [typed, setTyped] = useState('');
  if (!symbol) return null;
  const isConfirmed = typed.trim().toUpperCase() === symbol.toUpperCase();

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-red-500/30 bg-admin-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-admin-border px-5 py-4">
          <h2 className="text-base font-semibold text-red-300">Remove Pair from Market Making</h2>
          <button type="button" onClick={onClose} className="text-admin-muted hover:text-admin-text"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="rounded-lg border border-admin-border/60 bg-white/[0.02] p-3 text-sm text-admin-text space-y-1">
            <p>Pair: <span className="font-mono font-bold">{symbol}</span></p>
            {isEnvPair ? (
              <p className="text-amber-400 text-xs">⚠ This is an env-defined pair. Removing the runtime override means the bot will continue with <strong>env defaults</strong>. To fully stop it, use "Pause Pair" instead.</p>
            ) : (
              <p className="text-red-400 text-xs">This runtime pair will be removed from memory and database. The bot will stop managing this market.</p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-admin-muted">
              Type <span className="font-mono font-bold text-admin-text">{symbol}</span> to confirm
            </label>
            <input
              className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm font-mono text-admin-text focus:outline-none focus:ring-2 focus:ring-red-500/40"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={symbol}
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-admin-border px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-admin-border px-4 py-2 text-sm text-admin-muted hover:text-admin-text">Cancel</button>
          <button
            type="button"
            disabled={!isConfirmed || busy}
            onClick={onConfirm}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Remove pair
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MmControlPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const { toast, show: showToast, dismiss: dismissToast } = useToast();

  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [sparkHistory, setSparkHistory] = useState<PairSparkHistory>({});
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(() => new Set());
  const [cancelMarket, setCancelMarket] = useState<string | null>(null);
  const [unwindMarket, setUnwindMarket] = useState<string | null>(null);
  const [healthDismissed, setHealthDismissed] = useState(false);
  const [showGlobalDetail, setShowGlobalDetail] = useState(false);

  // ── Queries ──────────────────────────────────────────────────────────────
  const statusQ = useQuery({
    queryKey: ['admin', 'mm-control', 'status', token],
    queryFn: () => getMmControlStatus(token),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const globalQ = useQuery({
    queryKey: ['admin', 'mm-control', 'global', token],
    queryFn: () => getMmControlGlobal(token),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const healthQ = useQuery({
    queryKey: ['admin', 'mm-health', token],
    queryFn: () => adminFetch<MmHealthData>('/monitoring/mm-health', { token }),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const riskQ = useQuery({
    queryKey: ['admin', 'mm-risk', token],
    queryFn: () => adminFetch<MmRiskData>('/monitoring/mm-risk', { token }),
    enabled: !!token,
    refetchInterval: 60_000,
  });

  const symbols = useMemo(() => {
    if (!isMmControlOk(statusQ.data)) return [];
    const u = statusQ.data.data.live.map((r) => r.symbol);
    return Array.from(new Set(u)).sort();
  }, [statusQ.data]);

  useEffect(() => {
    if (!selectedSymbol && symbols.length) setSelectedSymbol(symbols[0]!);
  }, [symbols, selectedSymbol]);

  const pairQ = useQuery({
    queryKey: ['admin', 'mm-control', 'pair', token, selectedSymbol],
    queryFn: () => getMmControlPair(token, selectedSymbol!),
    enabled: !!token && !!selectedSymbol,
  });

  const eliteQ = useQuery({
    queryKey: ['admin', 'mm-elite-profitability', token],
    queryFn: () => getMmEliteProfitability(token),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const circuitQ = useQuery({
    queryKey: ['admin', 'mm-circuit', token],
    queryFn: () => getMmCircuitState(token),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  // ── Draft state ───────────────────────────────────────────────────────────
  const [globalDraft, setGlobalDraft] = useState<MMGlobalRuntimeConfig | null>(null);
  useEffect(() => {
    if (isMmControlOk(globalQ.data)) setGlobalDraft(globalQ.data.data);
  }, [globalQ.data]);

  const [pairDraft, setPairDraft] = useState<MMPairRuntimeConfig | null>(null);
  useEffect(() => {
    if (isMmControlOk(pairQ.data)) setPairDraft(pairQ.data.data.config);
  }, [pairQ.data]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const invalidateMm = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'mm-control'] });
  }, [queryClient]);

  const saveGlobalM = useMutation({
    mutationFn: (body: Partial<MMGlobalRuntimeConfig>) => postMmControlGlobal(token, body),
    onSuccess: () => { invalidateMm(); showToast('success', 'Global config saved.'); },
    onError: () => showToast('error', 'Failed to save global config.'),
  });

  const savePairM = useMutation({
    mutationFn: ({ sym, body }: { sym: string; body: Partial<MMPairRuntimeConfig> }) =>
      postMmControlPair(token, sym, body),
    onSuccess: () => { invalidateMm(); showToast('success', `${savePairM.variables?.sym ?? 'Pair'} config saved.`); },
    onError: () => showToast('error', 'Failed to save pair config.'),
  });

  const pairQuickM = useMutation({
    mutationFn: ({ sym, body }: { sym: string; body: Partial<MMPairRuntimeConfig> }) =>
      postMmControlPair(token, sym, body),
    onSuccess: (_, vars) => { invalidateMm(); showToast('success', `${vars.sym} updated.`); },
    onError: () => showToast('error', 'Quick update failed.'),
  });

  const requoteM = useMutation({
    mutationFn: (sym: string) => postMmControlPair(token, sym, { refresh_mode: 'fast' }),
    onSuccess: (_, sym) => { invalidateMm(); showToast('success', `Force re-quote sent for ${sym}.`); },
    onError: () => showToast('error', 'Re-quote failed.'),
  });

  const cancelAllM = useMutation({
    mutationFn: (sym: string) => postAdminCancelAllOrders(token, sym),
    onSuccess: (_, sym) => {
      invalidateMm();
      void queryClient.invalidateQueries({ queryKey: ['admin', 'mm-desk-orderbook'] });
      setCancelMarket(null);
      showToast('success', `All orders on ${sym} cancelled.`);
    },
    onError: () => { setCancelMarket(null); showToast('error', 'Cancel orders failed.'); },
  });

  const restartBotM = useMutation({
    mutationFn: () =>
      adminFetch<{ command: string; triggered: boolean }>('/control/commands', {
        method: 'POST',
        body: { command: 'restart_liquidity_bot' },
        token,
      }),
    onSuccess: () => { invalidateMm(); showToast('success', 'Liquidity bot restart triggered.'); },
    onError: () => showToast('error', 'Bot restart failed — check permissions.'),
  });

  // ── Add / Remove pair ─────────────────────────────────────────────────────
  const [showAddPair, setShowAddPair] = useState(false);
  const [removePairTarget, setRemovePairTarget] = useState<string | null>(null);

  const addPairM = useMutation({
    mutationFn: ({ sym, cfg }: { sym: string; cfg: MMPairRuntimeConfig }) =>
      postMmControlPair(token, sym, cfg),
    onSuccess: (_, vars) => {
      invalidateMm();
      setShowAddPair(false);
      showToast('success', `Market making started for ${vars.sym}.`);
      setSelectedSymbol(vars.sym);
    },
    onError: () => showToast('error', 'Failed to add pair. Check that the market exists.'),
  });

  const removePairM = useMutation({
    mutationFn: (sym: string) => deleteMmControlPair(token, sym),
    onSuccess: (data, sym) => {
      invalidateMm();
      setRemovePairTarget(null);
      const note = (data as { data?: { note?: string } })?.data?.note ?? 'Pair removed.';
      showToast('success', note);
      if (selectedSymbol === sym) setSelectedSymbol(null);
    },
    onError: () => { setRemovePairTarget(null); showToast('error', 'Failed to remove pair.'); },
  });

  // Env symbols (from backend status - these are defined in LIQUIDITY_BOT_SYMBOLS)
  const envSymbols = useMemo(() => {
    if (!isMmControlOk(statusQ.data)) return [];
    return (statusQ.data.data.live ?? [])
      .filter((r) => r.is_env_pair)
      .map((r) => r.symbol);
  }, [statusQ.data]);

  const refresh = useCallback(() => {
    invalidateMm();
    void healthQ.refetch();
    void riskQ.refetch();
  }, [invalidateMm, healthQ, riskQ]);

  // ── Derived data ──────────────────────────────────────────────────────────
  const statusData = isMmControlOk(statusQ.data) ? statusQ.data.data : null;
  const healthData = healthQ.data?.success ? healthQ.data.data : null;
  const riskData = riskQ.data?.success ? riskQ.data.data : null;
  const circuitState = circuitQ.data?.data as (ReturnType<typeof getMmCircuitState> extends Promise<infer R> ? R : never)['data'] & {
    dailyPnlUsd?: number | null;
    maxDailyLossUsd?: number;
    emergencyStop?: boolean;
    autoManaged?: boolean;
  } | undefined;

  const globalBusy =
    saveGlobalM.isPending ||
    pairQuickM.isPending ||
    savePairM.isPending ||
    cancelAllM.isPending ||
    requoteM.isPending ||
    restartBotM.isPending;
  const pendingPairSym = pairQuickM.isPending ? (pairQuickM.variables?.sym ?? null) : null;
  const forceRequoteSymbol = requoteM.isPending ? (requoteM.variables ?? null) : null;

  const eliteBySymbol = useMemo(() => {
    const sym = eliteQ.data?.data?.symbols;
    if (!sym || typeof sym !== 'object') return {};
    const out: Record<string, ReturnType<typeof parseEliteSymbolMetrics>> = {};
    for (const k of Object.keys(sym as Record<string, unknown>)) {
      out[k] = parseEliteSymbolMetrics((sym as Record<string, unknown>)[k]);
    }
    return out;
  }, [eliteQ.data]);

  const pairForStrip = isMmControlOk(pairQ.data) ? pairQ.data.data.config : undefined;

  const onAlertFix = useCallback(
    (_alertId: string, fixId: DeskAlertFixId) => {
      if (fixId === 'enable_mm_runtime') saveGlobalM.mutate({ enabled: true });
      if (fixId === 'safe_desk_mode') saveGlobalM.mutate({ mode: 'safe' });
    },
    [saveGlobalM]
  );

  useEffect(() => {
    if (!statusData) return;
    setSparkHistory((prev) => {
      const next = { ...prev };
      for (const row of statusData.live) {
        const p = row.pnl1hUsd ?? 0;
        const f = row.fill_rate ?? 0;
        const cur = next[row.symbol] ?? { pnl: [], fill: [] };
        next[row.symbol] = {
          pnl: [...cur.pnl, p].slice(-SPARK_MAX_POINTS),
          fill: [...cur.fill, f].slice(-SPARK_MAX_POINTS),
        };
      }
      return next;
    });
  }, [statusQ.dataUpdatedAt, statusData]);

  const deskAlerts = useMemo(
    () => buildDeskAlerts(statusData, globalDraft),
    [statusData, globalDraft]
  );

  const scrollToPairSettings = useCallback(() => {
    requestAnimationFrame(() => {
      document.getElementById('mm-pair-settings-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const handleConfigure = useCallback(
    (sym: string) => {
      setSelectedSymbol(sym);
      scrollToPairSettings();
    },
    [scrollToPairSettings]
  );

  // Derived KPIs
  const totalOpenOrders = statusData?.live.reduce((s, r) => s + r.openOrders, 0) ?? null;
  const totalPositionUsd = statusData?.live.reduce((s, r) => s + Number(r.positionUsd ?? 0), 0) ?? null;
  const pnlToday = statusData?.daily_target_progress?.pnl_today_usd ?? null;
  const pnlProgress = statusData?.daily_target_progress?.progress ?? null;
  const targetUsd = statusData?.daily_target_progress?.target_usd ?? null;
  const anyToxic = statusData?.live.some((r) => r.toxic_flow) ?? false;
  const circuitActive = circuitState && (circuitState.tradingPaused || circuitState.orderPlacementBlocked);

  const mmPageStatus: AdminPageStatus = !isMmControlOk(statusQ.data) || circuitActive
    ? 'risk'
    : globalDraft?.enabled === false
    ? 'warning'
    : 'active';

  // Selected symbol elite data for env card
  const selectedElite = selectedSymbol ? eliteBySymbol[selectedSymbol] : null;

  return (
    <AdminPageFrame
      title="Market Making Desk"
      description="Live snapshot, per-market controls, and grouped configuration for the automated MM system."
      status={mmPageStatus}
      className="!p-0"
    >
      <div className="mx-auto max-w-[1600px] space-y-4 p-6">

        {/* ── MM Health Banner ── */}
        {healthData && !healthDismissed && healthData.level !== 'ok' && (
          <MmHealthBanner health={healthData} onDismiss={() => setHealthDismissed(true)} />
        )}

        {/* ── Alert Banner ── */}
        <MmDeskAlertBanner
          alerts={deskAlerts}
          dismissed={dismissedAlerts}
          onDismiss={(id) => setDismissedAlerts((prev) => new Set(prev).add(id))}
          onAlertFix={onAlertFix}
          fixBusy={saveGlobalM.isPending}
        />

        {/* ── Circuit Breaker Alert ── */}
        {circuitState && (circuitState.tradingPaused || circuitState.orderPlacementBlocked) && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-500/40 bg-red-950/30 p-4">
            <CircuitBoard className="h-5 w-5 text-red-400 shrink-0" />
            <span className="text-sm font-semibold text-red-300">MM Circuit Breaker Active</span>
            {circuitState.tradingPaused && (
              <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-400">Trading Paused</span>
            )}
            {circuitState.orderPlacementBlocked && (
              <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-400">Orders Blocked</span>
            )}
            {circuitState.emergencyStop && (
              <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-400">Emergency Stop</span>
            )}
            {(circuitState as { reason?: string }).reason && (
              <span className="text-xs text-admin-muted">Reason: {(circuitState as { reason?: string }).reason}</span>
            )}
          </div>
        )}

        {/* ── Status Bar ── */}
        <MmDeskStatusBar
          status={statusData}
          globalDraft={globalDraft}
          onRefresh={refresh}
          onStopAll={() => saveGlobalM.mutate({ enabled: false })}
          onSafeMode={() => saveGlobalM.mutate({ mode: 'safe' })}
          onResetDesk={() => saveGlobalM.mutate({ enabled: true, mode: 'normal' })}
          onSetMode={(mode) => saveGlobalM.mutate({ mode })}
          globalBusy={globalBusy}
        />

        {/* ── Override Strip ── */}
        <MmDeskOverrideStrip
          global={globalDraft}
          pair={pairForStrip}
          symbol={selectedSymbol}
        />

        {/* ── KPI Strip ── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* Open Orders */}
          <div className={cn(
            'relative rounded-xl border bg-admin-card p-4 overflow-hidden transition-colors',
            'border-blue-500/20'
          )}>
            <div className="absolute inset-x-0 top-0 h-0.5 rounded-t-xl bg-gradient-to-r from-blue-500/60 to-blue-500/0" />
            <div className="flex items-start justify-between mb-3">
              <span className="text-xs font-medium text-admin-muted">Open Orders</span>
              <div className="rounded-lg bg-blue-500/10 p-1.5"><Activity className="h-3.5 w-3.5 text-blue-400" /></div>
            </div>
            {statusQ.isLoading ? (
              <Skeleton className="h-7 w-20 mb-1" />
            ) : (
              <p className="text-2xl font-bold text-admin-text">{totalOpenOrders != null ? totalOpenOrders.toLocaleString() : '—'}</p>
            )}
            <p className="mt-1 text-xs text-admin-muted">{symbols.length} active pair{symbols.length !== 1 ? 's' : ''}</p>
          </div>

          {/* Total Position */}
          <div className={cn(
            'relative rounded-xl border bg-admin-card p-4 overflow-hidden transition-colors',
            anyToxic ? 'border-amber-500/30' : 'border-emerald-500/20'
          )}>
            <div className={cn('absolute inset-x-0 top-0 h-0.5 rounded-t-xl bg-gradient-to-r', anyToxic ? 'from-amber-500/60 to-amber-500/0' : 'from-emerald-500/60 to-emerald-500/0')} />
            <div className="flex items-start justify-between mb-3">
              <span className="text-xs font-medium text-admin-muted">Total Position</span>
              <div className={cn('rounded-lg p-1.5', anyToxic ? 'bg-amber-500/10' : 'bg-emerald-500/10')}>
                <BarChart3 className={cn('h-3.5 w-3.5', anyToxic ? 'text-amber-400' : 'text-emerald-400')} />
              </div>
            </div>
            {statusQ.isLoading ? (
              <Skeleton className="h-7 w-28 mb-1" />
            ) : (
              <p className="text-2xl font-bold text-admin-text">{totalPositionUsd != null ? fmtUsd(totalPositionUsd) : '—'}</p>
            )}
            {anyToxic ? (
              <p className="mt-1 text-xs text-amber-400 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Toxic flow detected</p>
            ) : (
              <p className="mt-1 text-xs text-admin-muted">No toxic flow</p>
            )}
          </div>

          {/* PnL Today */}
          <div className={cn(
            'relative rounded-xl border bg-admin-card p-4 overflow-hidden transition-colors',
            pnlToday != null && pnlToday < 0 ? 'border-red-500/25' : 'border-emerald-500/20'
          )}>
            <div className={cn('absolute inset-x-0 top-0 h-0.5 rounded-t-xl bg-gradient-to-r', pnlToday != null && pnlToday < 0 ? 'from-red-500/60 to-red-500/0' : 'from-emerald-500/60 to-emerald-500/0')} />
            <div className="flex items-start justify-between mb-3">
              <span className="text-xs font-medium text-admin-muted">PnL Today</span>
              <div className={cn('rounded-lg p-1.5', pnlToday != null && pnlToday < 0 ? 'bg-red-500/10' : 'bg-emerald-500/10')}>
                {pnlToday != null && pnlToday < 0 ? <TrendingDown className="h-3.5 w-3.5 text-red-400" /> : <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />}
              </div>
            </div>
            {statusQ.isLoading ? (
              <Skeleton className="h-7 w-24 mb-1" />
            ) : (
              <p className={cn('text-2xl font-bold', pnlToday != null && pnlToday < 0 ? 'text-red-400' : 'text-admin-text')}>
                {pnlToday != null ? fmtUsd(pnlToday) : '—'}
              </p>
            )}
            {pnlProgress != null && targetUsd != null ? (
              <div className="mt-1.5">
                <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                  <div className={cn('h-full rounded-full transition-all', pnlToday != null && pnlToday < 0 ? 'bg-red-500' : 'bg-emerald-500')}
                    style={{ width: `${Math.min(100, pnlProgress * 100)}%` }} />
                </div>
                <p className="mt-0.5 text-[10px] text-admin-muted">{(pnlProgress * 100).toFixed(0)}% of {fmtUsd(targetUsd)} target</p>
              </div>
            ) : (
              <p className="mt-1 text-xs text-admin-muted">No target set</p>
            )}
          </div>

          {/* Engine Health */}
          <div className={cn(
            'relative rounded-xl border bg-admin-card p-4 overflow-hidden transition-colors',
            healthData?.level === 'ok' ? 'border-emerald-500/20' :
            healthData?.level === 'warning' ? 'border-amber-500/30' :
            'border-red-500/30'
          )}>
            <div className={cn('absolute inset-x-0 top-0 h-0.5 rounded-t-xl bg-gradient-to-r',
              healthData?.level === 'ok' ? 'from-emerald-500/60 to-emerald-500/0' :
              healthData?.level === 'warning' ? 'from-amber-500/60 to-amber-500/0' :
              'from-red-500/60 to-red-500/0'
            )} />
            <div className="flex items-start justify-between mb-3">
              <span className="text-xs font-medium text-admin-muted">Engine Health</span>
              <div className={cn('rounded-lg p-1.5',
                healthData?.level === 'ok' ? 'bg-emerald-500/10' :
                healthData?.level === 'warning' ? 'bg-amber-500/10' : 'bg-red-500/10'
              )}>
                {healthData?.level === 'ok'
                  ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                  : <ShieldAlert className={cn('h-3.5 w-3.5', healthData?.level === 'warning' ? 'text-amber-400' : 'text-red-400')} />}
              </div>
            </div>
            {healthQ.isLoading ? (
              <Skeleton className="h-7 w-20 mb-1" />
            ) : (
              <p className={cn('text-2xl font-bold',
                healthData?.level === 'ok' ? 'text-emerald-400' :
                healthData?.level === 'warning' ? 'text-amber-400' : 'text-red-400'
              )}>
                {healthData ? healthData.level.toUpperCase() : '—'}
              </p>
            )}
            {healthData?.pauseBot
              ? <p className="mt-1 text-xs text-red-400">Bot paused by health check</p>
              : <p className="mt-1 text-xs text-emerald-400/80">Running normally</p>
            }
          </div>
        </div>

        {/* ── Global Runtime + Desk Status ── */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3 border-b border-admin-border/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className={cn('h-2 w-2 rounded-full', globalDraft?.enabled ? 'bg-emerald-400 animate-pulse' : 'bg-red-400')} />
                  <CardTitle>Global Runtime Config</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => restartBotM.mutate()}
                    disabled={globalBusy}
                    className="gap-1.5 text-xs"
                  >
                    <RotateCcw className={cn('h-3.5 w-3.5', restartBotM.isPending && 'animate-spin')} />
                    Restart Bot
                  </Button>
                  <button
                    type="button"
                    onClick={() => setShowGlobalDetail((v) => !v)}
                    className="rounded-md border border-admin-border/50 p-1 text-admin-muted hover:text-admin-text hover:bg-white/[0.04] transition-colors"
                  >
                    {showGlobalDetail ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {!globalDraft ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <>
                  {/* Enable toggle */}
                  <div className="flex items-center justify-between rounded-lg border border-admin-border bg-white/[0.02] px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        'h-2.5 w-2.5 rounded-full',
                        globalDraft.enabled ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'
                      )} />
                      <span className="text-sm font-medium text-admin-text">
                        MM enabled (runtime)
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={globalDraft.enabled ? 'success' : 'warning'}>
                        {globalDraft.enabled ? 'ON' : 'OFF'}
                      </Badge>
                      <label className="relative inline-flex cursor-pointer items-center">
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={globalDraft.enabled}
                          onChange={(e) => setGlobalDraft({ ...globalDraft, enabled: e.target.checked })}
                        />
                        <div className={cn(
                          'h-5 w-9 rounded-full transition-colors',
                          globalDraft.enabled ? 'bg-emerald-500' : 'bg-white/20'
                        )}>
                          <div className={cn(
                            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                            globalDraft.enabled ? 'translate-x-4' : 'translate-x-0.5'
                          )} />
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* Mode + target in one row */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-admin-muted">Desk mode</label>
                      <select
                        className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                        value={globalDraft.mode}
                        onChange={(e) =>
                          setGlobalDraft({
                            ...globalDraft,
                            mode: e.target.value as MMGlobalRuntimeConfig['mode'],
                          })
                        }
                      >
                        <option value="safe">Safe — wider spreads, reduced risk</option>
                        <option value="normal">Normal — balanced operation</option>
                        <option value="aggressive">Aggressive — tighter spreads</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-admin-muted">Daily profit target (USD)</label>
                      <Input
                        type="number"
                        placeholder="Default 200"
                        value={globalDraft.daily_target_usd ?? ''}
                        onChange={(e) =>
                          setGlobalDraft({
                            ...globalDraft,
                            daily_target_usd: e.target.value === '' ? undefined : Number(e.target.value),
                          })
                        }
                      />
                    </div>
                  </div>

                  {/* Optional advanced fields */}
                  {showGlobalDetail && (
                    <div className="grid grid-cols-2 gap-3 rounded-lg border border-admin-border/60 bg-white/[0.02] p-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-admin-muted">Max position USD</label>
                        <Input
                          type="number"
                          placeholder="Env default"
                          value={globalDraft.max_position_usd ?? ''}
                          onChange={(e) =>
                            setGlobalDraft({
                              ...globalDraft,
                              max_position_usd: e.target.value === '' ? undefined : Number(e.target.value),
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-admin-muted">Max daily loss USD</label>
                        <Input
                          type="number"
                          placeholder="Env default"
                          value={globalDraft.max_daily_loss_usd ?? ''}
                          onChange={(e) =>
                            setGlobalDraft({
                              ...globalDraft,
                              max_daily_loss_usd: e.target.value === '' ? undefined : Number(e.target.value),
                            })
                          }
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <ProtectedAction permission="mm:control" fallback="disabled">
                      <Button
                        onClick={() => saveGlobalM.mutate(globalDraft)}
                        disabled={saveGlobalM.isPending}
                        className="gap-1.5"
                      >
                        {saveGlobalM.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
                        Save global
                      </Button>
                    </ProtectedAction>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* ── Unified Desk Status sidebar ── */}
          <Card className="flex flex-col">
            {/* Section 1: Environment */}
            <div className="border-b border-admin-border/60 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted mb-2.5">Environment</p>
              {statusData ? (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-admin-muted">Bot status</span>
                    <Badge variant={statusData.bot.enabled ? 'success' : 'default'}>
                      {statusData.bot.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 divide-x divide-admin-border/40 rounded-lg border border-admin-border/50 bg-white/[0.015]">
                    <div className="py-2 text-center">
                      <p className="text-[9px] uppercase tracking-wide text-admin-muted mb-0.5">Spread</p>
                      <p className="font-mono text-sm font-bold text-admin-text">{statusData.bot.envSpreadBps}<span className="text-[9px] text-admin-muted font-normal"> bps</span></p>
                    </div>
                    <div className="py-2 text-center">
                      <p className="text-[9px] uppercase tracking-wide text-admin-muted mb-0.5">Size</p>
                      <p className="font-mono text-sm font-bold text-admin-text">{String(statusData.bot.envOrderSize)}</p>
                    </div>
                    <div className="py-2 text-center">
                      <p className="text-[9px] uppercase tracking-wide text-admin-muted mb-0.5">Ladder</p>
                      <p className="font-mono text-sm font-bold text-admin-text">L{statusData.bot.envLadderLevels}</p>
                    </div>
                  </div>
                  {selectedElite && (
                    <div className="rounded-lg border border-admin-border/50 bg-white/[0.015] p-2.5 space-y-1.5">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-admin-muted">{selectedSymbol} · Oracle</p>
                      {[
                        ['Oracle mid', selectedElite.oracleMid != null ? selectedElite.oracleMid.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—', ''],
                        ['Benchmark (1h)', selectedElite.benchmarkPrice1h != null ? selectedElite.benchmarkPrice1h.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—', ''],
                        ['MTM unrealized', selectedElite.unrealizedVsBenchmarkQuote != null ? fmtUsd(selectedElite.unrealizedVsBenchmarkQuote) : '—',
                          selectedElite.unrealizedVsBenchmarkQuote != null && selectedElite.unrealizedVsBenchmarkQuote < 0 ? 'text-red-400' : 'text-emerald-400'],
                        ['Inventory (base)', selectedElite.inventoryBase != null ? selectedElite.inventoryBase.toFixed(4) : '—', ''],
                      ].map(([label, val, cls]) => (
                        <div key={label as string} className="flex items-center justify-between">
                          <span className="text-[10px] text-admin-muted">{label as string}</span>
                          <span className={cn('font-mono text-[10px] text-admin-text', cls as string)}>{val as string}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {statusData.daily_target_progress && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-admin-muted flex items-center gap-1"><Target className="h-3 w-3" /> Daily target</span>
                        <span className="font-mono text-[10px] font-semibold text-admin-text">{(statusData.daily_target_progress.progress * 100).toFixed(0)}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, statusData.daily_target_progress.progress * 100)}%` }} />
                      </div>
                      <p className="mt-1 text-[10px] text-admin-muted">{fmtUsd(statusData.daily_target_progress.pnl_today_usd)} / {fmtUsd(statusData.daily_target_progress.target_usd)}</p>
                    </div>
                  )}
                </div>
              ) : <Skeleton className="h-24 w-full" />}
            </div>

            {/* Section 2: Circuit Breaker */}
            <div className="border-b border-admin-border/60 px-4 py-3">
              <div className="flex items-center gap-1.5 mb-2.5">
                <CircuitBoard className="h-3.5 w-3.5 text-admin-muted" />
                <p className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">Circuit Breaker</p>
                {circuitState && (circuitState.tradingPaused || circuitState.emergencyStop) && (
                  <span className="ml-auto inline-flex h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
                )}
              </div>
              {circuitQ.isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : circuitState ? (
                <div className="space-y-1.5 text-xs">
                  {[
                    { label: 'Trading', active: !!circuitState.tradingPaused, on: 'Paused', off: 'Active', danger: true },
                    { label: 'Order placement', active: !!circuitState.orderPlacementBlocked, on: 'Blocked', off: 'Open', danger: true },
                    { label: 'Emergency stop', active: !!circuitState.emergencyStop, on: 'Active', off: 'Clear', danger: true },
                    { label: 'Auto-managed', active: !!circuitState.autoManaged, on: 'Yes', off: 'Manual', danger: false },
                  ].map(({ label, active, on, off, danger }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-admin-muted">{label}</span>
                      <span className={cn('font-medium text-[11px]', active && danger ? 'text-red-400' : active ? 'text-blue-400' : 'text-emerald-400')}>
                        {active ? on : off}
                      </span>
                    </div>
                  ))}
                  {(circuitState.dailyPnlUsd != null || circuitState.maxDailyLossUsd != null) && (
                    <div className="mt-1.5 pt-1.5 border-t border-admin-border/40 grid grid-cols-2 gap-1.5">
                      {circuitState.dailyPnlUsd != null && (
                        <div className="rounded border border-admin-border/40 bg-white/[0.015] px-2 py-1.5 text-center">
                          <p className="text-[9px] text-admin-muted mb-0.5">Daily PnL</p>
                          <p className={cn('font-mono text-xs font-bold', circuitState.dailyPnlUsd < 0 ? 'text-red-400' : 'text-emerald-400')}>{fmtUsd(circuitState.dailyPnlUsd)}</p>
                        </div>
                      )}
                      {circuitState.maxDailyLossUsd != null && (
                        <div className="rounded border border-admin-border/40 bg-white/[0.015] px-2 py-1.5 text-center">
                          <p className="text-[9px] text-admin-muted mb-0.5">Loss limit</p>
                          <p className="font-mono text-xs font-bold text-red-400/80">{fmtUsd(circuitState.maxDailyLossUsd)}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : <p className="text-xs text-admin-muted">Circuit state unavailable.</p>}
            </div>

            {/* Section 3: Risk Summary */}
            <div className="px-4 py-3 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted mb-2.5">Risk Summary</p>
              {riskQ.isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : riskData ? (
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'API keys', value: String(riskData.apiKeysCount), alert: false },
                    { label: 'Users w/ keys', value: String(riskData.usersWithKeys.length), alert: false },
                    { label: 'Emergency stops', value: String(riskData.emergencyStoppedUsers.length), alert: riskData.emergencyStoppedUsers.length > 0 },
                    { label: 'Inv. imbalances', value: String(riskData.inventoryImbalance.length), alert: riskData.inventoryImbalance.length > 0 },
                  ].map(({ label, value, alert }) => (
                    <div key={label} className="rounded-lg border border-admin-border/40 bg-white/[0.015] px-2.5 py-2 text-center">
                      <p className="text-[9px] uppercase tracking-wide text-admin-muted mb-0.5">{label}</p>
                      <p className={cn('font-mono text-sm font-bold', alert ? (label.includes('Emergency') ? 'text-red-400' : 'text-amber-400') : 'text-admin-text')}>{value}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-admin-muted">Risk data unavailable.</p>
              )}
            </div>
          </Card>
        </div>

        {/* ── Markets table ── */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <CardTitle>Markets</CardTitle>
                <p className="text-xs text-admin-muted">
                  <span className="inline-block w-2 h-2 rounded-full bg-indigo-400 mr-1" />ENV pairs persist across restarts.
                  <span className="inline-block w-2 h-2 rounded-full bg-blue-400 mx-1 ml-2" />RUNTIME pairs live in memory + DB.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {statusQ.isFetching && !statusQ.isLoading && (
                  <span className="flex items-center gap-1 text-[10px] text-admin-muted">
                    <RefreshCw className="h-3 w-3 animate-spin" /> Refreshing
                  </span>
                )}
                <Badge variant={statusData ? 'success' : 'warning'}>
                  {statusData?.live.length ?? 0} pairs
                </Badge>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setShowAddPair(true)}
                  disabled={globalBusy}
                  className="flex items-center gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add pair
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {statusQ.isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : statusData ? (
              <>
                <MmPairTable
                  status={statusData}
                  selectedSymbol={selectedSymbol}
                  globalEnabled={globalDraft?.enabled ?? false}
                  globalMaxPositionUsd={globalDraft?.max_position_usd}
                  sparkHistory={sparkHistory}
                  eliteBySymbol={eliteBySymbol}
                  onSelect={setSelectedSymbol}
                  onPairToggle={(sym, enabled) => pairQuickM.mutate({ sym, body: { enabled } })}
                  onConfigure={handleConfigure}
                  onResetPair={(sym) => {
                    pairQuickM.mutate({ sym, body: defaultPairResetBody(statusData.bot) });
                  }}
                  onForceRequote={(sym) => requoteM.mutate(sym)}
                  onRequestCancelAll={(sym) => setCancelMarket(sym)}
                  onRequestUnwind={(sym) => setUnwindMarket(sym)}
                  pendingSymbol={pendingPairSym}
                  forceRequoteSymbol={forceRequoteSymbol}
                />
                {/* Manage pairs footer */}
                {statusData.live.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-admin-border/40 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 text-[10px] text-admin-muted">
                      <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-400" />ENV — persists via environment</span>
                      <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" />Runtime — saved to DB</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {statusData.live.map((row) => {
                        const isEnv = row.is_env_pair ?? false;
                        return (
                          <button
                            key={row.symbol}
                            type="button"
                            onClick={() => setRemovePairTarget(row.symbol)}
                            disabled={removePairM.isPending}
                            title={isEnv ? 'Remove runtime override (env defaults will remain)' : 'Remove pair from MM'}
                            className={cn(
                              'group flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-mono font-semibold transition-all',
                              isEnv
                                ? 'border-indigo-500/25 bg-indigo-950/15 text-indigo-300 hover:border-indigo-500/50 hover:bg-indigo-950/30'
                                : 'border-admin-border/50 bg-white/[0.02] text-admin-muted hover:border-red-500/40 hover:text-red-300 hover:bg-red-950/10'
                            )}
                          >
                            <span className={cn('w-1.5 h-1.5 rounded-full', isEnv ? 'bg-indigo-400' : 'bg-blue-400')} />
                            {row.symbol}
                            <Trash2 className="h-2.5 w-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-admin-muted">Unable to load desk snapshot.</p>
            )}
          </CardContent>
        </Card>

        {/* ── Per-symbol detail panels ── */}
        <div>
          {selectedSymbol && (
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">Configuring</span>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-blue-500/25 bg-blue-950/20 px-2.5 py-1 text-xs font-mono font-semibold text-blue-300">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                {selectedSymbol}
              </span>
              <span className="text-[10px] text-admin-muted">— select a different pair in the Markets table above</span>
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-3">
            <MmPairSettingsPanel
              symbol={selectedSymbol}
              draft={pairDraft}
              onChange={setPairDraft}
              onSave={() => selectedSymbol && pairDraft && savePairM.mutate({ sym: selectedSymbol, body: pairDraft })}
              saving={savePairM.isPending}
              saveError={savePairM.isError}
            />
            <div className="space-y-4">
              <MmExecutionDepthPanel token={token} symbol={selectedSymbol} />
              <MmLiveMetricsPanel status={statusData} symbol={selectedSymbol} />
            </div>
            <MmIntelligencePanel status={statusData} global={globalDraft} symbol={selectedSymbol} />
          </div>
        </div>

      </div>

      {/* ── Add Pair Modal ── */}
      <AddPairModal
        open={showAddPair}
        onClose={() => setShowAddPair(false)}
        onAdd={(sym, cfg) => addPairM.mutate({ sym, cfg })}
        existingSymbols={symbols}
        envSymbols={envSymbols}
        token={token}
        adding={addPairM.isPending}
      />

      {/* ── Remove Pair Modal ── */}
      <RemovePairModal
        symbol={removePairTarget}
        isEnvPair={removePairTarget ? envSymbols.includes(removePairTarget) : false}
        onClose={() => setRemovePairTarget(null)}
        onConfirm={() => removePairTarget && removePairM.mutate(removePairTarget)}
        busy={removePairM.isPending}
      />

      {/* ── Cancel All Modal ── */}
      <SafeActionModal
        open={!!cancelMarket}
        onClose={() => setCancelMarket(null)}
        title="Cancel all orders on market"
        description={cancelMarket ? `Cancels every open order on ${cancelMarket} for all users.` : ''}
        impactWarning="Emergency control. Expect liquidity gaps and user-visible cancels. Reconcile risk before re-enabling quoting."
        confirmWord="CANCEL ALL"
        severity="destructive"
        confirmLabel="Cancel all orders"
        onConfirm={async () => {
          if (cancelMarket) await cancelAllM.mutateAsync(cancelMarket);
        }}
      />

      {/* ── Unwind Modal ── */}
      <Modal open={!!unwindMarket} onClose={() => setUnwindMarket(null)} title="Force unwind checklist" size="md">
        <p className="text-sm text-admin-muted">
          There is no dedicated unwind API. Use the checklist below with spot / treasury tools as needed.
        </p>
        {unwindMarket && (
          <p className="mt-2 font-mono text-sm text-admin-text">
            Market: <span className="text-admin-accent">{unwindMarket}</span>
          </p>
        )}
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-admin-text">
          <li>Pause the pair or switch flow to defensive; optionally set desk Safe mode.</li>
          <li>Cancel resting liquidity if required (per-market cancel-all — with confirmation).</li>
          <li>Flatten base exposure via manual spot trades or internal transfer — operator discretion.</li>
        </ul>
        <div className="mt-5 flex justify-end">
          <Button type="button" variant="secondary" onClick={() => setUnwindMarket(null)}>Close</Button>
        </div>
      </Modal>

      {/* ── Toast ── */}
      {toast && <Toast type={toast.type} msg={toast.msg} onClose={dismissToast} />}
    </AdminPageFrame>
  );
}

// ── Helper UI ─────────────────────────────────────────────────────────────────

function StatusRow({
  label,
  active,
  activeLabel,
  okLabel,
  danger,
}: {
  label: string;
  active: boolean;
  activeLabel: string;
  okLabel: string;
  danger?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5">
      <span className="text-admin-muted">{label}</span>
      <span
        className={cn(
          'font-semibold',
          active
            ? danger ? 'text-red-400' : 'text-amber-400'
            : 'text-emerald-400'
        )}
      >
        {active ? activeLabel : okLabel}
      </span>
    </div>
  );
}
