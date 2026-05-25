'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  getRiskDashboard,
  getRiskAlerts,
  getRiskSuspicious,
  getRiskHighRiskUsers,
  getRiskSanctions,
  downloadRiskExport,
  updateAmlAlertStatus,
  escalateAmlAlertToStr,
  freezeAccountFromAlert,
  type AmlAlertRow,
  type HighRiskUserRow,
  type SanctionRow,
} from '@/lib/risk-api';
import { exportStandardCsv, exportStandardJson, type StandardExportRow } from '@/lib/export-utils';
import { AmlAlertsTable } from '@/components/risk/AmlAlertsTable';
import { AlertActionModal, type AlertActionType } from '@/components/risk/AlertActionModal';
import { HighRiskUsersTable } from '@/components/risk/HighRiskUsersTable';
import { RiskDistributionCards } from '@/components/risk/RiskDistributionCards';
import { SanctionsTable } from '@/components/risk/SanctionsTable';
import { ProtectedAction } from '@/components/rbac/ProtectedAction';
import { useAdminWs } from '@/hooks/useAdminWs';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { cn } from '@/lib/cn';
import {
  AlertTriangle, Users, Activity, FileText,
  Settings, Download, ChevronDown, Sliders, Zap,
  RefreshCw, Search, X, Fish, Gauge, TrendingUp, ShieldOff,
} from 'lucide-react';

/* ── tiny local primitives ──────────────────────────────────────────── */
function KpiCard({
  label, value, icon: Icon, accent, alert = false,
}: { label: string; value: number | string; icon: React.ElementType; accent: string; alert?: boolean }) {
  return (
    <div className={cn('relative overflow-hidden rounded-2xl border bg-admin-card p-5 transition-all', accent)}>
      <div className={cn('absolute inset-x-0 top-0 h-0.5 rounded-t-2xl', accent.includes('red') ? 'bg-red-500' : accent.includes('amber') ? 'bg-amber-500' : accent.includes('orange') ? 'bg-orange-500' : 'bg-blue-500')} />
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">{label}</p>
          <p className={cn('mt-2 text-3xl font-bold tabular-nums', alert ? 'text-red-400' : 'text-admin-text')}>
            {value ?? '—'}
          </p>
        </div>
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border',
          accent.includes('red')    && 'border-red-500/25 bg-red-950/20 text-red-400',
          accent.includes('amber')  && 'border-amber-500/25 bg-amber-950/20 text-amber-400',
          accent.includes('orange') && 'border-orange-500/25 bg-orange-950/20 text-orange-400',
          accent.includes('slate')  && 'border-slate-500/25 bg-slate-950/20 text-slate-400',
        )}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {alert && (
        <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wide text-red-400">Action required</p>
      )}
    </div>
  );
}

function SuspiciousCard({
  label, value, unit = '', icon: Icon, accent,
}: { label: string; value: number | string; unit?: string; icon: React.ElementType; accent: string }) {
  const isAlert = typeof value === 'number' && value > 0;
  return (
    <div className={cn('rounded-2xl border bg-admin-card p-5', isAlert ? accent : 'border-admin-border/50')}>
      <div className="flex items-center gap-2 text-admin-muted">
        <Icon className="h-4 w-4" />
        <p className="text-xs font-medium">{label}</p>
      </div>
      <p className={cn('mt-3 text-2xl font-bold tabular-nums', isAlert ? (accent.includes('red') ? 'text-red-400' : 'text-amber-400') : 'text-admin-text')}>
        {value ?? 0}{unit}
      </p>
    </div>
  );
}

