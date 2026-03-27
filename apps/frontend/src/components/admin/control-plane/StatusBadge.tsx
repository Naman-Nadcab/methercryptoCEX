'use client';

export type StatusBadgeVariant = 'LIVE' | 'HALTED' | 'DEGRADED' | 'RISK' | 'NEUTRAL';

const variantStyles: Record<StatusBadgeVariant, string> = {
  LIVE: 'bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/30',
  HALTED: 'bg-[#EF4444]/15 text-[#EF4444] border border-[#EF4444]/30',
  DEGRADED: 'bg-[#F59E0B]/15 text-[#F59E0B] border border-[#F59E0B]/30',
  RISK: 'bg-[#EF4444]/15 text-[#EF4444] border border-[#EF4444]/30',
  NEUTRAL: 'bg-[#6B7280]/15 text-[#6B7280] border border-[#6B7280]/30',
};

const dotStyles: Record<StatusBadgeVariant, string> = {
  LIVE: 'bg-[#10B981]',
  HALTED: 'bg-[#EF4444]',
  DEGRADED: 'bg-[#F59E0B] animate-pulse',
  RISK: 'bg-[#EF4444] animate-pulse',
  NEUTRAL: 'bg-[#6B7280]',
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
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[11px] font-medium tabular-nums ${variantStyles[variant]} ${className}`}
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
