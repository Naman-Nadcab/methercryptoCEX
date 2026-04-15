'use client';

import { useCallback, useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { getUserById, getUserBalances, updateUserStatus, getUserStats, getUserSecurity, getUserApiKeys } from '@/lib/users-api';
import { getUserRiskTimeline } from '@/lib/risk-api';
import { getWithdrawals, getDeposits, adminFetch } from '@/lib/api';
import { UserWalletTable } from '@/components/users/UserWalletTable';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useAdminWs } from '@/hooks/useAdminWs';
import {
  ArrowLeft, ArrowDownToLine, ArrowUpFromLine, TrendingUp, BarChart3,
  Repeat, Mail, Globe, Calendar, Shield, ShieldOff, Ban, KeyRound,
  User, Wallet, Clock, Activity, Key, AlertTriangle, Copy, Check,
  DollarSign, X, Tag, StickyNote, Link2, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';

type TabId = 'overview' | 'wallets' | 'orders' | 'trades' | 'deposits' | 'withdrawals' | 'p2p' | 'activity' | 'security' | 'api-keys' | 'risk-timeline';

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: User },
  { id: 'wallets', label: 'Wallets', icon: Wallet },
  { id: 'orders', label: 'Orders', icon: BarChart3 },
  { id: 'trades', label: 'Trades', icon: TrendingUp },
  { id: 'deposits', label: 'Deposits', icon: ArrowDownToLine },
  { id: 'withdrawals', label: 'Withdrawals', icon: ArrowUpFromLine },
  { id: 'p2p', label: 'P2P', icon: Repeat },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'api-keys', label: 'API Keys', icon: Key },
  { id: 'risk-timeline', label: 'Risk', icon: AlertTriangle },
];

function fmtCurrency(val: string | number | undefined): string {
  if (val === undefined || val === null) return '$0.00';
  const n = typeof val === 'string' ? parseFloat(val) : Number(val);
  if (Number.isNaN(n)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

function fmtDate(s: string | undefined): string {
  if (!s) return '—';
  try { return new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return '—'; }
}

function fmtShortDate(s: string | undefined): string {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }); } catch { return '—'; }
}

