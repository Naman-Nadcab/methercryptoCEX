'use client';

export type StatusBadgeVariant = 'LIVE' | 'HALTED' | 'DEGRADED' | 'RISK' | 'NEUTRAL';

const variantStyles: Record<StatusBadgeVariant, string> = {
  LIVE: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30',
  HALTED: 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30',
  DEGRADED: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30',
  RISK: 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30',
  NEUTRAL: 'bg-gray-500/15 text-gray-600 dark:text-gray-400 border border-gray-500/30',
};

const dotStyles: Record<StatusBadgeVariant, string> = {
  LIVE: 'bg-emerald-500',
  HALTED: 'bg-red-500',
  DEGRADED: 'bg-amber-500 animate-pulse',
  RISK: 'bg-red-500 animate-pulse',
  NEUTRAL: 'bg-gray-500',
};

export interface StatusBadgeProps {
  variant: StatusBadgeVariant;
  label?: string;
  showDot?: boolean;
  className?: string;
}

export function StatusBadge({
  variant,
  label,
  showDot = true,
  className = '',
}: StatusBadgeProps) {
  const displayLabel = label ?? variant;
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-[11px] font-medium tabular-nums ${variantStyles[variant]} ${className}`}
      role="status"
    >
      {showDot && (
        <span
          className={`w-1 h-1 rounded-full shrink-0 ${dotStyles[variant]}`}
          aria-hidden
        />
      )}
      {displayLabel}
    </span>
  );
}
