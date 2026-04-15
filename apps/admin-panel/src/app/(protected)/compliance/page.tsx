'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, ExternalLink, Download, AlertTriangle, ShieldCheck, RefreshCw, Calendar } from 'lucide-react';
import { adminFetch } from '@/lib/api';
import { downloadAnalyticsExport } from '@/lib/analytics-api';
import { useAdminAuthStore } from '@/store/auth';
import { cn } from '@/lib/cn';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { TableSkeleton } from '@/components/ui';

type AmlDashboard = Record<string, unknown>;

type RiskAlertRow = {
  id: string;
  user_id?: string;
  user_email?: string | null;
  alert_type?: string;
  type?: string;
  status?: string;
  details?: unknown;
  created_at?: string;
  amount?: number;
};

/* ── helpers ──────────────────────────────────────────────────────── */
function num(v: unknown): string {
  return typeof v === 'number' && !Number.isNaN(v) ? String(v) : '—';
}
function fmtRelative(s: string | undefined): string {
  if (!s) return '—';
  try {
    const diff = Date.now() - new Date(s).getTime();
    if (Math.abs(diff) < 60_000) return 'just now';
    if (diff > 0 && diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`;
    if (diff > 0 && diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return s; }
}

/* ── local primitives ─────────────────────────────────────────────── */
function KpiCard({
  label, value, loading, accent,
}: { label: string; value: string; loading: boolean; accent: string }) {
  return (
    <div className={cn('relative overflow-hidden rounded-2xl border bg-admin-card p-5', accent)}>
      <div className={cn('absolute inset-x-0 top-0 h-0.5 rounded-t-2xl',
        accent.includes('amber')   ? 'bg-amber-500' :
        accent.includes('red')     ? 'bg-red-500' :
        accent.includes('blue')    ? 'bg-blue-500' :
        accent.includes('slate')   ? 'bg-slate-400' : 'bg-emerald-500',
      )} />
      <p className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">{label}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums text-admin-text">
        {loading ? <span className="inline-block h-7 w-12 animate-pulse rounded-lg bg-white/[0.05]" /> : value}
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const s = (status ?? '').toLowerCase();
  return (
    <span className={cn(
      'inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold capitalize',
      (s === 'filed' || s === 'reported')  && 'border-emerald-500/30 bg-emerald-950/20 text-emerald-400',
      s === 'pending'   && 'border-amber-500/30 bg-amber-950/20 text-amber-400',
      s === 'reviewing' && 'border-blue-500/30 bg-blue-950/20 text-blue-400',
      s === 'closed'    && 'border-admin-border/50 bg-white/[0.04] text-admin-muted',
      !['filed','reported','pending','reviewing','closed'].includes(s)
        && 'border-admin-border/50 bg-white/[0.04] text-admin-muted',
    )}>
      {status ?? '—'}
    </span>
  );
}

function ExportBtn({
  label, exportKey, active, disabled, onClick,
}: { label: string; exportKey: string; active: string | null; disabled: boolean; onClick: () => void }) {
  const loading = active === exportKey;
  return (
    <button
      type="button" onClick={onClick} disabled={disabled || loading}
      className="flex items-center gap-1.5 rounded-xl border border-admin-border/50 bg-white/[0.02] px-3 py-2 text-xs font-medium text-admin-muted hover:text-admin-text hover:border-blue-500/30 disabled:opacity-40 transition-colors"
    >
      {loading
        ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        : <Download className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}

/* ── page ─────────────────────────────────────────────────────────── */
export default function CompliancePage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [exporting, setExporting] = useState<string | null>(null);

  const amlQ = useQuery({
    queryKey: ['admin', 'aml', 'dashboard', token],
    staleTime: 30_000,
    queryFn: () => adminFetch<AmlDashboard>('/aml/dashboard', { token }),
    enabled: !!token,
    retry: false,
    refetchInterval: 60_000,
  });

  const strQ = useQuery({
    queryKey: ['admin', 'compliance', 'str', token],
    staleTime: 30_000,
    queryFn: () => adminFetch<{ alerts: RiskAlertRow[]; total?: number }>('/risk/alerts', {
      token,
      // fetch all — backend may not support status filter; filter client-side
      params: { limit: 50 },
    }),
    enabled: !!token,
    retry: false,
    refetchInterval: 60_000,
  });

  const aml       = amlQ.data?.success ? amlQ.data.data : undefined;
  const amlFailed = amlQ.isError || amlQ.data?.success === false;
  const strFailed = strQ.isError || strQ.data?.success === false;
  const amlLoading= amlQ.isLoading || amlQ.isFetching;

  const strPending   = aml ? num(aml.str_pending   ?? aml.strPending  ?? aml.pending_str) : '—';
  const strSubmitted = aml ? num(aml.str_submitted  ?? aml.strSubmitted ?? aml.str_filed)  : '—';
  const kycRate      = aml ? num(aml.kyc_completion_rate ?? aml.kycCompletionRate ?? aml.kyc_completion_percent) : '—';
  const amlOpen      = aml ? num(aml.aml_alerts_open ?? aml.open_alerts ?? aml.alerts_open) : '—';
  const sanctions    = aml ? num(aml.sanctions_checks_24h ?? aml.sanctions_checks ?? aml.sanctions_hits) : '—';

  const strReports: RiskAlertRow[] = strQ.data?.success && strQ.data.data?.alerts ? strQ.data.data.alerts : [];
  const strPendingCount = strReports.filter((r) => {
    const s = (r.status ?? 'pending').toLowerCase();
    return s !== 'filed' && s !== 'reported' && s !== 'closed';
  }).length;

  function alertAmount(r: RiskAlertRow): number {
    const d = r.details;
    if (d && typeof d === 'object' && 'amount' in d) {
      const v = (d as { amount?: unknown }).amount;
      return typeof v === 'number' ? v : Number(v) || 0;
    }
    return Number(r.amount ?? 0) || 0;
  }

  const runExport = async (key: string, fn: () => Promise<void>) => {
    setExporting(key);
    try { await fn(); } catch { /* download failed */ } finally { setExporting(null); }
  };

  return (
    <AdminPageFrame
      title="Compliance & Reporting"
      description="AML compliance metrics, STR reports, and regulatory filing tools."
      status="active"
      error={null}
      quickActions={
        <button
          type="button"
          onClick={() => { void queryClient.invalidateQueries({ queryKey: ['admin', 'aml'] }); void queryClient.invalidateQueries({ queryKey: ['admin', 'compliance'] }); }}
          disabled={amlLoading}
          className="flex items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text disabled:opacity-40 transition-colors"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', amlLoading && 'animate-spin')} /> Refresh
        </button>
      }
    >

      {/* AML load error banner */}
      {amlFailed && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-950/10 p-4">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-300">AML dashboard unavailable</p>
            <p className="text-xs text-amber-300/70 mt-0.5">
              Stats may show placeholders. The AML service may be down or the endpoint is not configured.
            </p>
          </div>
          <button type="button" onClick={() => amlQ.refetch()}
            className="ml-auto flex items-center gap-1 rounded-lg border border-amber-500/25 bg-amber-950/15 px-2.5 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-950/25">
            <RefreshCw className="h-3 w-3" /> Retry
          </button>
        </div>
      )}

      {/* ── KPI strip (5 cards) ──────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="KYC Completion Rate"   value={kycRate === '—' ? kycRate : `${kycRate}%`} loading={amlLoading && !amlFailed} accent="border-emerald-500/20" />
        <KpiCard label="Open AML Cases"        value={amlOpen}      loading={amlLoading && !amlFailed} accent="border-red-500/20" />
        <KpiCard label="STR Pending Review"    value={strPending}   loading={amlLoading && !amlFailed} accent="border-amber-500/20" />
        <KpiCard label="STR Submitted"         value={strSubmitted} loading={amlLoading && !amlFailed} accent="border-blue-500/20" />
        <KpiCard label="Sanctions / Screening" value={sanctions}    loading={amlLoading && !amlFailed} accent="border-slate-500/20" />
      </div>

      {/* ── STR Reports table ─────────────────────────────────────────── */}
      <div className="rounded-2xl border border-admin-border/50 bg-admin-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-admin-border/30 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <FileText className="h-4 w-4 text-admin-muted" />
            <p className="text-sm font-semibold text-admin-text">Suspicious Transaction Reports (STR)</p>
            {strPendingCount > 0 && (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-black">
                {strPendingCount}
              </span>
            )}
          </div>
          <span className="rounded-full border border-admin-border/50 bg-white/[0.02] px-2.5 py-0.5 text-[10px] font-semibold uppercase text-admin-muted tracking-wide">
            Regulatory
          </span>
        </div>

        {strFailed && (
          <div className="mx-5 mt-4 flex items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-950/10 p-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
            <p className="text-xs text-red-300/80">
              STR list could not be loaded. Check that the risk service is running.
            </p>
          </div>
        )}

        <div className="p-2">
          {strQ.isLoading ? (
            <TableSkeleton rows={5} cols={6} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-admin-border/50 bg-white/[0.015]">
                    {['Report ID', 'User', 'Type', 'Amount', 'Status', 'Filed'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-admin-muted">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-admin-border/30">
                  {strReports.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-14 text-center">
                        <div className="flex flex-col items-center gap-2 text-admin-muted">
                          <ShieldCheck className="h-8 w-8 opacity-15" />
                          <p className="text-sm">No STR reports found</p>
                          <p className="text-xs opacity-60">Reports appear here when alerts are escalated to STR status.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    strReports.map((r) => {
                      const st = (r.status ?? 'pending').toLowerCase();
                      const amt = alertAmount(r);
                      return (
                        <tr key={r.id} className={cn(
                          'transition-colors hover:bg-white/[0.025]',
                          st === 'pending' && 'bg-amber-950/[0.04]',
                        )}>
                          <td className="px-4 py-3.5 whitespace-nowrap font-mono text-xs text-admin-muted">
                            {r.id?.slice(0, 8)}…
                          </td>
                          <td className="px-4 py-3.5 text-sm text-admin-text max-w-[160px] truncate">
                            {r.user_email ?? r.user_id ?? '—'}
                          </td>
                          <td className="px-4 py-3.5 text-sm capitalize text-admin-text">
                            {(r.type ?? r.alert_type ?? '—').replace(/_/g, ' ')}
                          </td>
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <span className={cn('font-mono text-sm tabular-nums', amt > 10000 ? 'font-bold text-amber-400' : 'text-admin-text')}>
                              ${amt.toLocaleString()}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <StatusPill status={r.status ?? 'pending'} />
                          </td>
                          <td className="px-4 py-3.5 text-sm text-admin-muted whitespace-nowrap">
                            {fmtRelative(r.created_at)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Report generation ─────────────────────────────────────────── */}
      <div className="rounded-2xl border border-admin-border/50 bg-admin-card p-5">
        <p className="mb-1 text-sm font-semibold text-admin-text">Report Generation</p>
        <p className="mb-4 text-xs text-admin-muted">Download regulatory-grade exports. Files are generated from live data at the time of download.</p>
        <div className="flex flex-wrap gap-2">
          <ExportBtn label="Compliance Report (CSV)"  exportKey="compliance" active={exporting} disabled={!token}
            onClick={() => runExport('compliance', () => downloadAnalyticsExport(token, 'aml-alerts', 'csv'))} />
          <ExportBtn label="Transaction Report (CSV)" exportKey="trading"    active={exporting} disabled={!token}
            onClick={() => runExport('trading', () => downloadAnalyticsExport(token, 'trading', 'csv'))} />
          <ExportBtn label="User Audit (JSON)"        exportKey="audit"      active={exporting} disabled={!token}
            onClick={() => runExport('audit', () => downloadAnalyticsExport(token, 'users', 'json'))} />
        </div>
      </div>

      {/* ── Regulatory calendar ──────────────────────────────────────── */}
      <div className="rounded-2xl border border-admin-border/50 bg-admin-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <Calendar className="h-4 w-4 text-admin-muted" />
          <p className="text-sm font-semibold text-admin-text">Regulatory Calendar</p>
        </div>
        <div className="space-y-2">
          {[
            { freq: 'Monthly',   task: 'STR Filing Deadline',       desc: 'Submit all pending STRs to regulatory authority',                    color: 'border-red-500/20 bg-red-950/10 text-red-400' },
            { freq: 'Quarterly', task: 'Compliance Report',          desc: 'Generate and submit quarterly AML compliance report',                color: 'border-amber-500/20 bg-amber-950/10 text-amber-400' },
            { freq: 'Annually',  task: 'Risk Assessment',            desc: 'Complete annual money laundering risk assessment',                   color: 'border-blue-500/20 bg-blue-950/10 text-blue-400' },
            { freq: 'Ongoing',   task: 'Sanctions Screening',        desc: 'Continuous screening against OFAC / EU / UN sanctions lists',       color: 'border-emerald-500/20 bg-emerald-950/10 text-emerald-400' },
          ].map((item) => (
            <div key={item.task} className="flex items-start gap-3 rounded-xl border border-admin-border/40 p-3">
              <span className={cn('mt-0.5 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide shrink-0', item.color)}>
                {item.freq}
              </span>
              <div>
                <p className="text-sm font-medium text-admin-text">{item.task}</p>
                <p className="text-xs text-admin-muted">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-admin-muted/60">Typical filing windows vary by jurisdiction. Use internal policy alongside these common anchors.</p>
      </div>

      {/* ── Related consoles ─────────────────────────────────────────── */}
      <div className="rounded-2xl border border-admin-border/50 bg-admin-card p-5">
        <p className="mb-3 text-sm font-semibold text-admin-text">Related Consoles</p>
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'Risk & AML',    href: '/risk' },
            { label: 'KYC Queue',     href: '/kyc' },
            { label: 'Audit Logs',    href: '/audit/config' },
          ].map(({ label, href }) => (
            <Link key={href} href={href}
              className="inline-flex items-center gap-1.5 rounded-xl border border-admin-border/50 bg-white/[0.02] px-3 py-2 text-xs font-medium text-admin-muted hover:text-admin-text hover:border-blue-500/30 hover:bg-blue-950/10 transition-colors">
              {label} <ExternalLink className="h-3 w-3" />
            </Link>
          ))}
        </div>
      </div>
    </AdminPageFrame>
  );
}
