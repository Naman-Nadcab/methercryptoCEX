'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import type { RiskDistribution } from '@/lib/risk-api';
import { cn } from '@/lib/cn';

const TIERS = [
  { key: 'low_risk_users',    label: 'Low',    color: '#10B981', bar: 'bg-emerald-500', text: 'text-emerald-400', border: 'border-emerald-500/25', bg: 'bg-emerald-950/15' },
  { key: 'medium_risk_users', label: 'Medium', color: '#F59E0B', bar: 'bg-amber-400',   text: 'text-amber-400',  border: 'border-amber-500/25',   bg: 'bg-amber-950/15'   },
  { key: 'high_risk_users',   label: 'High',   color: '#EF4444', bar: 'bg-red-500',     text: 'text-red-400',    border: 'border-red-500/25',     bg: 'bg-red-950/15'     },
] as const;

export interface RiskDistributionCardsProps {
  distribution: RiskDistribution | null | undefined;
}

export function RiskDistributionCards({ distribution }: RiskDistributionCardsProps) {
  const low    = distribution?.low_risk_users    ?? 0;
  const medium = distribution?.medium_risk_users ?? 0;
  const high   = distribution?.high_risk_users   ?? 0;
  const total  = low + medium + high || 1;

  const pieData = TIERS.map((t) => ({
    name:  t.label,
    value: distribution?.[t.key] ?? 0,
    color: t.color,
  })).filter((d) => d.value > 0);

  const values: Record<string, number> = { low_risk_users: low, medium_risk_users: medium, high_risk_users: high };

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      {/* Three tier cards */}
      <div className="grid gap-3 sm:grid-cols-3 lg:col-span-3">
        {TIERS.map((t) => {
          const v   = values[t.key] ?? 0;
          const pct = Math.round((v / total) * 100);
          return (
            <div key={t.key} className={cn('relative overflow-hidden rounded-2xl border p-5 bg-admin-card', t.border)}>
              <div className={cn('absolute inset-x-0 top-0 h-0.5 rounded-t-2xl', t.bar)} />
              <p className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">{t.label} Risk Users</p>
              <p className="mt-2 text-2xl font-bold tabular-nums text-admin-text">{v.toLocaleString()}</p>
              <div className="mt-3 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                  <div className={cn('h-full rounded-full transition-all', t.bar)} style={{ width: `${pct}%` }} />
                </div>
                <span className={cn('text-[10px] font-semibold tabular-nums', t.text)}>{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Donut chart */}
      <div className="rounded-2xl border border-admin-border/60 bg-admin-card p-5">
        <p className="text-xs font-semibold text-admin-muted">Risk Distribution</p>
        {pieData.length === 0 ? (
          <div className="flex h-[160px] items-center justify-center text-sm text-admin-muted">No data yet</div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={38} outerRadius={62} paddingAngle={2} dataKey="value">
                  {pieData.map((d, i) => <Cell key={i} fill={d.color} strokeWidth={0} />)}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                  itemStyle={{ color: '#ccc' }}
                  formatter={(v: number) => [v.toLocaleString(), '']}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-1 flex justify-center gap-3">
              {pieData.map((d) => (
                <div key={d.name} className="flex items-center gap-1">
                  <div className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                  <span className="text-[10px] text-admin-muted">{d.name}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
