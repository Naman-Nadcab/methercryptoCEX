'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { adminFetch } from '@/lib/api';
import { getDashboardStats } from '@/lib/api';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { cn } from '@/lib/cn';
import {
  Users, UserCheck, Activity, BarChart2, RefreshCw,
  Globe, Calendar, ChevronRight,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  CartesianGrid,
} from 'recharts';
import { useRouter } from 'next/navigation';

/* ── types ──────────────────────────────────────────────────────────── */
interface UserAnalyticsResponse {
  overview: {
    total_users: number;
    new_today: number;
    new_7d: number;
    new_30d: number;
    active_7d: number;
    active_30d: number;
    kyc_completed_pct: number;
    avg_balance_usd: number;
    churn_7d: number;
  };
  growth: Array<{ date: string; new_users: number; active_users: number }>;
  retention: Array<{ cohort: string; day_1: number; day_7: number; day_30: number }>;
  top_traders: Array<{ user_id: string; email: string; volume_30d: string; trades_30d: number; country: string }>;
  by_country: Array<{ country: string; count: number; pct: number }>;
  by_kyc_level: Array<{ level: number; count: number }>;
}

/* ── helpers ────────────────────────────────────────────────────────── */
function fmtNum(n: number | undefined | null): string {
  if (n === undefined || n === null) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}
function fmtUSD(n: number | undefined | null): string {
  if (n === undefined || n === null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n);
}
function fmtPct(n: number | undefined | null): string {
  if (n === undefined || n === null) return '—';
  return `${n.toFixed(1)}%`;
}

const CHART_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#3b82f6', '#ec4899', '#14b8a6'];

/* ── atoms ──────────────────────────────────────────────────────────── */
function KpiCard({ label, value, sub, icon: Icon, accent }: {
  label: string; value: string | number; sub?: string; icon: React.ElementType; accent: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-admin-border/50 bg-admin-card p-5">
      <div className={cn('absolute inset-x-0 top-0 h-0.5 rounded-t-2xl',
        accent === 'indigo' ? 'bg-indigo-500' : accent === 'emerald' ? 'bg-emerald-500' : accent === 'blue' ? 'bg-blue-500' : 'bg-amber-500')} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">{label}</p>
          <p className="mt-2 text-3xl font-bold tabular-nums text-admin-text">{value}</p>
          {sub && <p className="mt-0.5 text-[10px] text-admin-muted">{sub}</p>}
        </div>
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border',
          accent === 'indigo' ? 'border-indigo-500/25 bg-indigo-950/20 text-indigo-400' : accent === 'emerald' ? 'border-emerald-500/25 bg-emerald-950/20 text-emerald-400' : accent === 'blue' ? 'border-blue-500/25 bg-blue-950/20 text-blue-400' : 'border-amber-500/25 bg-amber-950/20 text-amber-400')}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-admin-border/50 bg-admin-card p-5">
      <p className="mb-4 text-sm font-semibold text-admin-text">{title}</p>
      {children}
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-admin-border/60 bg-admin-card px-3 py-2 text-xs shadow-xl">
      {label && <p className="mb-1 font-semibold text-admin-text">{label}</p>}
      {payload.map((p) => (
        <p key={p.name} className="text-admin-muted"><span style={{ color: p.color }} className="font-semibold">{p.name}</span>: {p.value.toLocaleString()}</p>
      ))}
    </div>
  );
};