function Pager({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  const pages = Array.from({ length: Math.min(5, total) }, (_, i) => {
    if (total <= 5) return i + 1;
    const half = 2;
    let start = Math.max(1, Math.min(page - half, total - 4));
    return start + i;
  });
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-admin-border/50 text-admin-muted hover:text-admin-text disabled:opacity-30 text-xs">
        ‹
      </button>
      {pages.map((p) => (
        <button key={p} type="button" onClick={() => onChange(p)}
          className={cn('flex h-7 min-w-[28px] items-center justify-center rounded-lg border px-1.5 text-xs font-semibold transition-all',
            p === page ? 'border-blue-500/50 bg-blue-950/20 text-blue-300' : 'border-admin-border/50 text-admin-muted hover:text-admin-text hover:bg-white/[0.03]')}>
          {p}
        </button>
      ))}
      <button type="button" disabled={page >= total} onClick={() => onChange(page + 1)}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-admin-border/50 text-admin-muted hover:text-admin-text disabled:opacity-30 text-xs">
        ›
      </button>
    </div>
  );
}
/* ── page ────────────────────────────────────────────────────────────── */
export default function RiskPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();

  const [alertsPage,    setAlertsPage]    = useState(1);
  const [alertsStatus,  setAlertsStatus]  = useState('all');
  const [alertsSeverity,setAlertsSeverity]= useState('all');
  const [alertsSearch,  setAlertsSearch]  = useState('');
  const [alertModal,    setAlertModal]    = useState<{ action: AlertActionType; alert: AmlAlertRow | null } | null>(null);
  const [exportDropdown,setExportDropdown]= useState(false);
  const [exporting,     setExporting]     = useState(false);
  const [liveFlash,     setLiveFlash]     = useState(false);
  const [lastRefresh,   setLastRefresh]   = useState<Date | null>(null);

  useEffect(() => { setAlertsPage(1); }, [alertsStatus, alertsSeverity, alertsSearch]);

  const { data: dashboardData, isFetching: dashFetching, isError: dashIsError, error: dashError, refetch: refetchAll } = useQuery({
    queryKey: ['admin', 'risk', token],
    staleTime: 30_000,
    queryFn: () => getRiskDashboard(token),
    enabled: !!token,
    refetchInterval: 30_000,
  });

  const { data: suspiciousData, isError: suspiciousIsError, error: suspiciousError, refetch: refetchSuspicious } = useQuery({
    queryKey: ['admin', 'risk', 'suspicious', token],
    staleTime: 30_000,
    queryFn: () => getRiskSuspicious(token),
    enabled: !!token,
    refetchInterval: 30_000,
  });

  const { data: alertsData, isLoading: alertsLoading, isFetching: alertsFetching, isError: alertsIsError, error: alertsError, refetch: refetchAlerts } = useQuery({
    queryKey: ['admin', 'risk', 'alerts', token, alertsPage, alertsStatus, alertsSeverity],
    queryFn: () => getRiskAlerts(token, {
      limit: 20,
      offset: (alertsPage - 1) * 20,
      status:   alertsStatus   === 'all' ? undefined : alertsStatus,
      severity: alertsSeverity === 'all' ? undefined : alertsSeverity,
    }),
    enabled: !!token,
    refetchInterval: 30_000,
  });

  const { data: highRiskData, isLoading: highRiskLoading, isError: highRiskIsError, error: highRiskError, refetch: refetchHighRisk } = useQuery({
    queryKey: ['admin', 'risk', 'high-risk-users', token],
    staleTime: 30_000,
    queryFn: () => getRiskHighRiskUsers(token, { limit: 50 }),
    enabled: !!token,
    refetchInterval: 60_000,
  });

  const { data: sanctionsData, isLoading: sanctionsLoading, isError: sanctionsIsError, error: sanctionsError, refetch: refetchSanctions } = useQuery({
    queryKey: ['admin', 'risk', 'sanctions', token],
    staleTime: 30_000,
    queryFn: () => getRiskSanctions(token, { limit: 50 }),
    enabled: !!token,
  });

  useAdminWs({
    onEvent: (ev) => {
      const t = (ev?.type as string) ?? '';
      if (['aml_alert_triggered','suspicious_trade','large_withdrawal','sanction_detected'].includes(t)) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'risk'] });
        setLiveFlash(true);
        setLastRefresh(new Date());
        setTimeout(() => setLiveFlash(false), 2000);
      }
    },
  });

  const dashboard  = dashboardData?.data;
  const suspicious = suspiciousData?.data;

  const alertsPayload   = alertsData?.data;
  let   alertsRaw       = (alertsPayload?.alerts ?? []) as AmlAlertRow[];
  if (alertsSearch.trim()) {
    const q = alertsSearch.toLowerCase();
    alertsRaw = alertsRaw.filter((a) =>
      a.user_email?.toLowerCase().includes(q) ||
      a.alert_type?.toLowerCase().includes(q) ||
      a.id.toLowerCase().includes(q)
    );
  }
  const alertsTotal      = alertsPayload?.total ?? 0;
  const alertsTotalPages = Math.ceil(alertsTotal / 20) || 1;
  const highRiskUsers    = (highRiskData?.data?.users   ?? []) as HighRiskUserRow[];
  const sanctions        = (sanctionsData?.data?.items  ?? []) as SanctionRow[];

  /* export */
  const handleExport = async (type: 'aml-alerts' | 'str-reports' | 'suspicious-trades', format: 'csv' | 'json') => {
    setExporting(true);
    setExportDropdown(false);
    await downloadRiskExport(token, type, format);
    setExporting(false);
  };

  /* mutations */
  const updateStatusMutation = useMutation({
    mutationFn: ({ alertId, status, note }: { alertId: string; status: string; note?: string }) =>
      updateAmlAlertStatus(token, alertId, { status, note }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin', 'risk'] }); setAlertModal(null); },
  });

  const escalateMutation = useMutation({
    mutationFn: (alertId: string) => escalateAmlAlertToStr(token, alertId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin', 'risk'] }); setAlertModal(null); },
  });

  const freezeMutation = useMutation({
    mutationFn: ({ alertId, reason }: { alertId: string; reason?: string }) =>
      freezeAccountFromAlert(token, alertId, { reason }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin', 'risk'] }); setAlertModal(null); },
  });

  const handleAlertActionConfirm = (payload: { note?: string; reason?: string }) => {
    const { action, alert } = alertModal ?? {};
    if (!alert) return;
    if (action === 'review')   updateStatusMutation.mutate({ alertId: alert.id, status: 'reviewing', note: payload.note });
    else if (action === 'close')    updateStatusMutation.mutate({ alertId: alert.id, status: 'closed',    note: payload.note });
    else if (action === 'escalate') escalateMutation.mutate(alert.id);
    else if (action === 'freeze')   freezeMutation.mutate({ alertId: alert.id, reason: payload.reason });
  };

  const isActionLoading = updateStatusMutation.isPending || escalateMutation.isPending || freezeMutation.isPending;
  const openCount       = dashboard?.open_aml_alerts ?? 0;
  const pageError =
    (dashIsError && (dashError instanceof Error ? dashError.message : 'Failed to load risk dashboard.')) ||
    (suspiciousIsError && (suspiciousError instanceof Error ? suspiciousError.message : 'Failed to load suspicious trades.')) ||
    (alertsIsError && (alertsError instanceof Error ? alertsError.message : 'Failed to load alerts.')) ||
    (highRiskIsError && (highRiskError instanceof Error ? highRiskError.message : 'Failed to load high-risk users.')) ||
    (sanctionsIsError && (sanctionsError instanceof Error ? sanctionsError.message : 'Failed to load sanctions data.')) ||
    null;

  return (
    <AdminPageFrame
      title="Risk & AML"
      description="Monitor AML alerts, suspicious trading, and high-risk users."
      status="active"
      error={pageError}
      onRetry={pageError ? () => {
        void refetchAll();
        void refetchSuspicious();
        void refetchAlerts();
        void refetchHighRisk();
        void refetchSanctions();
      } : undefined}
      quickActions={
        <>
          {/* Live badge */}
          <div className="flex items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5">
            <span className={cn('h-2 w-2 rounded-full', liveFlash ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500 animate-pulse')} />
            <span className="text-xs font-medium text-admin-muted">LIVE</span>
          </div>

          {/* Refresh */}
          <button type="button"
            onClick={() => { void queryClient.invalidateQueries({ queryKey: ['admin', 'risk'] }); setLastRefresh(new Date()); }}
            disabled={dashFetching}
            className="flex items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text disabled:opacity-40 transition-colors">
            <RefreshCw className={cn('h-3.5 w-3.5', dashFetching && 'animate-spin')} />
            Refresh
          </button>

          <Link href="/risk/settings">
            <button type="button" className="flex items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text transition-colors">
              <Settings className="h-3.5 w-3.5" /> Risk rules
            </button>
          </Link>
          <Link href="/risk/automation">
            <button type="button" className="flex items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text transition-colors">
              <Zap className="h-3.5 w-3.5" /> Automation
            </button>
          </Link>
          <Link href="/risk/severity-settings">
            <button type="button" className="flex items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text transition-colors">
              <Sliders className="h-3.5 w-3.5" /> Severity
            </button>
          </Link>

          {/* Export dropdown */}
          <div className="relative">
            <ProtectedAction permission="risk:export" fallback="disabled">
              <button type="button"
                onClick={() => setExportDropdown((v) => !v)}
                disabled={exporting}
                className="flex items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text disabled:opacity-40 transition-colors">
                <Download className="h-3.5 w-3.5" />
                {exporting ? 'Exporting…' : 'Export'}
                <ChevronDown className={cn('h-3 w-3 transition-transform', exportDropdown && 'rotate-180')} />
              </button>
            </ProtectedAction>
            {exportDropdown && (
              <div className="absolute right-0 top-full z-20 mt-1.5 w-52 rounded-xl border border-admin-border/60 bg-admin-card py-1.5 shadow-xl">
                {[
                  { label: 'AML Alerts', type: 'aml-alerts' as const },
                  { label: 'STR Reports', type: 'str-reports' as const },
                  { label: 'Suspicious Trades', type: 'suspicious-trades' as const },
                ].map(({ label, type }) => (
                  <div key={type}>
                    <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-admin-muted">{label}</p>
                    <button type="button" onClick={() => handleExport(type, 'csv')}  className="block w-full px-3 py-1.5 text-left text-xs text-admin-text hover:bg-white/[0.03]">CSV</button>
                    <button type="button" onClick={() => handleExport(type, 'json')} className="block w-full px-3 py-1.5 text-left text-xs text-admin-text hover:bg-white/[0.03]">JSON</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      }
    >
      {/* ── KPI strip ────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Open AML Alerts"   value={openCount}                          icon={AlertTriangle} accent="border-amber-500/20"  alert={openCount > 0} />
        <KpiCard label="High Risk Users"   value={dashboard?.high_risk_users   ?? 0}  icon={Users}         accent="border-red-500/20" />
        <KpiCard label="Suspicious Trades" value={dashboard?.suspicious_trades ?? 0}  icon={Activity}      accent="border-orange-500/20" />
        <KpiCard label="STR Reports"       value={dashboard?.str_reports       ?? 0}  icon={FileText}      accent="border-slate-500/20" />
      </div>

      {/* ── Risk distribution ─────────────────────────────────────────── */}
      <RiskDistributionCards distribution={dashboard?.risk_distribution} />

      {/* ── Suspicious Trading ────────────────────────────────────────── */}
      <div className="rounded-2xl border border-admin-border/50 bg-admin-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-admin-text">Suspicious Trading Detection</p>
            <p className="text-xs text-admin-muted">Real-time anomaly metrics across all markets</p>
          </div>
          <span className="flex items-center gap-1.5 rounded-full border border-blue-500/20 bg-blue-950/10 px-2.5 py-1 text-[10px] font-semibold text-blue-400">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
            SCANNING
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SuspiciousCard label="Whale Trades (24h)"          value={suspicious?.whale_trades              ?? 0} icon={Fish}         accent="border-amber-500/30 bg-amber-950/[0.07]" />
          <SuspiciousCard label="Rapid Orders (5m)"           value={suspicious?.rapid_orders              ?? 0} icon={TrendingUp}   accent="border-orange-500/30 bg-orange-950/[0.07]" />
          <SuspiciousCard label="Order Cancel Rate"           value={suspicious?.order_cancel_rate         ?? 0} unit="%" icon={Gauge} accent="border-red-500/30 bg-red-950/[0.07]" />
          <SuspiciousCard label="Price Manipulation Alerts"   value={suspicious?.price_manipulation_alerts ?? 0} icon={ShieldOff}    accent="border-red-500/30 bg-red-950/[0.07]" />
        </div>
      </div>

      {/* ── Sanction Activity ────────────────────────────────────────── */}
      <div className="rounded-2xl border border-admin-border/50 bg-admin-card">
        <div className="flex items-center justify-between px-5 py-4 border-b border-admin-border/30">
          <div>
            <p className="text-sm font-semibold text-admin-text">Sanction Activity</p>
            <p className="text-xs text-admin-muted">Addresses flagged against global sanctions lists</p>
          </div>
          {sanctions.length > 0 && (
            <span className="rounded-full border border-red-500/25 bg-red-950/10 px-2.5 py-0.5 text-xs font-semibold text-red-400">
              {sanctions.length} flagged
            </span>
          )}
        </div>
        <div className="p-2">
          {sanctionsLoading ? (
            <div className="py-8 text-center text-sm text-admin-muted">Loading…</div>
          ) : (
            <SanctionsTable rows={sanctions} />
          )}
        </div>
      </div>

      {/* ── AML Alerts ───────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-admin-border/50 bg-admin-card">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-admin-border/30 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <p className="text-sm font-semibold text-admin-text">AML Alerts</p>
            {openCount > 0 && (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-black">
                {openCount}
              </span>
            )}
            {alertsFetching && <RefreshCw className="h-3.5 w-3.5 animate-spin text-admin-muted" />}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-admin-muted" />
              <input
                type="text"
                placeholder="Search alerts…"
                value={alertsSearch}
                onChange={(e) => setAlertsSearch(e.target.value)}
                className="h-8 w-44 rounded-lg border border-admin-border/50 bg-white/[0.03] pl-8 pr-8 text-xs text-admin-text placeholder:text-admin-muted focus:outline-none focus:border-blue-500/40"
              />
              {alertsSearch && (
                <button type="button" onClick={() => setAlertsSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-admin-muted hover:text-admin-text">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {/* Status filter */}
            <select
              value={alertsStatus}
              onChange={(e) => setAlertsStatus(e.target.value)}
              className="h-8 rounded-lg border border-admin-border/50 bg-admin-card px-2 text-xs text-admin-text focus:outline-none focus:border-blue-500/40"
            >
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="reviewing">Reviewing</option>
              <option value="closed">Closed</option>
              <option value="reported">Reported</option>
            </select>
            {/* Severity filter */}
            <select
              value={alertsSeverity}
              onChange={(e) => setAlertsSeverity(e.target.value)}
              className="h-8 rounded-lg border border-admin-border/50 bg-admin-card px-2 text-xs text-admin-text focus:outline-none focus:border-blue-500/40"
            >
              <option value="all">All severities</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            {/* Export */}
            <ProtectedAction permission="risk:export" fallback="disabled">
              <button type="button"
                onClick={() => { const rows: StandardExportRow[] = alertsRaw.map((a) => ({ timestamp: a.created_at ?? '', type: a.alert_type, service: 'risk', admin: '', details: [a.severity, a.status].join(' ') })); exportStandardCsv(rows, 'risk_alerts'); }}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 text-xs font-medium text-admin-muted hover:text-admin-text transition-colors">
                CSV
              </button>
            </ProtectedAction>
            <ProtectedAction permission="risk:export" fallback="disabled">
              <button type="button"
                onClick={() => { const rows: StandardExportRow[] = alertsRaw.map((a) => ({ timestamp: a.created_at ?? '', type: a.alert_type, service: 'risk', admin: '', details: [a.severity, a.status].join(' ') })); exportStandardJson(rows, 'risk_alerts'); }}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 text-xs font-medium text-admin-muted hover:text-admin-text transition-colors">
                JSON
              </button>
            </ProtectedAction>
          </div>
        </div>

        {/* Table body */}
        <div className="p-2">
          {alertsLoading ? (
            <div className="py-10 text-center text-sm text-admin-muted">Loading alerts…</div>
          ) : (
            <AmlAlertsTable
              rows={alertsRaw}
              onReview={(row)   => setAlertModal({ action: 'review',   alert: row })}
              onClose={(row)    => setAlertModal({ action: 'close',    alert: row })}
              onEscalate={(row) => setAlertModal({ action: 'escalate', alert: row })}
              onFreeze={(row)   => setAlertModal({ action: 'freeze',   alert: row })}
            />
          )}
        </div>

        {/* Pagination */}
        {alertsTotalPages > 1 && (
          <div className="flex items-center justify-between border-t border-admin-border/30 px-5 py-3">
            <span className="text-xs text-admin-muted">
              Page {alertsPage} of {alertsTotalPages} · {alertsTotal} total alerts
            </span>
            <Pager page={alertsPage} total={alertsTotalPages} onChange={setAlertsPage} />
          </div>
        )}
      </div>

      {/* ── High Risk Users ───────────────────────────────────────────── */}
      <div className="rounded-2xl border border-admin-border/50 bg-admin-card">
        <div className="flex items-center justify-between px-5 py-4 border-b border-admin-border/30">
          <div>
            <p className="text-sm font-semibold text-admin-text">High Risk Users</p>
            <p className="text-xs text-admin-muted">Users with elevated risk scores requiring attention</p>
          </div>
          {highRiskUsers.length > 0 && (
            <span className="rounded-full border border-red-500/25 bg-red-950/10 px-2.5 py-0.5 text-xs font-semibold text-red-400">
              {highRiskUsers.length} users
            </span>
          )}
        </div>
        <div className="p-2">
          {highRiskLoading ? (
            <div className="py-10 text-center text-sm text-admin-muted">Loading users…</div>
          ) : (
            <HighRiskUsersTable rows={highRiskUsers} />
          )}
        </div>
      </div>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      {lastRefresh && (
        <p className="text-center text-xs text-admin-muted">
          Last updated: {lastRefresh.toLocaleTimeString()}
        </p>
      )}

      {/* Modal */}
      <AlertActionModal
        open={!!alertModal}
        action={alertModal?.action ?? 'review'}
        alert={alertModal?.alert ?? null}
        onClose={() => setAlertModal(null)}
        onConfirm={handleAlertActionConfirm}
        isLoading={isActionLoading}
      />
    </AdminPageFrame>
  );
}
