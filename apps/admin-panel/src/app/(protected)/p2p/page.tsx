'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Copy,
  DollarSign,
  Gavel,
  Lock,
  Megaphone,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Store,
  Unlock,
  Users,
  X,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, Tabs, Modal, ModalFooter, Textarea } from '@/components/ui';
import { useAdminAuthStore, hasAdminPermission } from '@/store/auth';
import {
  getP2pOverview, getP2pOrders, getP2pDisputes, getP2pAds,
  resolveP2pDispute, getP2pMerchants, reviewP2pMerchant,
  getP2pEscrows, freezeEscrow, unfreezeEscrow, freezeP2pUser,
} from '@/lib/admin';
import { cn } from '@/lib/cn';
import { useAdminWs } from '@/hooks/useAdminWs';
import { AdminPageFrame, type AdminPageStatus } from '@/components/admin-shell/AdminPageFrame';
import { ProtectedAction } from '@/components/rbac/ProtectedAction';

const REFETCH_MS = 30_000;
const PAGE_SIZE = 20;
type TabId = 'orders' | 'disputes' | 'ads' | 'merchants' | 'escrows';
type DisputeRow = Record<string, unknown>;
type MerchantRow = Record<string, unknown>;
type EscrowRow = Record<string, unknown>;

function n(v: unknown): number {
  const x = Number(v);
  return v != null && Number.isFinite(x) ? x : 0;
}
function str(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v || '—';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '—';
}
function formatDt(v: unknown): string {
  const d = v == null ? NaN : new Date(v as string).getTime();
  return Number.isNaN(d) ? '—' : new Date(d).toLocaleString();
}
function formatDtShort(v: unknown): string {
  const d = v == null ? NaN : new Date(v as string).getTime();
  if (Number.isNaN(d)) return '—';
  const now = Date.now();
  const diff = now - d;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(d).toLocaleDateString();
}
function statusVar(s: string): 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary' {
  const x = s.toLowerCase();
  if (['completed', 'resolved', 'active'].includes(x)) return 'success';
  if (['open', 'under_review', 'pending', 'payment_pending', 'awaiting_payment', 'payment_sent'].includes(x)) return 'warning';
  if (['disputed', 'cancelled', 'expired', 'closed'].includes(x)) return 'danger';
  if (x === 'paused') return 'info';
  return 'default';
}
function copyToClipboard(text: string) {
  void navigator.clipboard?.writeText(text);
}

// ── Shared table primitives ───────────────────────────────────────────────────
const TH = 'px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-admin-muted bg-white/[0.015]';
const TD = 'px-3 py-2.5 text-sm text-admin-text border-t border-admin-border/50 align-middle';

function TableWrap({ children, minW = 720 }: { children: React.ReactNode; minW?: number }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-admin-border/60">
      <table className={`w-full border-collapse`} style={{ minWidth: minW }}>
        {children}
      </table>
    </div>
  );
}

function EmptyState({ icon: Icon, message, sub }: { icon: React.ElementType; message: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="rounded-full border border-admin-border/60 bg-white/[0.03] p-4">
        <Icon className="h-7 w-7 text-admin-muted/50" />
      </div>
      <p className="text-sm font-medium text-admin-muted">{message}</p>
      {sub && <p className="text-xs text-admin-muted/60">{sub}</p>}
    </div>
  );
}

