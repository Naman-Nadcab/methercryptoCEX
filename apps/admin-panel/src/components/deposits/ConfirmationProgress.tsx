'use client';

interface ConfirmationProgressProps {
  confirmations: number;
  required: number;
}

export function ConfirmationProgress({ confirmations, required }: ConfirmationProgressProps) {
  const c = Math.max(0, Number(confirmations));
  const r = Math.max(0, Number(required));
  const pct = r > 0 ? Math.min(100, (c / r) * 100) : (c > 0 ? 100 : 0);

  return (
    <div className="flex min-w-[100px] flex-col gap-1">
      <span className="tabular-nums text-sm">
        {r > 0 ? `${c} / ${r} confirmations` : `${c} confirmation${c !== 1 ? 's' : ''}`}
      </span>
      {r > 0 && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-admin-primary transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
