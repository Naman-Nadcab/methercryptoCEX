'use client';

import { useMemo, memo } from 'react';
import { ShieldCheck, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useAdminIncidentStore } from '@/store/adminIncidents';
import { useAdminAlertStore } from '@/store/adminAlerts';
import { cn } from '@/lib/cn';

interface ReliabilityScoreProps {
  errorRate?: number;
  uptimeHours?: number;
}

function computeReliabilityScore(
  incidentCount: number,
  alertFrequency: number,
  errorRate: number,
  resolvedRatio: number,
): number {
  let score = 100;
  if (incidentCount > 5) score -= 25;
  else if (incidentCount > 2) score -= 15;
  else if (incidentCount > 0) score -= 5;

  if (alertFrequency > 50) score -= 20;
  else if (alertFrequency > 20) score -= 10;
  else if (alertFrequency > 5) score -= 3;

  if (errorRate > 10) score -= 25;
  else if (errorRate > 5) score -= 15;
  else if (errorRate > 1) score -= 5;

  score += resolvedRatio * 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function ReliabilityScoreInner({ errorRate = 0 }: ReliabilityScoreProps) {
  const incidents = useAdminIncidentStore((s) => s.incidents);
  const alerts = useAdminAlertStore((s) => s.alerts);

  const { score, trend, resolvedCount, totalCount } = useMemo(() => {
    const total = incidents.length;
    const resolved = incidents.filter((i) => i.status === 'resolved').length;
    const resolvedRatio = total > 0 ? resolved / total : 1;
    const s = computeReliabilityScore(total, alerts.length, errorRate, resolvedRatio);

    let t: 'improving' | 'degrading' | 'stable' = 'stable';
    const recent = incidents.filter((i) => Date.now() - i.startedAt < 3600_000).length;
    const older = incidents.filter((i) => Date.now() - i.startedAt >= 3600_000 && Date.now() - i.startedAt < 7200_000).length;
    if (recent < older) t = 'improving';
    else if (recent > older) t = 'degrading';

    return { score: s, trend: t, resolvedCount: resolved, totalCount: total };
  }, [incidents, alerts, errorRate]);

  const color = score >= 90 ? 'text-emerald-600' : score >= 70 ? 'text-amber-600' : 'text-red-600';
  const bgColor = score >= 90 ? 'bg-emerald-50 border-emerald-200' : score >= 70 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200';
  const ringColor = score >= 90 ? 'stroke-emerald-500' : score >= 70 ? 'stroke-amber-500' : 'stroke-red-500';

  const TrendIcon = trend === 'improving' ? TrendingUp : trend === 'degrading' ? TrendingDown : Minus;
  const trendColor = trend === 'improving' ? 'text-emerald-600' : trend === 'degrading' ? 'text-red-600' : 'text-admin-muted';
  const trendLabel = trend === 'improving' ? 'Improving' : trend === 'degrading' ? 'Degrading' : 'Stable';

  const circumference = 2 * Math.PI * 40;
  const dashOffset = circumference - (score / 100) * circumference;

  return (
    <div className={cn('rounded-xl border p-4 transition-all', bgColor)}>
      <div className="flex items-center gap-4">
        <div className="relative w-20 h-20 shrink-0">
          <svg className="w-20 h-20 -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="6" className="text-gray-200" />
            <circle cx="50" cy="50" r="40" fill="none" strokeWidth="6" strokeLinecap="round"
              className={ringColor} strokeDasharray={circumference} strokeDashoffset={dashOffset}
              style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={cn('text-lg font-bold tabular-nums', color)}>{score}%</span>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className={cn('w-4 h-4', color)} />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">Reliability Score</span>
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <TrendIcon className={cn('w-3.5 h-3.5', trendColor)} />
            <span className={cn('text-xs font-medium', trendColor)}>{trendLabel}</span>
          </div>
          <div className="flex items-center gap-3 mt-2 text-[10px] text-admin-muted">
            <span>{totalCount} incident{totalCount !== 1 ? 's' : ''}</span>
            <span>·</span>
            <span>{resolvedCount} resolved</span>
            <span>·</span>
            <span>{alerts.length} alerts</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export const ReliabilityScore = memo(ReliabilityScoreInner);
