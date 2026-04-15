'use client';

import { memo } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAdminIncidentStore } from '@/store/adminIncidents';
import { cn } from '@/lib/cn';

function ReliabilityScoreInner() {
  const incidents = useAdminIncidentStore((s) => s.incidents);
  const resolved = incidents.filter((i) => i.status === 'resolved').length;
  const total = incidents.length;
  const score = total === 0 ? 100 : Math.round((resolved / total) * 100);
  const color = score >= 90 ? 'text-emerald-400' : score >= 70 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="rounded-xl border border-admin-border bg-admin-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck className="w-4 h-4 text-emerald-500" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">Reliability Score</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className={cn('text-3xl font-bold tabular-nums', color)}>{score}</span>
        <span className="text-xs text-admin-muted">/ 100</span>
      </div>
      <p className="text-[10px] text-admin-muted mt-1">
        {resolved} of {total} incidents resolved
      </p>
    </div>
  );
}

export const ReliabilityScore = memo(ReliabilityScoreInner);