function displayStatus(s: string | undefined): string {
  if (!s) return '—';
  if (s.toLowerCase() === 'locked') return 'Banned';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function UserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params?.id === 'string' ? params.id : '';
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [copied, setCopied] = useState(false);
  const [showBalanceAdjust, setShowBalanceAdjust] = useState(false);
  const [adjCurrency, setAdjCurrency] = useState('');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjType, setAdjType] = useState<'credit' | 'debit'>('credit');
  const [adjReason, setAdjReason] = useState('');
  const [adjError, setAdjError] = useState('');
  const [confirmAction, setConfirmAction] = useState<{ action: 'suspended' | 'locked' | 'active'; label: string } | null>(null);
  const [show2faReset, setShow2faReset] = useState(false);
  const [twoFaError,   setTwoFaError]   = useState('');
  const [twoFaLoading, setTwoFaLoading] = useState(false);
  const [adminNote, setAdminNote] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const [userTags, setUserTags] = useState<string[]>([]);
  const PRESET_TAGS = ['VIP', 'Whale', 'High Risk', 'Frozen', 'Watchlist', 'Fraud Suspect'];

  const { data: userData, isLoading: userLoading, isError: userError } = useQuery({
    queryKey: ['admin', 'user', id, token],
    staleTime: 30_000,
    queryFn: () => getUserById(token, id),
    enabled: !!token && !!id,
  });
  const { data: balancesData, isLoading: balancesLoading } = useQuery({
    queryKey: ['admin', 'user-balances', id, token],
    staleTime: 30_000,
    queryFn: () => getUserBalances(token, id),
    enabled: !!token && !!id && activeTab === 'wallets',
  });
  const { data: withdrawalsData } = useQuery({
    queryKey: ['admin', 'withdrawals', id, token],
    staleTime: 30_000,
    queryFn: () => getWithdrawals(token, { limit: 50, user: id }),
    enabled: !!token && !!id && activeTab === 'withdrawals',
  });
  const { data: depositsData } = useQuery({
    queryKey: ['admin', 'deposits', id, token],
    queryFn: () => getDeposits(token, { limit: 50, user: id }),
    enabled: !!token && !!id && activeTab === 'deposits',
  });
  const { data: statsData } = useQuery({
    queryKey: ['admin', 'user-stats', id, token],
    staleTime: 30_000,
    queryFn: () => getUserStats(token, id),
    enabled: !!token && !!id && activeTab === 'overview',
  });
  const { data: securityData, isLoading: securityLoading } = useQuery({
    queryKey: ['admin', 'user-security', id, token],
    staleTime: 30_000,
    queryFn: () => getUserSecurity(token, id),
    enabled: !!token && !!id && activeTab === 'security',
  });
  const { data: apiKeysData, isLoading: apiKeysLoading } = useQuery({
    queryKey: ['admin', 'user-api-keys', id, token],
    queryFn: () => getUserApiKeys(token, id),
    enabled: !!token && !!id && activeTab === 'api-keys',
  });
  const { data: riskTimelineData, isLoading: riskTimelineLoading } = useQuery({
    queryKey: ['admin', 'user-risk-timeline', id, token],
    staleTime: 30_000,
    queryFn: () => getUserRiskTimeline(token, id),
    enabled: !!token && !!id && activeTab === 'risk-timeline',
  });
  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: ['admin', 'user-orders', id, token],
    staleTime: 30_000,
    queryFn: () => adminFetch('/trading/orders', { token, params: { user_id: id, limit: '50' } }),
    enabled: !!token && !!id && activeTab === 'orders',
  });
  const { data: tradesData, isLoading: tradesLoading } = useQuery({
    queryKey: ['admin', 'user-trades', id, token],
    staleTime: 30_000,
    queryFn: () => adminFetch('/trading/trades', { token, params: { user_id: id, limit: '50' } }),
    enabled: !!token && !!id && activeTab === 'trades',
  });
  const { data: p2pData, isLoading: p2pLoading } = useQuery({
    queryKey: ['admin', 'user-p2p', id, token],
    staleTime: 30_000,
    queryFn: () => adminFetch('/p2p/orders', { token, params: { user_id: id, limit: '50' } }),
    enabled: !!token && !!id && activeTab === 'p2p',
  });

  const updateStatus = useMutation({
    mutationFn: ({ status }: { status: 'active' | 'suspended' | 'locked' }) =>
      updateUserStatus(token, id, { status, reason: `Admin action: ${status}` }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin', 'user', id] }); queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }); },
  });

  const balanceAdjust = useMutation({
    mutationFn: (payload: { currency_id: string; amount: string; type: 'credit' | 'debit'; reason: string }) =>
      adminFetch(`/users/${id}/balance-adjust`, { method: 'POST', token, body: payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'user-balances', id] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'user', id] });
      setShowBalanceAdjust(false);
      setAdjCurrency('');
      setAdjAmount('');
      setAdjType('credit');
      setAdjReason('');
      setAdjError('');
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message || 'Balance adjustment failed';
      setAdjError(msg);
    },
  });

  const handleSuspend  = useCallback(() => setConfirmAction({ action: 'suspended', label: 'Suspend' }), []);
  const handleBan      = useCallback(() => setConfirmAction({ action: 'locked',    label: 'Ban'     }), []);
  const handleActivate = useCallback(() => setConfirmAction({ action: 'active',    label: 'Reactivate' }), []);

  useAdminWs({
    onEvent: (event) => {
      if (!id) return;
      const payload = (event?.data ?? event?.payload) as { user_id?: string; userId?: string } | undefined;
      if ((payload?.user_id ?? payload?.userId) !== id) return;
      queryClient.invalidateQueries({ queryKey: ['admin', 'user', id] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'user-balances', id] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'user-stats', id] });
    },
  });

  const user = userData?.data?.user as Record<string, unknown> | undefined;
  const balances = userData?.data?.balances ?? balancesData?.data?.balances ?? [];
  const activity = (userData?.data?.activity as unknown[]) ?? [];
  const withdrawals = (withdrawalsData?.data as { withdrawals?: unknown[] })?.withdrawals ?? [];
  const deposits = (depositsData?.data as { deposits?: unknown[] } | undefined)?.deposits ?? [];

  const walletRows = useMemo(() => {
    const raw = balancesData?.data?.balances ?? balances;
    return (Array.isArray(raw) ? raw : []).map((b: Record<string, unknown>) => ({
      token_symbol: (b.token_symbol ?? b.symbol ?? '') as string,
      token_id: (b.token_id ?? b.currency_id) as string,
      available_balance: (b.available_balance ?? '0') as string,
      locked_balance: (b.locked_balance ?? '0') as string,
      total_balance: (b.total_balance ?? '0') as string,
      escrow_balance: (b.escrow_balance ?? '0') as string,
    }));
  }, [balancesData, balances]);

  const copyId = useCallback(() => {
    navigator.clipboard.writeText(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [id]);

  if (!id) return <div className="p-6"><p className="text-red-600">Invalid user ID</p></div>;

  if (userLoading || !user) {
    return (
      <div className="space-y-5">
        <button
          type="button"
          onClick={() => router.push('/users')}
          className="flex items-center gap-1.5 text-xs text-admin-primary hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Users
        </button>
        <div className="rounded-xl border border-admin-border bg-admin-card px-5 py-4">
          {userError ? (
            <p className="text-red-600">Failed to load user.</p>
          ) : (
            <div className="flex flex-wrap items-start gap-4">
              <div className="h-12 w-12 shrink-0 animate-pulse rounded-full bg-white/5" />
              <div className="min-w-0 flex-1 space-y-3">
                <div className="h-5 w-48 max-w-full animate-pulse rounded bg-white/5" />
                <div className="flex flex-wrap gap-2">
                  <div className="h-3 w-40 animate-pulse rounded bg-white/5" />
                  <div className="h-3 w-24 animate-pulse rounded bg-white/5" />
                  <div className="h-3 w-36 animate-pulse rounded bg-white/5" />
                </div>
                <div className="flex gap-2">
                  <div className="h-6 w-16 animate-pulse rounded bg-white/5" />
                  <div className="h-6 w-24 animate-pulse rounded bg-white/5" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || (user.username as string) || (user.email as string) || id.slice(0, 8);
  const email = (user.email as string) || '—';
  const status = ((user.status as string) ?? '').toLowerCase();
  const kycStatus = (user.kyc_status as string) ?? null;
  const kycLevel = (user.kyc_level as number) ?? 0;

  return (
    <AdminPageFrame title={name}>
    <div className="space-y-5">
      {/* Back + Breadcrumb */}
      <button onClick={() => router.push('/users')} className="flex items-center gap-1.5 text-xs text-admin-primary hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Users
      </button>

      {/* User Header */}
      <div className="rounded-xl border border-admin-border bg-admin-card">
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-admin-primary/10 text-admin-primary text-lg font-bold shrink-0">
              {(name[0] ?? '?').toUpperCase()}
            </div>
            <div>
              <h1 className="text-base font-semibold text-admin-text">{name}</h1>
              <div className="flex items-center gap-3 mt-1 text-xs text-admin-muted flex-wrap">
                <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{email}</span>
                <span className="flex items-center gap-1"><Globe className="h-3 w-3" />{(user.country_code as string) || '—'}</span>
                <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Joined {fmtShortDate(user.created_at as string)}</span>
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <StatusBadge status={displayStatus(user.status as string)} variant={status === 'active' ? 'success' : status === 'suspended' ? 'warning' : 'danger'} />
                {kycStatus === 'approved' ? (
                  <Badge variant="success" size="sm">KYC L{kycLevel} Verified</Badge>
                ) : kycStatus === 'pending' || kycStatus === 'under_review' ? (
                  <Badge variant="warning" size="sm">KYC L{kycLevel} Pending</Badge>
                ) : (
                  <Badge variant="default" size="sm">KYC: {kycStatus || 'None'}</Badge>
                )}
                <button onClick={copyId} className="flex items-center gap-1 text-[10px] text-admin-muted hover:text-admin-muted transition-colors" title="Copy User ID">
                  {copied ? <Check className="h-2.5 w-2.5 text-emerald-500" /> : <Copy className="h-2.5 w-2.5" />}
                  {id.slice(0, 8)}…
                </button>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => { setAdjError(''); setShowBalanceAdjust(true); }} icon={<DollarSign className="h-3.5 w-3.5" />}>Balance Adjust</Button>
            {status === 'suspended' || status === 'locked' ? (
              <Button variant="secondary" size="sm" onClick={handleActivate} icon={<Shield className="h-3.5 w-3.5" />}>Reactivate</Button>
            ) : null}
            {status !== 'suspended' && (
              <Button variant="secondary" size="sm" onClick={handleSuspend} icon={<ShieldOff className="h-3.5 w-3.5" />}>Suspend</Button>
            )}
            {status !== 'locked' && (
              <button onClick={handleBan} className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-950/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-950/30 transition-colors">
                <Ban className="h-3.5 w-3.5" /> Ban
              </button>
            )}
            <Button variant="secondary" size="sm" icon={<KeyRound className="h-3.5 w-3.5" />}
              onClick={() => { setTwoFaError(''); setShow2faReset(true); }}>
              Reset 2FA
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="rounded-xl border border-admin-border bg-admin-card">
        <div className="border-b border-admin-border overflow-x-auto">
          <nav className="flex gap-0 min-w-max px-1">
            {TABS.map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={cn('flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors whitespace-nowrap',
                  activeTab === tab.id ? 'border-admin-primary text-admin-primary' : 'border-transparent text-admin-muted hover:text-admin-muted')}>
                <tab.icon className="h-3 w-3" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-5">
          {/* Overview */}
          {activeTab === 'overview' && (
            <div className="space-y-5">
              {/* Stats strip */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <MiniStat label="Total Deposits"    value={fmtCurrency(statsData?.data?.total_deposits)}   icon={ArrowDownToLine} />
                <MiniStat label="Total Withdrawals" value={fmtCurrency(statsData?.data?.total_withdrawals)} icon={ArrowUpFromLine} />
                <MiniStat label="Total Trades"      value={statsData?.data?.total_trades ?? '0'}           icon={BarChart3} />
                <MiniStat label="30d Volume"        value={fmtCurrency(statsData?.data?.volume_30d)}       icon={TrendingUp} />
                <MiniStat label="P2P Orders"        value={statsData?.data?.p2p_orders_count ?? '0'}       icon={Repeat} />
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* Account info */}
                <div className="rounded-xl border border-admin-border/50 bg-white/[0.015] p-4">
                  <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-admin-muted">Account Info</p>
                  <div className="space-y-0.5">
                    <InfoRow label="User ID"       value={id}                                          mono />
                    <InfoRow label="Email Verified" value={(user.email_verified as boolean) ? '✓ Yes' : '✗ No'} />
                    <InfoRow label="Phone"          value={(user.phone as string) || '—'} />
                    <InfoRow label="Last Login"     value={fmtDate(user.last_login_at as string)} />
                    <InfoRow label="Tier Level"     value={String(user.tier_level ?? 0)} />
                    <InfoRow label="Total Wallets"  value={String(walletRows.length)} />
                  </div>
                </div>

                {/* Quick links */}
                <div className="rounded-xl border border-admin-border/50 bg-white/[0.015] p-4">
                  <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-admin-muted">Quick Links</p>
                  <div className="space-y-1">
                    {[
                      { label: 'Risk Timeline',        tab: 'risk-timeline' as TabId, icon: Shield },
                      { label: 'View Deposits',        tab: 'deposits'      as TabId, icon: ArrowDownToLine },
                      { label: 'View Withdrawals',     tab: 'withdrawals'   as TabId, icon: ArrowUpFromLine },
                      { label: 'Security Sessions',    tab: 'security'      as TabId, icon: Key },
                      { label: 'View API Keys',        tab: 'api-keys'      as TabId, icon: KeyRound },
                    ].map(({ label, tab, icon: Icon }) => (
                      <button key={tab} type="button" onClick={() => setActiveTab(tab)}
                        className="flex w-full items-center justify-between rounded-lg border border-admin-border/30 px-3 py-2 text-xs text-admin-muted hover:bg-white/[0.03] hover:text-admin-text transition-colors">
                        <span className="flex items-center gap-2"><Icon className="h-3.5 w-3.5" />{label}</span>
                        <ChevronRight className="h-3 w-3" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Tags panel */}
              <div className="rounded-xl border border-admin-border/50 bg-white/[0.015] p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Tag className="h-3.5 w-3.5 text-admin-muted" />
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">Internal Tags</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {PRESET_TAGS.map((tag) => {
                    const active = userTags.includes(tag);
                    return (
                      <button key={tag} type="button"
                        onClick={() => setUserTags((t) => active ? t.filter((x) => x !== tag) : [...t, tag])}
                        className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                          active
                            ? tag.includes('Risk') || tag.includes('Fraud') ? 'border-red-500/50 bg-red-950/20 text-red-400' : tag === 'VIP' || tag === 'Whale' ? 'border-indigo-500/50 bg-indigo-950/20 text-indigo-300' : 'border-amber-500/50 bg-amber-950/20 text-amber-400'
                            : 'border-admin-border/40 text-admin-muted hover:border-admin-border hover:text-admin-text')}>
                        {active ? '✓ ' : ''}{tag}
                      </button>
                    );
                  })}
                </div>
                {userTags.length > 0 && <p className="mt-2 text-[10px] text-admin-muted italic">These tags are local session notes — not persisted to the server.</p>}
              </div>

              {/* Admin Notes */}
              <div className="rounded-xl border border-admin-border/50 bg-white/[0.015] p-4">
                <div className="mb-3 flex items-center gap-2">
                  <StickyNote className="h-3.5 w-3.5 text-admin-muted" />
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">Admin Notes</p>
                </div>
                {savedNote && (
                  <div className="mb-3 rounded-lg border border-blue-500/20 bg-blue-950/10 px-3 py-2 text-xs text-blue-300 whitespace-pre-line">{savedNote}</div>
                )}
                <textarea value={adminNote} onChange={(e) => setAdminNote(e.target.value)} rows={3}
                  placeholder="Add internal notes about this user (not visible to the user)…"
                  className="w-full resize-none rounded-lg border border-admin-border/50 bg-white/[0.03] px-3 py-2 text-xs text-admin-text placeholder:text-admin-muted focus:outline-none focus:border-blue-500/40" />
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-[10px] text-admin-muted">Session-only — not stored in the database.</p>
                  <button type="button" onClick={() => { setSavedNote(adminNote); setAdminNote(''); }}
                    disabled={!adminNote.trim()}
                    className="rounded-lg border border-admin-border/50 px-3 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text disabled:opacity-30 transition-colors">
                    Save Note
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Wallets */}
          {activeTab === 'wallets' && <UserWalletTable balances={walletRows} isLoading={balancesLoading} />}

          {/* Orders */}
          {activeTab === 'orders' && (
            ordersLoading ? <LoadingTab /> :
            (() => { const orders = (ordersData?.data as { orders?: unknown[] })?.orders ?? []; return orders.length === 0 ? <EmptyTab message="No orders found." /> : (
              <TxTable headers={['Market', 'Side', 'Type', 'Price', 'Qty', 'Status', 'Time']} empty="No orders"
                rows={(orders as Array<Record<string, unknown>>).map((o) => [
                  <span key="m" className="font-medium">{String(o.symbol ?? o.market ?? '—')}</span>,
                  <Badge key="s" variant={(String(o.side ?? '')).toLowerCase() === 'buy' ? 'success' : 'danger'} size="sm">{String(o.side ?? '—')}</Badge>,
                  <span key="t" className="text-admin-muted">{String(o.type ?? o.order_type ?? '—')}</span>,
                  <span key="p" className="tabular-nums">{String(o.price ?? '—')}</span>,
                  <span key="q" className="tabular-nums">{String(o.quantity ?? o.amount ?? '—')}</span>,
                  <StatusBadge key="st" status={String(o.status ?? '—')} />,
                  <span key="d" className="text-admin-muted">{fmtShortDate(o.created_at as string)}</span>,
                ])} />
            );})()
          )}

          {/* Trades */}
          {activeTab === 'trades' && (
            tradesLoading ? <LoadingTab /> :
            (() => { const trades = (tradesData?.data as { trades?: unknown[] })?.trades ?? []; return trades.length === 0 ? <EmptyTab message="No trades found." /> : (
              <TxTable headers={['Market', 'Side', 'Price', 'Quantity', 'Fee', 'Time']} empty="No trades"
                rows={(trades as Array<Record<string, unknown>>).map((t) => [
                  <span key="m" className="font-medium">{String(t.symbol ?? t.market ?? '—')}</span>,
                  <Badge key="s" variant={String(t.side ?? '').toLowerCase() === 'buy' ? 'success' : 'danger'} size="sm">{String(t.side ?? '—')}</Badge>,
                  <span key="p" className="tabular-nums">{String(t.price ?? '—')}</span>,
                  <span key="q" className="tabular-nums">{String(t.quantity ?? t.amount ?? '—')}</span>,
                  <span key="f" className="tabular-nums text-admin-muted">{String(t.fee ?? '0')}</span>,
                  <span key="d" className="text-admin-muted">{fmtShortDate(t.created_at as string)}</span>,
                ])} />
            );})()
          )}

          {/* P2P */}
          {activeTab === 'p2p' && (
            p2pLoading ? <LoadingTab /> :
            (() => { const p2pOrders = (p2pData?.data as { orders?: unknown[] })?.orders ?? []; return p2pOrders.length === 0 ? <EmptyTab message="No P2P orders found." /> : (
              <TxTable headers={['Type', 'Asset', 'Amount', 'Fiat', 'Status', 'Time']} empty="No P2P orders"
                rows={(p2pOrders as Array<Record<string, unknown>>).map((o) => [
                  <Badge key="t" variant={String(o.type ?? '').toLowerCase() === 'buy' ? 'success' : 'danger'} size="sm">{String(o.type ?? '—')}</Badge>,
                  <span key="a" className="font-medium">{String(o.crypto_asset ?? o.asset ?? '—')}</span>,
                  <span key="am" className="tabular-nums">{String(o.crypto_amount ?? o.amount ?? '—')}</span>,
                  <span key="f" className="tabular-nums">{String(o.fiat_amount ?? '—')} {String(o.fiat_currency ?? '')}</span>,
                  <StatusBadge key="s" status={String(o.status ?? '—')} />,
                  <span key="d" className="text-admin-muted">{fmtShortDate(o.created_at as string)}</span>,
                ])} />
            );})()
          )}

          {/* Deposits */}
          {activeTab === 'deposits' && (
            <TxTable headers={['TX Hash', 'Asset', 'Amount', 'Status', 'Time']} empty="No deposits"
              rows={(deposits as Array<Record<string, unknown>>).map((d) => [
                <span key="h" className="font-mono text-[10px] text-admin-muted">{((d.tx_hash as string) ?? '—').slice(0, 16)}…</span>,
                <span key="a">{(d.token_symbol as string) ?? '—'}</span>,
                <span key="am" className="tabular-nums font-medium">{(d.amount as string) ?? '—'}</span>,
                <StatusBadge key="s" status={(d.status as string) ?? '—'} />,
                <span key="t" className="text-admin-muted">{fmtShortDate(d.created_at as string)}</span>,
              ])} />
          )}

          {/* Withdrawals */}
          {activeTab === 'withdrawals' && (
            <TxTable headers={['Asset', 'Amount', 'Address', 'Status', 'Time']} empty="No withdrawals"
              rows={(withdrawals as Array<Record<string, unknown>>).map((w) => [
                <span key="a">{((w.token_symbol ?? w.currency_symbol) as string) ?? '—'}</span>,
                <span key="am" className="tabular-nums font-medium">{(w.amount as string) ?? '—'}</span>,
                <span key="addr" className="font-mono text-[10px] text-admin-muted truncate max-w-[140px] inline-block">{((w.address ?? w.to_address) as string) ?? '—'}</span>,
                <StatusBadge key="s" status={(w.status as string) ?? '—'} />,
                <span key="t" className="text-admin-muted">{fmtShortDate(w.created_at as string)}</span>,
              ])} />
          )}

          {/* Activity */}
          {activeTab === 'activity' && (
            activity.length === 0 ? <EmptyTab message="No activity logs recorded." /> : (
              <div className="space-y-1.5">
                {(activity as Array<Record<string, unknown>>).map((a, i) => (
                  <div key={(a.id ?? i) as string} className="flex items-center justify-between rounded-lg border border-admin-border/60 px-4 py-2 text-xs">
                    <span className="font-medium text-admin-text">{(a.action ?? a.event_type ?? a.type) as string ?? 'Activity'}</span>
                    <span className="text-admin-muted">{fmtDate(a.created_at as string)}</span>
                  </div>
                ))}
              </div>
            )
          )}

          {/* Security */}
          {activeTab === 'security' && (
            securityLoading ? <LoadingTab /> :
            !securityData?.data?.sessions?.length ? <EmptyTab message="No active sessions." /> : (
              <TxTable headers={['Device', 'IP Address', 'Location', 'Last Login', 'Status']} empty=""
                rows={securityData.data.sessions.map((s) => [
                  <span key="d" className="font-medium text-admin-text">{s.device}</span>,
                  <span key="ip" className="font-mono text-[10px] text-admin-muted">{s.ip_address}</span>,
                  <span key="l">{s.location}</span>,
                  <span key="t" className="text-admin-muted">{fmtShortDate(s.last_login)}</span>,
                  <StatusBadge key="s" status={s.status} />,
                ])} />
            )
          )}

          {/* API Keys */}
          {activeTab === 'api-keys' && (
            apiKeysLoading ? <LoadingTab /> :
            !apiKeysData?.data?.api_keys?.length ? <EmptyTab message="No API keys configured." /> : (
              <TxTable headers={['Key', 'Permissions', 'Created', 'Last Used', 'IP Whitelist']} empty=""
                rows={apiKeysData.data.api_keys.map((k) => [
                  <span key="k" className="font-mono text-[10px] text-admin-muted">{k.key}</span>,
                  <span key="p">{k.permissions}</span>,
                  <span key="c" className="text-admin-muted">{fmtShortDate(k.created)}</span>,
                  <span key="u" className="text-admin-muted">{k.last_used === '—' ? '—' : fmtShortDate(k.last_used)}</span>,
                  <span key="ip" className="text-admin-muted">{k.ip_whitelist}</span>,
                ])} />
            )
          )}

          {/* Risk Timeline */}
          {activeTab === 'risk-timeline' && (
            riskTimelineLoading ? <LoadingTab /> :
            !riskTimelineData?.data?.events?.length ? <EmptyTab message="No risk timeline events." /> : (
              <div className="space-y-1.5">
                {riskTimelineData.data.events.map((ev, i) => (
                  <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-admin-border/60 px-4 py-2.5 text-xs">
                    <span className="font-medium text-admin-text">{ev.event_type}</span>
                    <span className="text-admin-muted">{fmtDate(ev.timestamp)}</span>
                    {ev.admin_action && <span className="w-full text-[10px] text-admin-muted">Admin: {ev.admin_action}</span>}
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      {/* Confirm Action Modal */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmAction(null)} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl border border-admin-border/60 bg-admin-card p-6 shadow-2xl">
            <div className={cn('mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border',
              confirmAction.action === 'locked' ? 'border-red-500/30 bg-red-950/20' : confirmAction.action === 'suspended' ? 'border-amber-500/30 bg-amber-950/20' : 'border-emerald-500/30 bg-emerald-950/20')}>
              {confirmAction.action === 'locked' ? <Ban className="h-6 w-6 text-red-400" /> : confirmAction.action === 'suspended' ? <ShieldOff className="h-6 w-6 text-amber-400" /> : <Shield className="h-6 w-6 text-emerald-400" />}
            </div>
            <h3 className="mb-1 text-center text-sm font-semibold text-admin-text">{confirmAction.label} User</h3>
            <p className="mb-5 text-center text-xs text-admin-muted">
              {confirmAction.action === 'locked' ? 'This will ban the user. They cannot login until unbanned.'
               : confirmAction.action === 'suspended' ? 'This will suspend the user. They can be reactivated.'
               : 'This will reactivate the user account.'}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmAction(null)}
                className="flex-1 rounded-xl border border-admin-border/50 py-2 text-xs font-medium text-admin-muted hover:text-admin-text transition-colors">
                Cancel
              </button>
              <button type="button" onClick={() => { updateStatus.mutate({ status: confirmAction.action }); setConfirmAction(null); }}
                className={cn('flex-1 rounded-xl py-2 text-xs font-semibold text-white transition-all',
                  confirmAction.action === 'locked' ? 'bg-red-600 hover:bg-red-500' : confirmAction.action === 'suspended' ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500')}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2FA Reset Modal */}
      {show2faReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !twoFaLoading && setShow2faReset(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl border border-admin-border/60 bg-admin-card p-6 shadow-2xl">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-amber-500/30 bg-amber-950/20">
              <KeyRound className="h-6 w-6 text-amber-400" />
            </div>
            <h3 className="mb-1 text-center text-sm font-semibold text-admin-text">Reset 2FA</h3>
            <p className="mb-2 text-center text-xs text-admin-muted">
              This will remove the user&apos;s current 2FA device. They will be required to set up 2FA again on next login.
            </p>
            <p className="mb-5 text-center text-[10px] text-amber-400">This action is irreversible and will be recorded in the audit log.</p>
            {twoFaError && (
              <p className="mb-3 rounded-lg border border-red-500/25 bg-red-950/10 px-3 py-2 text-xs text-red-400">{twoFaError}</p>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => setShow2faReset(false)} disabled={twoFaLoading}
                className="flex-1 rounded-xl border border-admin-border/50 py-2 text-xs font-medium text-admin-muted hover:text-admin-text transition-colors disabled:opacity-40">
                Cancel
              </button>
              <button type="button" disabled={twoFaLoading}
                onClick={async () => {
                  setTwoFaLoading(true);
                  setTwoFaError('');
                  try {
                    await adminFetch(`/users/${id}/reset-2fa`, { method: 'POST', token, body: {} });
                    queryClient.invalidateQueries({ queryKey: ['admin', 'user', id] });
                    setShow2faReset(false);
                  } catch (e: unknown) {
                    setTwoFaError((e as { message?: string })?.message ?? 'Failed to reset 2FA. The endpoint may not be configured.');
                  } finally {
                    setTwoFaLoading(false);
                  }
                }}
                className="flex-1 rounded-xl bg-amber-600 py-2 text-xs font-semibold text-white hover:bg-amber-500 transition-all disabled:opacity-40">
                {twoFaLoading ? 'Processing…' : 'Confirm Reset'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Balance Adjustment Modal */}
      {showBalanceAdjust && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl border border-admin-border bg-admin-card shadow-xl">
            <div className="flex items-center justify-between border-b border-admin-border px-5 py-3">
              <h3 className="text-sm font-semibold text-admin-text">Balance Adjustment</h3>
              <button onClick={() => setShowBalanceAdjust(false)} className="text-admin-muted hover:text-admin-muted"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-admin-muted">Currency</label>
                <select
                  value={adjCurrency}
                  onChange={(e) => setAdjCurrency(e.target.value)}
                  className="w-full rounded-lg border border-admin-border bg-admin-card px-3 py-2 text-sm focus:border-admin-primary focus:outline-none"
                >
                  <option value="">Select currency…</option>
                  {walletRows.map((w) => (
                    <option key={w.token_id} value={w.token_id}>
                      {w.token_symbol} (avail: {w.available_balance})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-admin-muted">Amount</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={adjAmount}
                  onChange={(e) => setAdjAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm tabular-nums focus:border-admin-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-admin-muted">Type</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" name="adjType" checked={adjType === 'credit'} onChange={() => setAdjType('credit')} className="accent-emerald-500" />
                    <span className="text-emerald-400 font-medium">Credit (+)</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" name="adjType" checked={adjType === 'debit'} onChange={() => setAdjType('debit')} className="accent-red-500" />
                    <span className="text-red-400 font-medium">Debit (−)</span>
                  </label>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-admin-muted">
                  Reason (required, min 8 characters)
                </label>
                <textarea
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  rows={3}
                  minLength={8}
                  placeholder="Describe the reason for this adjustment (audit trail)…"
                  className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm focus:border-admin-primary focus:outline-none resize-none"
                />
              </div>
              {adjError && <p className="text-xs text-red-400 rounded-lg border border-red-500/25 bg-red-950/10 px-2.5 py-1.5">{adjError}</p>}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-admin-border px-5 py-3">
              <Button variant="secondary" size="sm" onClick={() => setShowBalanceAdjust(false)}>Cancel</Button>
              <Button
                size="sm"
                disabled={
                  !adjCurrency || !adjAmount || adjReason.trim().length < 8 || balanceAdjust.isPending
                }
                onClick={() => {
                  if (!adjCurrency || !adjAmount || adjReason.trim().length < 8) return;
                  balanceAdjust.mutate({ currency_id: adjCurrency, amount: adjAmount, type: adjType, reason: adjReason.trim() });
                }}
              >
                {balanceAdjust.isPending ? 'Processing…' : `Confirm ${adjType === 'credit' ? 'Credit' : 'Debit'}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
    </AdminPageFrame>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

function MiniStat({ label, value, icon: Icon }: { label: string; value: string | number; icon: React.ElementType }) {
  return (
    <div className="rounded-lg border border-admin-border bg-white/[0.02] px-3.5 py-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3 w-3 text-admin-muted" />
        <p className="text-[10px] text-admin-muted font-medium">{label}</p>
      </div>
      <p className="text-sm font-bold tabular-nums text-admin-text">{value}</p>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-admin-border/40">
      <span className="text-[10px] text-admin-muted font-medium uppercase tracking-wider">{label}</span>
      <span className={cn('text-xs text-admin-text', mono && 'font-mono text-[10px]')}>{value}</span>
    </div>
  );
}

function TxTable({ headers, rows, empty }: { headers: string[]; rows: React.ReactNode[][]; empty: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-admin-border bg-white/[0.02]">
            {headers.map((h) => (<th key={h} className="px-4 py-2 font-medium text-admin-muted">{h}</th>))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={headers.length} className="px-4 py-8 text-center text-admin-muted">{empty || 'No data'}</td></tr>
          ) : rows.map((cells, i) => (
            <tr key={i} className="border-b border-admin-border/50 hover:bg-white/5">
              {cells.map((cell, j) => (<td key={j} className="px-4 py-2">{cell}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyTab({ message }: { message: string }) {
  return (
    <div className="py-10 text-center">
      <Shield className="h-7 w-7 text-admin-muted/20 mx-auto mb-2" />
      <p className="text-xs text-admin-muted">{message}</p>
    </div>
  );
}

function LoadingTab() {
  return (
    <div className="space-y-3 py-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-3 w-24 animate-pulse rounded bg-white/5" />
          <div className="h-3 w-32 animate-pulse rounded bg-white/5" />
          <div className="h-3 w-16 animate-pulse rounded bg-white/5" />
        </div>
      ))}
    </div>
  );
}
