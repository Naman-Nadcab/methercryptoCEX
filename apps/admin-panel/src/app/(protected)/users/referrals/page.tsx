'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { adminFetch } from '@/lib/api';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { cn } from '@/lib/cn';
import {
  Users2, TrendingUp, DollarSign, AlertTriangle,
  Search, RefreshCw, Eye, ChevronLeft, ChevronRight, X, Award,
} from 'lucide-react';

/* ── types ──────────────────────────────────────────────────────────── */
interface ReferralRow {
  referrer_id: string;
  referrer_email: string | null;
  referrer_name: string | null;
  referral_code: string | null;
  total_referrals: number;
  active_referrals: number;
  total_commission_usd: string;
  last_referral_at: string | null;
  is_suspicious: boolean;
}

/* ── helpers ────────────────────────────────────────────────────────── */
function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  try { return new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }); } catch { return '—'; }
}
function fmtRelative(v: string | null | undefined): string {
  if (!v) return '—';
  try {
    const d = Date.now() - new Date(v).getTime();
    if (d < 60_000) return 'just now';
    if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
    if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
    if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)}d ago`;
    return fmtDate(v);
  } catch { return '—'; }
}
function fmtUSD(v: string | number | undefined | null): string {
  if (v === undefined || v === null) return '$0.00';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (Number.isNaN(n)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

/* ── atoms ──────────────────────────────────────────────────────────── */
function KpiCard({ label, value, icon: Icon, accent, alert }: {
  label: string; value: string | number; icon: React.ElementType; accent: string; alert?: boolean;
}) {
  return (
    <div className={cn('relative overflow-hidden rounded-2xl border bg-admin-card p-5', alert ? 'border-amber-500/30' : 'border-admin-border/50')}>
      <div className={cn('absolute inset-x-0 top-0 h-0.5 rounded-t-2xl',
        accent === 'indigo' ? 'bg-indigo-500' : accent === 'emerald' ? 'bg-emerald-500' : accent === 'amber' ? 'bg-amber-500' : 'bg-blue-500')} />
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">{label}</p>
          <p className={cn('mt-2 text-3xl font-bold tabular-nums', alert ? 'text-amber-400' : 'text-admin-text')}>{value}</p>
        </div>
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border',
          accent === 'indigo' ? 'border-indigo-500/25 bg-indigo-950/20 text-indigo-400' : accent === 'emerald' ? 'border-emerald-500/25 bg-emerald-950/20 text-emerald-400' : accent === 'amber' ? 'border-amber-500/25 bg-amber-950/20 text-amber-400' : 'border-blue-500/25 bg-blue-950/20 text-blue-400')}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function Pager({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  if (total <= 1) return null;
  const start = Math.max(1, Math.min(page - 2, total - 4));
  const pages = Array.from({ length: Math.min(5, total) }, (_, i) => start + i);
  return (
    <div className="flex items-center gap-1">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)} className="flex h-7 w-7 items-center justify-center rounded-lg border border-admin-border/50 text-admin-muted disabled:opacity-30 hover:text-admin-text">
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      {pages.map((p) => (
        <button key={p} onClick={() => onChange(p)}
          className={cn('flex h-7 min-w-[28px] items-center justify-center rounded-lg border px-1.5 text-xs font-semibold',
            p === page ? 'border-indigo-500/50 bg-indigo-950/20 text-indigo-300' : 'border-admin-border/50 text-admin-muted hover:text-admin-text')}>
          {p}
        </button>
      ))}
      <button disabled={page >= total} onClick={() => onChange(page + 1)} className="flex h-7 w-7 items-center justify-center rounded-lg border border-admin-border/50 text-admin-muted disabled:opacity-30 hover:text-admin-text">
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ── page ───────────────────────────────────────────────────────────── */
export default function ReferralsPage() {
  const token  = useAdminAuthStore((s) => s.accessToken);
  const router = useRouter();
  const [search,    setSearch]    = useState('');
  const [page,      setPage]      = useState(1);
  const [suspicious, setSuspicious] = useState(false);
  const pageSize = 20;

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'referrals', token, search, suspicious, page],
    staleTime: 30_000,
    queryFn: () => adminFetch<{ referrals: ReferralRow[]; total: number; stats: { total_referrers: number; total_referrals: number; total_commission_usd: string; suspicious_count: number } }>('/users/referrals', {
      token,
      params: {
        page,
        limit: pageSize,
        ...(search.trim() && { search: search.trim() }),
        ...(suspicious && { suspicious: 'true' }),
      },
    }),
    enabled: !!token,
    refetchInterval: 60_000,
  });

  const referrals = data?.data?.referrals ?? [];
  const stats     = data?.data?.stats;
  const total     = data?.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <AdminPageFrame
      title="Referrals"
      description="Track referral codes, commission payouts, and abuse patterns."
      status={stats?.suspicious_count ? 'warning' : 'active'}
      error={isError ? ((error as { message?: string })?.message ?? 'Referral data unavailable — endpoint may not be configured.') : null}
      onRetry={() => void refetch()}
      quickActions={
        <button type="button" onClick={() => refetch()} disabled={isFetching}
          className="flex items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text disabled:opacity-40 transition-colors">
          <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
        </button>
      }
    >
      {/* KPI strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Referrers"    value={stats?.total_referrers  ?? '—'} icon={Users2}      accent="indigo" />
        <KpiCard label="Total Referrals"    value={stats?.total_referrals  ?? '—'} icon={TrendingUp}   accent="blue" />
        <KpiCard label="Total Commission"   value={stats ? fmtUSD(stats.total_commission_usd) : '—'} icon={DollarSign} accent="emerald" />
        <KpiCard label="Suspicious Signals" value={stats?.suspicious_count ?? '—'} icon={AlertTriangle} accent="amber" alert={(stats?.suspicious_count ?? 0) > 0} />
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-admin-border/50 bg-admin-card">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-admin-border/30 px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-admin-muted" />
            <input type="text" placeholder="Search email, code…" value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="h-8 w-52 rounded-lg border border-admin-border/50 bg-white/[0.03] pl-8 pr-3 text-xs text-admin-text placeholder:text-admin-muted focus:outline-none focus:border-indigo-500/40" />
            {search && <button type="button" onClick={() => { setSearch(''); setPage(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-admin-muted"><X className="h-3 w-3" /></button>}
          </div>
          <button type="button"
            onClick={() => { setSuspicious((s) => !s); setPage(1); }}
            className={cn('flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
              suspicious ? 'border-amber-500/40 bg-amber-950/15 text-amber-300' : 'border-admin-border/40 text-admin-muted hover:text-admin-text')}>
            <AlertTriangle className="h-3.5 w-3.5" />
            Suspicious Only
          </button>
          <span className="ml-auto text-xs text-admin-muted">{total.toLocaleString()} referrers</span>
          {isFetching && <RefreshCw className="h-3.5 w-3.5 animate-spin text-admin-muted" />}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-xs">
            <thead>
              <tr className="border-b border-admin-border/50 bg-white/[0.015]">
                {['Referrer', 'Code', 'Total Referred', 'Active', 'Commission Earned', 'Last Referral', 'Actions'].map((h, i) => (
                  <th key={h} className={cn('px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-admin-muted', i === 6 && 'text-right')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-admin-border/30">
                    {Array.from({ length: 7 }).map((__, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-3 w-16 rounded bg-white/[0.05] animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : referrals.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-14 text-center">
                    <div className="flex flex-col items-center gap-2 text-admin-muted">
                      <Award className="h-8 w-8 opacity-10" />
                      <p className="text-sm">No referral data</p>
                      <p className="text-xs opacity-60">{isError ? 'API endpoint not available' : 'No referrals match your filters'}</p>
                    </div>
                  </td>
                </tr>
              ) : referrals.map((r) => (
                <tr key={r.referrer_id}
                  className={cn('border-b border-admin-border/25 transition-colors hover:bg-white/[0.02]',
                    r.is_suspicious && 'bg-amber-950/[0.04]')}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-indigo-500/20 bg-indigo-950/20 text-[10px] font-bold text-indigo-400">
                        {((r.referrer_name ?? r.referrer_email ?? '?')[0] ?? '?').toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-admin-text">{r.referrer_name ?? '—'}</p>
                        <p className="text-[10px] text-admin-muted truncate max-w-[140px]">{r.referrer_email ?? r.referrer_id.slice(0, 12)}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs rounded-md border border-admin-border/40 bg-white/[0.03] px-2 py-0.5 text-admin-muted">
                      {r.referral_code ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums font-semibold text-admin-text">{r.total_referrals}</td>
                  <td className="px-4 py-3 tabular-nums text-emerald-400">{r.active_referrals}</td>
                  <td className="px-4 py-3 tabular-nums font-semibold text-admin-text">{fmtUSD(r.total_commission_usd)}</td>
                  <td className="px-4 py-3 text-admin-muted whitespace-nowrap" title={r.last_referral_at ?? ''}>
                    {fmtRelative(r.last_referral_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {r.is_suspicious && (
                        <span className="rounded-md border border-amber-500/30 bg-amber-950/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                          ⚠ Suspicious
                        </span>
                      )}
                      <button type="button" onClick={() => router.push(`/users/${r.referrer_id}`)}
                        className="p-1.5 rounded-lg text-admin-muted hover:text-blue-400 hover:bg-blue-950/15 transition-colors" title="View Profile">
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {total > 0 && (
          <div className="flex items-center justify-between border-t border-admin-border/30 px-5 py-3">
            <span className="text-xs text-admin-muted">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}</span>
            <Pager page={page} total={totalPages} onChange={setPage} />
          </div>
        )}
      </div>

      {/* Info box */}
      <div className="rounded-xl border border-blue-500/20 bg-blue-950/10 p-4 text-xs text-blue-300">
        <p className="font-semibold mb-1">About Suspicious Signals</p>
        <p className="text-blue-300/70">Self-referrals, circular referral chains, or users with an abnormally high referral-to-trade ratio are flagged as suspicious. Review these accounts for potential abuse of the referral program.</p>
      </div>
    </AdminPageFrame>
  );
}