function LoadingRows({ cols }: { cols: number }) {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <tr key={i}>
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className={TD}>
              <div className="h-3.5 w-full max-w-[120px] animate-pulse rounded bg-white/[0.06]" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function Pager({
  page, pages, total, label, busy, onPrev, onNext,
}: {
  page: number; pages: number; total: number; label: string;
  busy: boolean; onPrev: () => void; onNext: () => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-between gap-2 text-xs text-admin-muted">
      <span>{total.toLocaleString()} {label}</span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onPrev}
          disabled={page <= 1 || busy}
          className="rounded-lg border border-admin-border/60 p-1.5 text-admin-muted hover:text-admin-text disabled:opacity-30 transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="rounded-lg border border-admin-border/60 px-2.5 py-1 text-[11px] font-mono">
          {page} / {pages}
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={page >= pages || busy}
          className="rounded-lg border border-admin-border/60 p-1.5 text-admin-muted hover:text-admin-text disabled:opacity-30 transition-colors"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function TabToolbar({
  search, onSearch, onRefresh, busy, extra,
}: {
  search: string; onSearch: (v: string) => void;
  onRefresh?: () => void; busy?: boolean;
  extra?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[180px] max-w-xs">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-admin-muted pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search…"
          className="w-full rounded-lg border border-admin-border/60 bg-admin-surface py-1.5 pl-8 pr-3 text-sm text-admin-text placeholder-admin-muted focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        />
        {search && (
          <button type="button" onClick={() => onSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-admin-muted hover:text-admin-text">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {extra}
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy}
          className="rounded-lg border border-admin-border/60 p-1.5 text-admin-muted hover:text-admin-text disabled:opacity-40 transition-colors"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
        </button>
      )}
    </div>
  );
}

// ── KPI card ──────────────────────────────────────────────────────────────────
function KpiCard({
  label, value, sub, icon: Icon, accent, alert, loading,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; accent: string; alert?: boolean; loading?: boolean;
}) {
  return (
    <div className={cn(
      'relative rounded-xl border bg-admin-card p-4 overflow-hidden transition-all',
      alert ? 'border-amber-500/40' : 'border-admin-border/60'
    )}>
      <div className={cn('absolute inset-x-0 top-0 h-0.5 rounded-t-xl bg-gradient-to-r', accent)} />
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-medium text-admin-muted">{label}</span>
        <div className={cn('rounded-lg p-1.5', alert ? 'bg-amber-500/10' : 'bg-white/[0.04]')}>
          <Icon className={cn('h-3.5 w-3.5', alert ? 'text-amber-400' : 'text-admin-muted')} />
        </div>
      </div>
      {loading ? (
        <div className="h-7 w-20 animate-pulse rounded bg-white/[0.06]" />
      ) : (
        <p className={cn('text-2xl font-bold tabular-nums', alert ? 'text-amber-300' : 'text-admin-text')}>
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
      )}
      {sub && <p className="mt-1 text-[10px] text-admin-muted">{sub}</p>}
    </div>
  );
}

// ── Side badge (Buy / Sell) ───────────────────────────────────────────────────
function SideBadge({ side }: { side: string }) {
  const s = side.toLowerCase();
  if (s === 'buy') return (
    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">
      <ArrowDownLeft className="h-3 w-3" />Buy
    </span>
  );
  if (s === 'sell') return (
    <span className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold text-red-400">
      <ArrowUpRight className="h-3 w-3" />Sell
    </span>
  );
  return <span className="text-admin-muted text-xs">—</span>;
}

function CompletionBar({ rate }: { rate: number }) {
  const pct = Math.min(100, Math.max(0, rate));
  const color = pct >= 90 ? 'bg-emerald-500' : pct >= 70 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 rounded-full bg-white/[0.06]">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono">{pct.toFixed(1)}%</span>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
export default function P2pManagementPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const admin = useAdminAuthStore((s) => s.admin);
  const qc = useQueryClient();

  useAdminWs({
    onEvent: (event) => {
      const type = (event?.type as string) ?? '';
      if (['p2p_order_created', 'p2p_dispute_created', 'p2p_dispute_resolved'].includes(type)) {
        qc.invalidateQueries({ queryKey: ['admin', 'p2p'] });
      }
    },
  });

  const canResolve = hasAdminPermission(admin, 'p2p:disputes');
  const [tab, setTab] = useState<TabId>('orders');
  const [ordersPage, setOrdersPage] = useState(1);
  const [disputesPage, setDisputesPage] = useState(1);
  const [adsPage, setAdsPage] = useState(1);
  const [merchantsPage, setMerchantsPage] = useState(1);
  const [merchantFilter, setMerchantFilter] = useState('all');

  // Search state per tab
  const [ordersSearch, setOrdersSearch] = useState('');
  const [disputesSearch, setDisputesSearch] = useState('');
  const [adsSearch, setAdsSearch] = useState('');
  const [merchantsSearch, setMerchantsSearch] = useState('');
  const [escrowsSearch, setEscrowsSearch] = useState('');

  // Modal state
  const [resolveTarget, setResolveTarget] = useState<DisputeRow | null>(null);
  const [resolution, setResolution] = useState<'favor_buyer' | 'favor_seller' | 'cancelled'>('favor_buyer');
  const [resolveNotes, setResolveNotes] = useState('');
  const [reviewTarget, setReviewTarget] = useState<MerchantRow | null>(null);
  const [reviewStatus, setReviewStatus] = useState<'approved' | 'rejected'>('approved');
  const [reviewNote, setReviewNote] = useState('');
  const [escrowAction, setEscrowAction] = useState<{ row: EscrowRow; action: 'freeze' | 'unfreeze' } | null>(null);
  const [escrowReason, setEscrowReason] = useState('');
  const [freezeTarget, setFreezeTarget] = useState<{ userId: string; username: string } | null>(null);
  const [freezeReason, setFreezeReason] = useState('');

  // ── Queries ────────────────────────────────────────────────────────────────
  const ov = useQuery({
    queryKey: ['admin', 'p2p', 'overview', token],
    staleTime: 30_000,
    queryFn: async () => {
      const r = await getP2pOverview(token);
      if (!r.success) throw new Error(r.error?.message ?? 'Overview failed');
      return r.data as Record<string, unknown> | undefined;
    },
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });
  const oq = useQuery({
    queryKey: ['admin', 'p2p', 'orders', token, ordersPage],
    staleTime: 30_000,
    queryFn: async () => {
      const r = await getP2pOrders(token, { page: ordersPage, limit: PAGE_SIZE });
      if (!r.success) throw new Error(r.error?.message ?? 'Orders failed');
      return r.data;
    },
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });
  const dq = useQuery({
    queryKey: ['admin', 'p2p', 'disputes', token],
    staleTime: 30_000,
    queryFn: async () => {
      const r = await getP2pDisputes(token);
      if (!r.success) throw new Error(r.error?.message ?? 'Disputes failed');
      const raw = r.data;
      const list = Array.isArray(raw) ? raw : Array.isArray((raw as { disputes?: unknown[] })?.disputes) ? (raw as { disputes: unknown[] }).disputes : [];
      return list as DisputeRow[];
    },
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });
  const aq = useQuery({
    queryKey: ['admin', 'p2p', 'ads', token, adsPage],
    staleTime: 30_000,
    queryFn: async () => {
      const r = await getP2pAds(token, { page: adsPage, limit: PAGE_SIZE });
      if (!r.success) throw new Error(r.error?.message ?? 'Ads failed');
      return r.data;
    },
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });
  const mq = useQuery({
    queryKey: ['admin', 'p2p', 'merchants', token, merchantsPage, merchantFilter],
    staleTime: 30_000,
    queryFn: async () => {
      const r = await getP2pMerchants(token, { page: merchantsPage, limit: PAGE_SIZE, status: merchantFilter !== 'all' ? merchantFilter : undefined });
      if (!r.success) throw new Error(r.error?.message ?? 'Merchants failed');
      return r.data;
    },
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });
  const eq = useQuery({
    queryKey: ['admin', 'p2p', 'escrows', token],
    staleTime: 30_000,
    queryFn: async () => {
      const r = await getP2pEscrows(token);
      if (!r.success) throw new Error(r.error?.message ?? 'Escrows failed');
      const raw = r.data;
      const list = Array.isArray(raw) ? raw : Array.isArray((raw as { escrows?: unknown[] })?.escrows) ? (raw as { escrows: unknown[] }).escrows : [];
      return list as EscrowRow[];
    },
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const resolveMu = useMutation({
    mutationFn: async (p: { id: string; resolution: typeof resolution; notes: string }) => {
      const r = await resolveP2pDispute(token, p.id, { resolution: p.resolution, notes: p.notes.trim() || undefined });
      if (!r.success) throw new Error(r.error?.message ?? 'Resolve failed');
      return r;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'p2p'] }); setResolveTarget(null); setResolveNotes(''); },
  });
  const reviewMu = useMutation({
    mutationFn: async (p: { id: string; status: 'approved' | 'rejected'; note: string }) => {
      const r = await reviewP2pMerchant(token, p.id, { status: p.status, note: p.note.trim() || undefined });
      if (!r.success) throw new Error(r.error?.message ?? 'Review failed');
      return r;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'p2p'] }); setReviewTarget(null); setReviewNote(''); },
  });
  const escrowMu = useMutation({
    mutationFn: async (p: { id: string; action: 'freeze' | 'unfreeze'; reason?: string }) => {
      const r = p.action === 'freeze' ? await freezeEscrow(token, p.id, p.reason) : await unfreezeEscrow(token, p.id);
      if (!r.success) throw new Error(r.error?.message ?? `${p.action} failed`);
      return r;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'p2p'] }); setEscrowAction(null); setEscrowReason(''); },
  });
  const freezeUserMu = useMutation({
    mutationFn: async (p: { userId: string; reason: string }) => {
      const r = await freezeP2pUser(token, p.userId, p.reason);
      if (!r.success) throw new Error(r.error?.message ?? 'Freeze failed');
      return r;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'p2p'] }); setFreezeTarget(null); setFreezeReason(''); },
  });

  // ── Derived data ───────────────────────────────────────────────────────────
  const adsS = ov.data?.adsStats as Record<string, unknown> | undefined;
  const ordS = ov.data?.orderStats as Record<string, unknown> | undefined;
  const dspS = ov.data?.disputeStats as Record<string, unknown> | undefined;
  const orders = (oq.data?.orders ?? []) as Record<string, unknown>[];
  const op = oq.data?.pagination;
  const oPages = Math.max(1, Math.ceil((op?.total ?? 0) / PAGE_SIZE));
  const allD = dq.data ?? [];
  const dPages = Math.max(1, Math.ceil(allD.length / PAGE_SIZE));
  const dSlice = useMemo(() => { const s = (disputesPage - 1) * PAGE_SIZE; return allD.slice(s, s + PAGE_SIZE); }, [allD, disputesPage]);
  const ads = (aq.data?.ads ?? []) as Record<string, unknown>[];
  const ap = aq.data?.pagination;
  const aPages = Math.max(1, Math.ceil((ap?.total ?? 0) / PAGE_SIZE));
  const merchants = (mq.data?.merchants ?? []) as MerchantRow[];
  const mp = mq.data?.pagination;
  const mPages = Math.max(1, Math.ceil((mp?.total ?? 0) / PAGE_SIZE));
  const allE = eq.data ?? [];
  const escrowsByStatus = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of allE) { const s = str(e.status).toLowerCase(); counts[s] = (counts[s] ?? 0) + 1; }
    return counts;
  }, [allE]);
  const activeEscrows = allE.filter((e) => ['active', 'held'].includes(str(e.status).toLowerCase()));
  const totalEscrowValue = useMemo(() => allE.reduce((sum, e) => sum + n(e.amount ?? e.crypto_amount), 0), [allE]);
  const openDisputes = n(dspS?.open_disputes) + n(dspS?.under_review);

  // Client-side search filters
  function matchSearch(row: Record<string, unknown>, q: string): boolean {
    if (!q.trim()) return true;
    const haystack = JSON.stringify(row).toLowerCase();
    return q.toLowerCase().split(' ').every((w) => haystack.includes(w));
  }
  const filteredOrders = useMemo(() => orders.filter((r) => matchSearch(r, ordersSearch)), [orders, ordersSearch]);
  const filteredDisputes = useMemo(() => dSlice.filter((r) => matchSearch(r, disputesSearch)), [dSlice, disputesSearch]);
  const filteredAds = useMemo(() => ads.filter((r) => matchSearch(r, adsSearch)), [ads, adsSearch]);
  const filteredMerchants = useMemo(() => merchants.filter((r) => matchSearch(r, merchantsSearch)), [merchants, merchantsSearch]);
  const filteredEscrows = useMemo(() => allE.filter((r) => matchSearch(r, escrowsSearch)), [allE, escrowsSearch]);

  const p2pPageStatus: AdminPageStatus = ov.isError ? 'risk' : openDisputes > 10 ? 'warning' : 'active';
  const pendingMerchants = merchants.filter((m) => str(m.status).toLowerCase() === 'pending').length;
  const frozenEscrows = allE.filter((e) => e.frozen === true || e.is_frozen === true || str(e.status).toLowerCase() === 'frozen').length;

  function refreshAll() {
    void qc.invalidateQueries({ queryKey: ['admin', 'p2p'] });
  }

  return (
    <AdminPageFrame
      title="P2P Trading"
      description="Manage orders, disputes, ads, merchants, and escrows."
      status={p2pPageStatus}
      error={ov.isError ? ((ov.error as Error)?.message ?? 'P2P overview failed') : null}
      onRetry={() => void ov.refetch()}
    >

      {/* ── KPI Strip ─────────────────────────────────────────────────────── */}
      <div className="grid gap-3 grid-cols-2 xl:grid-cols-6">
        <KpiCard
          label="Active Orders"
          value={n(ordS?.active_orders)}
          sub={`${n(ordS?.total_orders).toLocaleString()} total`}
          icon={Activity}
          accent="from-blue-500/60 to-blue-500/0"
          loading={ov.isLoading}
        />
        <KpiCard
          label="Open Disputes"
          value={openDisputes}
          sub={openDisputes > 0 ? `${n(dspS?.under_review)} under review` : 'All clear'}
          icon={openDisputes > 0 ? AlertTriangle : ShieldCheck}
          accent={openDisputes > 0 ? 'from-amber-500/70 to-amber-500/0' : 'from-emerald-500/60 to-emerald-500/0'}
          alert={openDisputes > 0}
          loading={ov.isLoading}
        />
        <KpiCard
          label="Active Ads"
          value={n(adsS?.active_ads)}
          sub={`${n(adsS?.total_ads ?? 0)} total ads`}
          icon={Megaphone}
          accent="from-purple-500/60 to-purple-500/0"
          loading={ov.isLoading}
        />
        <KpiCard
          label="Total Orders"
          value={n(ordS?.total_orders)}
          sub="All time P2P orders"
          icon={DollarSign}
          accent="from-cyan-500/60 to-cyan-500/0"
          loading={ov.isLoading}
        />
        <KpiCard
          label="Escrow Value"
          value={totalEscrowValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          sub={`${activeEscrows.length} active · ${frozenEscrows > 0 ? `${frozenEscrows} frozen` : 'none frozen'}`}
          icon={Lock}
          accent={frozenEscrows > 0 ? 'from-red-500/60 to-red-500/0' : 'from-indigo-500/60 to-indigo-500/0'}
          alert={frozenEscrows > 0}
          loading={ov.isLoading}
        />
        <KpiCard
          label="Active Escrows"
          value={activeEscrows.length}
          sub={pendingMerchants > 0 ? `${pendingMerchants} merchant${pendingMerchants > 1 ? 's' : ''} pending` : 'No pending reviews'}
          icon={pendingMerchants > 0 ? Users : ShieldCheck}
          accent={pendingMerchants > 0 ? 'from-amber-500/60 to-amber-500/0' : 'from-emerald-500/60 to-emerald-500/0'}
          alert={pendingMerchants > 0}
          loading={ov.isLoading}
        />
      </div>

      {/* ── Main tabs card ────────────────────────────────────────────────── */}
      <Card className="border-admin-border/60">
        <CardHeader className="pb-0 border-b border-admin-border/50">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <Tabs<TabId>
              variant="pills"
              size="sm"
              active={tab}
              onChange={setTab}
              items={[
                { id: 'orders', label: 'Orders', badge: op?.total ?? undefined },
                { id: 'disputes', label: 'Disputes', badge: allD.length || undefined },
                { id: 'ads', label: 'Ads', badge: ap?.total ?? undefined },
                { id: 'merchants', label: 'Merchants', badge: mp?.total ?? undefined },
                { id: 'escrows', label: 'Escrows', badge: allE.length || undefined },
              ]}
            />
            <button
              type="button"
              onClick={refreshAll}
              className="flex items-center gap-1.5 rounded-lg border border-admin-border/60 px-2.5 py-1.5 text-xs text-admin-muted hover:text-admin-text hover:bg-white/[0.04] transition-colors"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', (oq.isFetching || dq.isFetching) && 'animate-spin')} />
              Refresh
            </button>
          </div>
        </CardHeader>

        <CardContent className="pt-5">

          {/* ── Orders tab ──────────────────────────────────────────────── */}
          {tab === 'orders' && (
            <>
              <TabToolbar
                search={ordersSearch}
                onSearch={setOrdersSearch}
                onRefresh={() => void oq.refetch()}
                busy={oq.isFetching}
              />
              {oq.isLoading ? (
                <TableWrap minW={760}>
                  <thead><tr>{['User', 'Type', 'Amount', 'Price', 'Status', 'Created'].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
                  <tbody><LoadingRows cols={6} /></tbody>
                </TableWrap>
              ) : oq.isError ? (
                <p className="py-6 text-center text-sm text-red-400">{(oq.error as Error).message}</p>
              ) : filteredOrders.length === 0 ? (
                <EmptyState icon={Activity} message="No P2P orders found" sub={ordersSearch ? 'Try a different search term' : 'Orders will appear here when placed'} />
              ) : (
                <>
                  <TableWrap minW={760}>
                    <thead>
                      <tr>
                        {['Order ID', 'User', 'Type', 'Amount', 'Price', 'Status', 'Created'].map((h) => <th key={h} className={TH}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOrders.map((row) => {
                        const t = str(row.ad_type ?? row.type ?? row.side).toLowerCase();
                        const sym = str(row.crypto_symbol);
                        const qty = str(row.quantity ?? row.crypto_amount);
                        const id = str(row.id);
                        return (
                          <tr key={id} className="hover:bg-white/[0.015] transition-colors">
                            <td className={cn(TD, 'font-mono text-xs')}>
                              <button type="button" onClick={() => copyToClipboard(id)} title="Copy ID"
                                className="flex items-center gap-1 text-admin-muted hover:text-admin-text group">
                                {id.slice(0, 8)}…
                                <Copy className="h-2.5 w-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
                              </button>
                            </td>
                            <td className={TD}><span className="font-medium">{str(row.buyer_username ?? row.buyer_email)}</span></td>
                            <td className={TD}><SideBadge side={t} /></td>
                            <td className={cn(TD, 'tabular-nums font-mono text-sm font-semibold')}>
                              {sym !== '—' ? `${qty} ${sym}` : qty}
                            </td>
                            <td className={cn(TD, 'tabular-nums')}>{`${str(row.price)} ${str(row.fiat_currency)}`}</td>
                            <td className={TD}><Badge variant={statusVar(str(row.status))} size="sm">{str(row.status)}</Badge></td>
                            <td className={cn(TD, 'whitespace-nowrap text-admin-muted text-xs')} title={formatDt(row.created_at)}>
                              {formatDtShort(row.created_at)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </TableWrap>
                  <Pager
                    page={op?.page ?? ordersPage} pages={oPages} total={op?.total ?? 0} label="orders"
                    busy={oq.isFetching} onPrev={() => setOrdersPage((p) => Math.max(1, p - 1))} onNext={() => setOrdersPage((p) => p + 1)}
                  />
                </>
              )}
            </>
          )}

          {/* ── Disputes tab ────────────────────────────────────────────── */}
          {tab === 'disputes' && (
            <>
              {allD.length > 0 && (
                <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-950/20 px-4 py-2.5">
                  <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                  <span className="text-xs font-semibold text-amber-300">{allD.length} open dispute{allD.length > 1 ? 's' : ''} require attention</span>
                  {n(dspS?.under_review) > 0 && (
                    <span className="ml-auto rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-400">{n(dspS?.under_review)} under review</span>
                  )}
                </div>
              )}
              <TabToolbar
                search={disputesSearch}
                onSearch={setDisputesSearch}
                onRefresh={() => void dq.refetch()}
                busy={dq.isFetching}
              />
              {dq.isLoading ? (
                <TableWrap minW={900}>
                  <thead><tr>{['ID', 'Buyer', 'Seller', 'Amount', 'Reason', 'Status', 'Actions'].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
                  <tbody><LoadingRows cols={7} /></tbody>
                </TableWrap>
              ) : dq.isError ? (
                <p className="py-6 text-center text-sm text-red-400">{(dq.error as Error).message}</p>
              ) : filteredDisputes.length === 0 ? (
                <EmptyState icon={ShieldCheck} message="No open disputes" sub={disputesSearch ? 'Try a different search term' : 'All disputes have been resolved'} />
              ) : (
                <>
                  <TableWrap minW={960}>
                    <thead>
                      <tr>{['ID', 'Buyer', 'Seller', 'Amount', 'Reason', 'Status', 'Opened', 'Actions'].map((h) => <th key={h} className={TH}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {filteredDisputes.map((row) => {
                        const st = str(row.status);
                        const open = ['open', 'under_review'].includes(st.toLowerCase());
                        const isFraud = str(row.reason).toLowerCase().includes('fraud');
                        const id = str(row.id);
                        return (
                          <tr key={id} className={cn('hover:bg-white/[0.015] transition-colors', isFraud && 'bg-red-950/10')}>
                            <td className={cn(TD, 'font-mono text-xs')}>
                              <button type="button" onClick={() => copyToClipboard(id)} className="flex items-center gap-1 text-admin-muted hover:text-admin-text group">
                                {id.slice(0, 8)}…
                                <Copy className="h-2.5 w-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
                              </button>
                            </td>
                            <td className={TD}>{str(row.buyer_username ?? row.buyer_email)}</td>
                            <td className={TD}>{str(row.seller_username ?? row.seller_email)}</td>
                            <td className={cn(TD, 'tabular-nums')}>
                              <span className="font-mono font-semibold">{`${str(row.crypto_amount ?? row.quantity)} ${str(row.crypto_symbol)}`}</span>
                              <span className="block text-[10px] text-admin-muted">{`${str(row.fiat_amount)} ${str(row.fiat_currency)}`}</span>
                            </td>
                            <td className={cn(TD, 'max-w-[180px]')}>
                              <span className="block truncate text-xs" title={str(row.reason)}>{str(row.reason)}</span>
                              {isFraud && <Badge variant="danger" size="sm" className="mt-0.5">⚠ Fraud</Badge>}
                            </td>
                            <td className={TD}><Badge variant={statusVar(st)} size="sm">{st}</Badge></td>
                            <td className={cn(TD, 'whitespace-nowrap text-admin-muted text-xs')} title={formatDt(row.created_at)}>
                              {formatDtShort(row.created_at)}
                            </td>
                            <td className={TD}>
                              {open && canResolve ? (
                                <div className="flex gap-1">
                                  <ProtectedAction permission="p2p:disputes" fallback="disabled">
                                    <Button size="sm" variant="outline" onClick={() => { setResolution('favor_buyer'); setResolveNotes(''); setResolveTarget(row); }}>
                                      <Gavel className="h-3 w-3 mr-1" />Resolve
                                    </Button>
                                  </ProtectedAction>
                                  <ProtectedAction permission="users:edit" fallback="hidden">
                                    <Button size="sm" variant="outline" className="text-red-400 border-red-500/25 hover:bg-red-950/20"
                                      onClick={() => {
                                        const uid = str(row.buyer_id ?? row.seller_id);
                                        const un = str(row.buyer_username ?? row.seller_username ?? row.buyer_email ?? 'User');
                                        if (uid !== '—') { setFreezeReason(''); setFreezeTarget({ userId: uid, username: un }); }
                                      }}>
                                      <ShieldAlert className="h-3 w-3 mr-1" />Freeze
                                    </Button>
                                  </ProtectedAction>
                                </div>
                              ) : <span className="text-xs text-admin-muted">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </TableWrap>
                  <Pager
                    page={disputesPage} pages={dPages} total={allD.length} label="disputes"
                    busy={dq.isFetching} onPrev={() => setDisputesPage((p) => Math.max(1, p - 1))} onNext={() => setDisputesPage((p) => p + 1)}
                  />
                </>
              )}
            </>
          )}

          {/* ── Ads tab ─────────────────────────────────────────────────── */}
          {tab === 'ads' && (
            <>
              <TabToolbar
                search={adsSearch}
                onSearch={setAdsSearch}
                onRefresh={() => void aq.refetch()}
                busy={aq.isFetching}
              />
              {aq.isLoading ? (
                <TableWrap minW={800}>
                  <thead><tr>{['User', 'Type', 'Asset', 'Price', 'Limits', 'Available', 'Status'].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
                  <tbody><LoadingRows cols={7} /></tbody>
                </TableWrap>
              ) : aq.isError ? (
                <p className="py-6 text-center text-sm text-red-400">{(aq.error as Error).message}</p>
              ) : filteredAds.length === 0 ? (
                <EmptyState icon={Megaphone} message="No P2P ads found" sub={adsSearch ? 'Try a different search term' : 'No active ads at this time'} />
              ) : (
                <>
                  <TableWrap minW={840}>
                    <thead>
                      <tr>{['User', 'Type', 'Asset', 'Price', 'Limits', 'Available', 'Status'].map((h) => <th key={h} className={TH}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {filteredAds.map((row) => {
                        const t = str(row.ad_type ?? row.type).toLowerCase();
                        return (
                          <tr key={str(row.id)} className="hover:bg-white/[0.015] transition-colors">
                            <td className={TD}><span className="font-medium">{str(row.username ?? row.email)}</span></td>
                            <td className={TD}><SideBadge side={t} /></td>
                            <td className={cn(TD, 'font-mono font-semibold text-blue-300')}>{str(row.crypto_symbol)}</td>
                            <td className={cn(TD, 'tabular-nums font-semibold')}>{`${str(row.price)} ${str(row.fiat_currency)}`}</td>
                            <td className={cn(TD, 'tabular-nums text-xs text-admin-muted')}>{`${str(row.min_amount)} – ${str(row.max_amount)}`}</td>
                            <td className={cn(TD, 'tabular-nums font-mono')}>{str(row.available_amount ?? row.remaining_amount ?? '—')}</td>
                            <td className={TD}><Badge variant={statusVar(str(row.status))} size="sm">{str(row.status)}</Badge></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </TableWrap>
                  <Pager
                    page={ap?.page ?? adsPage} pages={aPages} total={ap?.total ?? 0} label="ads"
                    busy={aq.isFetching} onPrev={() => setAdsPage((p) => Math.max(1, p - 1))} onNext={() => setAdsPage((p) => p + 1)}
                  />
                </>
              )}
            </>
          )}

          {/* ── Merchants tab ───────────────────────────────────────────── */}
          {tab === 'merchants' && (
            <>
              {pendingMerchants > 0 && (
                <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-950/20 px-4 py-2.5">
                  <Circle className="h-4 w-4 text-amber-400 shrink-0 fill-amber-400" />
                  <span className="text-xs font-semibold text-amber-300">{pendingMerchants} merchant application{pendingMerchants > 1 ? 's' : ''} awaiting review</span>
                </div>
              )}
              <TabToolbar
                search={merchantsSearch}
                onSearch={setMerchantsSearch}
                onRefresh={() => void mq.refetch()}
                busy={mq.isFetching}
                extra={
                  <select
                    className="rounded-lg border border-admin-border/60 bg-admin-surface px-3 py-1.5 text-xs text-admin-text focus:outline-none"
                    value={merchantFilter}
                    onChange={(e) => { setMerchantFilter(e.target.value); setMerchantsPage(1); }}
                  >
                    <option value="all">All statuses</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                }
              />
              {mq.isLoading ? (
                <TableWrap minW={900}>
                  <thead><tr>{['User', 'Business', 'Type', '30d Volume', 'Completion', 'Status', 'Applied', 'Actions'].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
                  <tbody><LoadingRows cols={8} /></tbody>
                </TableWrap>
              ) : mq.isError ? (
                <p className="py-6 text-center text-sm text-red-400">{(mq.error as Error).message}</p>
              ) : filteredMerchants.length === 0 ? (
                <EmptyState icon={Store} message="No merchants found" sub={merchantsSearch ? 'Try a different search term' : 'No merchant applications yet'} />
              ) : (
                <>
                  <TableWrap minW={960}>
                    <thead>
                      <tr>{['User', 'Business', 'Type', '30d Volume', 'Completion', 'Status', 'Applied', 'Actions'].map((h) => <th key={h} className={TH}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {filteredMerchants.map((row) => {
                        const st = str(row.status);
                        const isPending = st.toLowerCase() === 'pending';
                        return (
                          <tr key={str(row.id)} className={cn('hover:bg-white/[0.015] transition-colors', isPending && 'bg-amber-950/5')}>
                            <td className={TD}><span className="font-medium">{str(row.user_email ?? row.user_username)}</span></td>
                            <td className={cn(TD, 'font-semibold')}>{str(row.business_name)}</td>
                            <td className={TD}><span className="rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-admin-muted">{str(row.business_type)}</span></td>
                            <td className={cn(TD, 'tabular-nums font-mono')}>{n(row.volume_30d).toLocaleString()}</td>
                            <td className={TD}><CompletionBar rate={n(row.completion_rate)} /></td>
                            <td className={TD}><Badge variant={statusVar(st)} size="sm">{st}</Badge></td>
                            <td className={cn(TD, 'text-admin-muted text-xs')} title={formatDt(row.created_at)}>{formatDtShort(row.created_at)}</td>
                            <td className={TD}>
                              {isPending && canResolve ? (
                                <Button size="sm" variant="outline" onClick={() => { setReviewStatus('approved'); setReviewNote(''); setReviewTarget(row); }}>
                                  Review
                                </Button>
                              ) : (
                                <span className="text-xs text-admin-muted">{row.reviewer_email ? `by ${str(row.reviewer_email)}` : '—'}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </TableWrap>
                  <Pager
                    page={mp?.page ?? merchantsPage} pages={mPages} total={mp?.total ?? 0} label="merchants"
                    busy={mq.isFetching} onPrev={() => setMerchantsPage((p) => Math.max(1, p - 1))} onNext={() => setMerchantsPage((p) => p + 1)}
                  />
                </>
              )}
            </>
          )}

          {/* ── Escrows tab ─────────────────────────────────────────────── */}
          {tab === 'escrows' && (
            <>
              {/* Escrow stats row */}
              <div className="mb-4 grid gap-2 grid-cols-2 sm:grid-cols-4">
                {[
                  { label: 'Total Value', value: totalEscrowValue.toLocaleString(undefined, { maximumFractionDigits: 2 }), color: 'text-admin-text' },
                  { label: 'Active', value: String(activeEscrows.length), color: 'text-emerald-400' },
                  { label: 'Frozen', value: String(frozenEscrows), color: frozenEscrows > 0 ? 'text-red-400' : 'text-admin-muted' },
                  ...Object.entries(escrowsByStatus).slice(0, 1).map(([status, count]) => ({ label: status.charAt(0).toUpperCase() + status.slice(1), value: String(count), color: 'text-admin-text' })),
                ].map(({ label, value, color }) => (
                  <div key={label} className="rounded-xl border border-admin-border/50 bg-white/[0.015] px-3 py-2.5">
                    <p className="text-[9px] uppercase tracking-widest text-admin-muted mb-1">{label}</p>
                    <p className={cn('text-lg font-bold tabular-nums font-mono', color)}>{value}</p>
                  </div>
                ))}
              </div>

              <TabToolbar
                search={escrowsSearch}
                onSearch={setEscrowsSearch}
                onRefresh={() => void eq.refetch()}
                busy={eq.isFetching}
              />

              {eq.isLoading ? (
                <TableWrap minW={900}>
                  <thead><tr>{['ID', 'Buyer', 'Seller', 'Amount', 'Asset', 'Status', 'Frozen', 'Created', 'Actions'].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
                  <tbody><LoadingRows cols={9} /></tbody>
                </TableWrap>
              ) : eq.isError ? (
                <p className="py-6 text-center text-sm text-red-400">{(eq.error as Error).message}</p>
              ) : filteredEscrows.length === 0 ? (
                <EmptyState icon={Lock} message="No escrows found" sub={escrowsSearch ? 'Try a different search term' : 'No escrows at this time'} />
              ) : (
                <TableWrap minW={960}>
                  <thead>
                    <tr>{['ID', 'Buyer', 'Seller', 'Amount', 'Asset', 'Status', 'Frozen', 'Created', 'Actions'].map((h) => <th key={h} className={TH}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {filteredEscrows.map((row) => {
                      const st = str(row.status).toLowerCase();
                      const isFrozen = row.frozen === true || row.is_frozen === true || st === 'frozen';
                      const canAct = ['active', 'held', 'frozen'].includes(st);
                      const id = str(row.id);
                      return (
                        <tr key={id} className={cn('hover:bg-white/[0.015] transition-colors', isFrozen && 'bg-red-950/10')}>
                          <td className={cn(TD, 'font-mono text-xs')}>
                            <button type="button" onClick={() => copyToClipboard(id)} className="flex items-center gap-1 text-admin-muted hover:text-admin-text group">
                              {id.slice(0, 8)}…
                              <Copy className="h-2.5 w-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
                            </button>
                          </td>
                          <td className={TD}>{str(row.buyer_username ?? row.buyer_email ?? row.buyer_id)}</td>
                          <td className={TD}>{str(row.seller_username ?? row.seller_email ?? row.seller_id)}</td>
                          <td className={cn(TD, 'tabular-nums font-mono font-semibold')}>{str(row.amount ?? row.crypto_amount)}</td>
                          <td className={cn(TD, 'font-mono text-blue-300 font-semibold')}>{str(row.crypto_symbol ?? row.asset ?? row.currency)}</td>
                          <td className={TD}><Badge variant={statusVar(str(row.status))} size="sm">{str(row.status)}</Badge></td>
                          <td className={TD}>
                            {isFrozen
                              ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-400"><Lock className="h-3 w-3" />Frozen</span>
                              : <span className="text-admin-muted text-xs">—</span>
                            }
                          </td>
                          <td className={cn(TD, 'text-admin-muted text-xs')} title={formatDt(row.created_at)}>{formatDtShort(row.created_at)}</td>
                          <td className={TD}>
                            {canAct ? (
                              <ProtectedAction permission="p2p:disputes" fallback="disabled">
                                <div className="flex gap-1">
                                  {!isFrozen && (
                                    <Button size="sm" variant="outline" className="text-amber-400 border-amber-500/25 hover:bg-amber-950/20"
                                      onClick={() => { setEscrowReason(''); setEscrowAction({ row, action: 'freeze' }); }}>
                                      <Lock className="h-3 w-3 mr-1" />Freeze
                                    </Button>
                                  )}
                                  {isFrozen && (
                                    <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-500/25 hover:bg-emerald-950/20"
                                      onClick={() => setEscrowAction({ row, action: 'unfreeze' })}>
                                      <Unlock className="h-3 w-3 mr-1" />Unfreeze
                                    </Button>
                                  )}
                                </div>
                              </ProtectedAction>
                            ) : (
                              <span className="text-xs text-admin-muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </TableWrap>
              )}
            </>
          )}

        </CardContent>
      </Card>

      {/* ── Modals ────────────────────────────────────────────────────────── */}

      {/* Dispute Resolution Modal */}
      <Modal open={!!resolveTarget} onClose={() => !resolveMu.isPending && setResolveTarget(null)} title="Resolve Dispute" size="md">
        <div className="space-y-4">
          {resolveTarget && (
            <div className="rounded-xl border border-admin-border/60 bg-white/[0.02] p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-admin-muted text-xs">Buyer</span>
                <span className="font-medium">{str(resolveTarget.buyer_username ?? resolveTarget.buyer_email)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-admin-muted text-xs">Seller</span>
                <span className="font-medium">{str(resolveTarget.seller_username ?? resolveTarget.seller_email)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-admin-muted text-xs">Amount</span>
                <span className="font-mono font-semibold">{str(resolveTarget.crypto_amount ?? resolveTarget.quantity)} {str(resolveTarget.crypto_symbol)}</span>
              </div>
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-admin-muted">Resolution</label>
            <select className="w-full rounded-lg border border-admin-border bg-admin-card px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              value={resolution} onChange={(e) => setResolution(e.target.value as typeof resolution)} disabled={resolveMu.isPending}>
              <option value="favor_buyer">Release to buyer</option>
              <option value="favor_seller">Release to seller</option>
              <option value="cancelled">Cancel order</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-admin-muted">Audit notes (optional)</label>
            <Textarea rows={3} value={resolveNotes} onChange={(e) => setResolveNotes(e.target.value)} disabled={resolveMu.isPending} placeholder="Document your reasoning for audit trail…" />
          </div>
          {resolveMu.isError && <p className="text-sm text-red-400">{(resolveMu.error as Error).message}</p>}
        </div>
        <ModalFooter className="mt-2 border-0 px-0 pb-0 pt-4">
          <Button variant="outline" onClick={() => setResolveTarget(null)} disabled={resolveMu.isPending}>Cancel</Button>
          <Button onClick={() => { const id = str(resolveTarget?.id); if (id !== '—') resolveMu.mutate({ id, resolution, notes: resolveNotes }); }} disabled={resolveMu.isPending}>
            <Gavel className="h-3.5 w-3.5 mr-1.5" />{resolveMu.isPending ? 'Resolving…' : 'Confirm Resolution'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Merchant Review Modal */}
      <Modal open={!!reviewTarget} onClose={() => !reviewMu.isPending && setReviewTarget(null)} title="Review Merchant Application" size="md">
        <div className="space-y-4">
          {reviewTarget && (
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-admin-border/60 bg-white/[0.02] p-3 text-sm">
              {[
                ['Business', str(reviewTarget.business_name)],
                ['Type', str(reviewTarget.business_type)],
                ['30d Volume', n(reviewTarget.volume_30d).toLocaleString()],
                ['Completion', `${n(reviewTarget.completion_rate).toFixed(1)}%`],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <span className="text-[10px] text-admin-muted">{label as string}</span>
                  <p className="font-medium text-admin-text">{value as string}</p>
                </div>
              ))}
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-admin-muted">Decision</label>
            <select className="w-full rounded-lg border border-admin-border bg-admin-card px-3 py-2 text-sm text-admin-text focus:outline-none"
              value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value as typeof reviewStatus)} disabled={reviewMu.isPending}>
              <option value="approved">Approve merchant</option>
              <option value="rejected">Reject application</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-admin-muted">Note (optional)</label>
            <Textarea rows={3} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} disabled={reviewMu.isPending} placeholder="Review notes for audit trail" />
          </div>
          {reviewMu.isError && <p className="text-sm text-red-400">{(reviewMu.error as Error).message}</p>}
        </div>
        <ModalFooter className="mt-2 border-0 px-0 pb-0 pt-4">
          <Button variant="outline" onClick={() => setReviewTarget(null)} disabled={reviewMu.isPending}>Cancel</Button>
          <Button
            variant={reviewStatus === 'rejected' ? 'danger' : 'primary'}
            onClick={() => { const mid = str(reviewTarget?.id); if (mid !== '—') reviewMu.mutate({ id: mid, status: reviewStatus, note: reviewNote }); }}
            disabled={reviewMu.isPending}
          >
            {reviewMu.isPending ? 'Processing…' : reviewStatus === 'approved' ? '✓ Approve' : '✗ Reject'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Escrow Freeze/Unfreeze Modal */}
      <Modal open={!!escrowAction} onClose={() => !escrowMu.isPending && setEscrowAction(null)}
        title={escrowAction?.action === 'freeze' ? 'Freeze Escrow' : 'Unfreeze Escrow'} size="sm">
        <div className="space-y-3">
          {escrowAction?.action === 'freeze' && (
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-admin-muted">Reason (required)</label>
              <Textarea rows={3} value={escrowReason} onChange={(e) => setEscrowReason(e.target.value)} disabled={escrowMu.isPending} placeholder="Reason for freezing this escrow" />
            </div>
          )}
          <p className="text-sm text-admin-muted">
            {escrowAction?.action === 'freeze'
              ? 'This will freeze the escrow and prevent any releases until manually unfrozen.'
              : 'This will unfreeze the escrow and allow normal processing to continue.'}
          </p>
          {escrowMu.isError && <p className="text-sm text-red-400">{(escrowMu.error as Error).message}</p>}
        </div>
        <ModalFooter className="mt-2 border-0 px-0 pb-0 pt-4">
          <Button variant="outline" onClick={() => setEscrowAction(null)} disabled={escrowMu.isPending}>Cancel</Button>
          <Button
            variant={escrowAction?.action === 'freeze' ? 'danger' : 'primary'}
            onClick={() => { const eid = str(escrowAction?.row?.id); if (eid !== '—' && escrowAction) escrowMu.mutate({ id: eid, action: escrowAction.action, reason: escrowReason.trim() || undefined }); }}
            disabled={escrowMu.isPending}>
            {escrowMu.isPending ? 'Processing…' : escrowAction?.action === 'freeze' ? <><Lock className="h-3.5 w-3.5 mr-1" />Freeze</> : <><Unlock className="h-3.5 w-3.5 mr-1" />Unfreeze</>}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Freeze User Modal */}
      <Modal open={!!freezeTarget} onClose={() => !freezeUserMu.isPending && setFreezeTarget(null)} title="Freeze User Account" size="sm">
        <div className="space-y-4">
          <div className="rounded-xl border border-red-500/25 bg-red-950/20 p-3 text-sm">
            <p className="font-semibold text-red-300">⚠ High-impact action</p>
            <p className="mt-1 text-xs text-admin-muted">
              Suspending <span className="font-semibold text-admin-text">{freezeTarget?.username}</span> will immediately block all trading, withdrawals, and P2P activity.
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-admin-muted">Reason (min 5 characters)</label>
            <Textarea rows={3} value={freezeReason} onChange={(e) => setFreezeReason(e.target.value)} disabled={freezeUserMu.isPending} placeholder="Document the reason for this action" />
            {freezeReason.trim().length > 0 && freezeReason.trim().length < 5 && (
              <p className="mt-1 text-[10px] text-red-400">At least 5 characters required</p>
            )}
          </div>
          {freezeUserMu.isError && <p className="text-sm text-red-400">{(freezeUserMu.error as Error).message}</p>}
        </div>
        <ModalFooter className="mt-2 border-0 px-0 pb-0 pt-4">
          <Button variant="outline" onClick={() => setFreezeTarget(null)} disabled={freezeUserMu.isPending}>Cancel</Button>
          <Button variant="danger"
            onClick={() => { if (freezeTarget && freezeReason.trim().length >= 5) freezeUserMu.mutate({ userId: freezeTarget.userId, reason: freezeReason.trim() }); }}
            disabled={freezeUserMu.isPending || freezeReason.trim().length < 5}>
            <ShieldAlert className="h-3.5 w-3.5 mr-1" />{freezeUserMu.isPending ? 'Freezing…' : 'Freeze Account'}
          </Button>
        </ModalFooter>
      </Modal>
    </AdminPageFrame>
  );
}