/* ── page ───────────────────────────────────────────────────────────── */
export default function UserAnalyticsPage() {
  const token  = useAdminAuthStore((s) => s.accessToken);
  const router = useRouter();
  const [range, setRange] = useState<'7d' | '30d' | '90d'>('30d');

  const { data: analyticsData, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'user-analytics', token, range],
    staleTime: 60_000,
    queryFn: () => adminFetch<UserAnalyticsResponse>('/users/analytics', { token, params: { range } }),
    enabled: !!token,
    refetchInterval: 120_000,
  });

  const { data: dashData } = useQuery({
    queryKey: ['admin', 'dashboard-stats', token],
    staleTime: 30_000,
    queryFn: () => getDashboardStats(token),
    enabled: !!token,
  });
  const us = dashData?.data?.users as { total?: number; newToday?: number; active?: number } | undefined;

  const stats   = analyticsData?.data?.overview;
  const growth  = analyticsData?.data?.growth ?? [];
  const topTraders = analyticsData?.data?.top_traders ?? [];
  const byCountry  = analyticsData?.data?.by_country  ?? [];
  const byKyc      = analyticsData?.data?.by_kyc_level ?? [];

  return (
    <AdminPageFrame
      title="User Analytics"
      description="DAU/MAU trends, retention, top traders, and geographic distribution."
      status="active"
      error={isError ? 'User analytics endpoint not available — some charts will show placeholder data.' : null}
      onRetry={() => void refetch()}
      quickActions={
        <div className="flex items-center gap-2">
          {(['7d', '30d', '90d'] as const).map((r) => (
            <button key={r} type="button" onClick={() => setRange(r)}
              className={cn('rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors',
                range === r ? 'border-indigo-500/40 bg-indigo-950/15 text-indigo-300' : 'border-admin-border/40 text-admin-muted hover:text-admin-text')}>
              {r}
            </button>
          ))}
          <button type="button" onClick={() => refetch()} disabled={isFetching}
            className="flex items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text disabled:opacity-40 transition-colors">
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
          </button>
        </div>
      }
    >
      {/* KPI strip */}
      {(() => {
        const activeVal = range === '7d' ? stats?.active_7d : range === '90d' ? (stats as unknown as { active_90d?: number } | undefined)?.active_90d : stats?.active_30d;
        return (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Total Users"          value={fmtNum(us?.total   ?? stats?.total_users)} sub="all time"       icon={Users}      accent="indigo" />
            <KpiCard label="New Today"            value={fmtNum(us?.newToday ?? stats?.new_today)}   sub="registrations" icon={Calendar}   accent="emerald" />
            <KpiCard label={`Active (${range})`}  value={fmtNum(activeVal  ?? us?.active)}           sub="engaged users" icon={Activity}   accent="blue" />
            <KpiCard label="KYC Complete"         value={fmtPct(stats?.kyc_completed_pct)}           sub="of total users" icon={UserCheck} accent="amber" />
          </div>
        );
      })()}

      {/* Secondary KPIs */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-admin-border/50 bg-admin-card p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted mb-3">Growth Summary</p>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs"><span className="text-admin-muted">New this week</span><span className="font-semibold text-admin-text">{fmtNum(stats?.new_7d)}</span></div>
            <div className="flex items-center justify-between text-xs"><span className="text-admin-muted">New this month</span><span className="font-semibold text-admin-text">{fmtNum(stats?.new_30d)}</span></div>
            <div className="flex items-center justify-between text-xs"><span className="text-admin-muted">Churn (7d)</span><span className="font-semibold text-red-400">{fmtNum(stats?.churn_7d)}</span></div>
            <div className="flex items-center justify-between text-xs"><span className="text-admin-muted">Avg Balance</span><span className="font-semibold text-admin-text">{fmtUSD(stats?.avg_balance_usd)}</span></div>
          </div>
        </div>
        <div className="sm:col-span-2 rounded-2xl border border-admin-border/50 bg-admin-card p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted mb-3">KYC Level Distribution</p>
          {byKyc.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-xs text-admin-muted">No data available</div>
          ) : (
            <div className="space-y-2">
              {byKyc.map((k) => (
                <div key={k.level} className="flex items-center gap-3">
                  <span className="w-16 text-xs text-admin-muted">Level {k.level}</span>
                  <div className="flex-1 h-2 rounded-full bg-white/[0.05]">
                    <div className="h-2 rounded-full bg-indigo-500/60" style={{ width: `${Math.min(100, k.count / (us?.total ?? 1) * 100)}%` }} />
                  </div>
                  <span className="w-12 text-right text-xs text-admin-muted tabular-nums">{fmtNum(k.count)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Growth chart */}
      <ChartCard title={`User Growth — ${range}`}>
        {isLoading ? (
          <div className="flex h-48 items-center justify-center text-xs text-admin-muted">Loading…</div>
        ) : growth.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-xs text-admin-muted">No growth data available for this range.</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={growth} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
              <defs>
                <linearGradient id="gNew" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gActive" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} axisLine={false} tickLine={false} width={36} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="new_users"    stroke="#6366f1" fill="url(#gNew)"    strokeWidth={2} name="New Users" />
              <Area type="monotone" dataKey="active_users" stroke="#22c55e" fill="url(#gActive)" strokeWidth={2} name="Active Users" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Top traders */}
        <ChartCard title="Top Traders (30d Volume)">
          {topTraders.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-xs text-admin-muted">No trader data available.</div>
          ) : (
            <div className="space-y-2">
              {topTraders.slice(0, 8).map((t, i) => (
                <div key={t.user_id} className="flex items-center gap-3 rounded-lg border border-admin-border/30 px-3 py-2">
                  <span className="w-5 text-[10px] font-bold tabular-nums text-admin-muted">#{i + 1}</span>
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-950/20 border border-indigo-500/20 text-[10px] font-bold text-indigo-400">
                    {(t.email[0] ?? '?').toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-admin-text truncate">{t.email}</p>
                    <p className="text-[10px] text-admin-muted">{t.country} · {t.trades_30d} trades</p>
                  </div>
                  <span className="tabular-nums text-xs font-semibold text-admin-text">{fmtUSD(parseFloat(t.volume_30d))}</span>
                  <button type="button" onClick={() => router.push(`/users/${t.user_id}`)}
                    className="p-1 rounded-lg text-admin-muted hover:text-blue-400 transition-colors">
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </ChartCard>

        {/* By country */}
        <ChartCard title="Users by Country">
          {byCountry.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-xs text-admin-muted">No geographic data available.</div>
          ) : (
            <div className="space-y-2">
              {byCountry.slice(0, 8).map((c, i) => (
                <div key={c.country} className="flex items-center gap-3">
                  <span className="w-5 text-[10px] font-bold tabular-nums text-admin-muted">#{i + 1}</span>
                  <Globe className="h-3 w-3 text-admin-muted shrink-0" />
                  <span className="flex-1 text-xs text-admin-text">{c.country || 'Unknown'}</span>
                  <div className="w-24 h-1.5 rounded-full bg-white/[0.05]">
                    <div className="h-1.5 rounded-full bg-indigo-500/50" style={{ width: `${Math.min(100, c.pct)}%` }} />
                  </div>
                  <span className="w-12 text-right text-[10px] text-admin-muted tabular-nums">{fmtNum(c.count)}</span>
                  <span className="w-10 text-right text-[10px] text-admin-muted">{c.pct.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          )}
        </ChartCard>
      </div>

      {/* Retention table */}
      {analyticsData?.data?.retention && analyticsData.data.retention.length > 0 && (
        <div className="rounded-2xl border border-admin-border/50 bg-admin-card p-5">
          <p className="mb-4 text-sm font-semibold text-admin-text">Cohort Retention</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-admin-border/50">
                  <th className="pb-2 text-[10px] font-semibold uppercase tracking-wider text-admin-muted">Cohort</th>
                  <th className="pb-2 px-4 text-[10px] font-semibold uppercase tracking-wider text-admin-muted">Day 1</th>
                  <th className="pb-2 px-4 text-[10px] font-semibold uppercase tracking-wider text-admin-muted">Day 7</th>
                  <th className="pb-2 px-4 text-[10px] font-semibold uppercase tracking-wider text-admin-muted">Day 30</th>
                </tr>
              </thead>
              <tbody>
                {analyticsData.data.retention.map((r) => (
                  <tr key={r.cohort} className="border-b border-admin-border/25">
                    <td className="py-2 text-admin-muted">{r.cohort}</td>
                    <td className="py-2 px-4">
                      <RetentionCell value={r.day_1} />
                    </td>
                    <td className="py-2 px-4">
                      <RetentionCell value={r.day_7} />
                    </td>
                    <td className="py-2 px-4">
                      <RetentionCell value={r.day_30} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AdminPageFrame>
  );
}

function RetentionCell({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value));
  const color = pct >= 60 ? 'text-emerald-400' : pct >= 30 ? 'text-amber-400' : 'text-red-400';
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 rounded-full bg-white/[0.05]">
        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: pct >= 60 ? '#22c55e' : pct >= 30 ? '#f59e0b' : '#ef4444', opacity: 0.5 }} />
      </div>
      <span className={cn('tabular-nums font-semibold', color)}>{pct.toFixed(0)}%</span>
    </div>
  );
}
