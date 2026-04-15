'use client';

interface ConfirmationProgressProps {
  confirmations: number;
  required: number;
}

export function ConfirmationProgress({ confirmations, required }: ConfirmationProgressProps) {
  const c = Math.max(0, Number(confirmations));
  const r = Math.max(0, Number(required));
  const pct = r > 0 ? Math.min(100, (c / r) * 100) : (c > 0 ? 100 : 0);

  const done = r > 0 && c >= r;

  return (
    <div className="flex min-w-[120px] flex-col gap-1.5">
      <span className={`text-xs tabular-nums font-medium ${done ? 'text-emerald-400' : 'text-admin-text'}`}>
        {r > 0 ? `${c} / ${r}` : `${c}`}
        <span className="ml-1 text-admin-muted font-normal">conf.</span>
      </span>
      {r > 0 && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.08]">
          <div
            className={`h-full rounded-full transition-[width] ${done ? 'bg-emerald-500' : pct >= 50 ? 'bg-blue-400' : 'bg-amber-400'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
