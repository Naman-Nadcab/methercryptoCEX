'use client';

import { type ReactNode, memo } from 'react';
import Link from 'next/link';
import { SmartTooltip } from './SmartTooltip';

export type PanelStatus = 'normal' | 'warning' | 'critical';

interface PanelProps {
  title: string;
  value?: string | number;
  trend?: { direction: 'up' | 'down' | 'flat'; label: string };
  status?: PanelStatus;
  className?: string;
  headerRight?: ReactNode;
  children?: ReactNode;
  href?: string;
  error?: boolean;
  empty?: boolean;
  tooltip?: string;
  tooltipDanger?: string;
  highlighted?: boolean;
  staleWarning?: boolean;
  panelId?: string;
}

const STATUS_BORDER: Record<PanelStatus, string> = {
  normal: 'border-[#1F2937]',
  warning: 'border-amber-500/40',
  critical: 'border-red-500/50',
};

const STATUS_GLOW: Record<PanelStatus, string> = {
  normal: '',
  warning: 'shadow-[0_0_20px_-4px_rgba(245,158,11,0.2)]',
  critical: 'shadow-[0_0_20px_-4px_rgba(239,68,68,0.25)]',
};

const STATUS_PULSE: Record<PanelStatus, string> = {
  normal: '',
  warning: '',
  critical: 'animate-[pulse_3s_ease-in-out_infinite]',
};

const TREND_COLOR = {
  up: 'text-emerald-400',
  down: 'text-red-400',
  flat: 'text-zinc-500',
};

const TREND_ICON = { up: '↑', down: '↓', flat: '→' };

function PanelInner({
  title, value, trend, status = 'normal', className = '',
  headerRight, children, href, error, empty,
  tooltip, tooltipDanger, highlighted, staleWarning, panelId,
}: PanelProps) {
  const highlightRing = highlighted ? 'ring-2 ring-blue-500/40 ring-offset-1 ring-offset-[#0F1117]' : '';

  const content = (
    <div
      id={panelId}
      className={`
        rounded-xl border bg-[#151922] transition-all duration-200
        hover:bg-[#1a1f2e] hover:shadow-lg hover:border-[#2a3040]
        ${href ? 'cursor-pointer hover:scale-[1.02]' : ''}
        ${STATUS_BORDER[status]} ${STATUS_GLOW[status]} ${STATUS_PULSE[status]}
        ${highlightRing} ${className}
      `}
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-1.5">
          {tooltip ? (
            <SmartTooltip content={tooltip} danger={tooltipDanger}>
              <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500 cursor-help border-b border-dotted border-zinc-700">
                {title}
              </h3>
            </SmartTooltip>
          ) : (
            <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500">{title}</h3>
          )}
          {staleWarning && <span className="text-amber-400 text-[10px]" title="Using cached data">⚠</span>}
        </div>
        {headerRight}
      </div>

      {error ? (
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 py-3 px-3 rounded-lg bg-red-500/[0.06] border border-red-500/10">
            <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
            <span className="text-xs text-red-400">Connection issue — retrying</span>
          </div>
        </div>
      ) : empty ? (
        <div className="px-4 pb-4">
          <div className="flex items-center justify-center py-6 text-xs text-zinc-600">
            No data available
          </div>
        </div>
      ) : (
        <>
          {(value !== undefined || trend) && (
            <div className="px-4 pb-2 flex items-end gap-3">
              {value !== undefined && (
                <span className="text-2xl font-semibold text-[#E5E7EB] tabular-nums">{value}</span>
              )}
              {trend && (
                <span className={`text-xs font-medium pb-1 ${TREND_COLOR[trend.direction]}`}>
                  {TREND_ICON[trend.direction]} {trend.label}
                </span>
              )}
            </div>
          )}
          {children && <div className="px-4 pb-4">{children}</div>}
        </>
      )}
    </div>
  );

  if (href) {
    return <Link href={href} className="block">{content}</Link>;
  }
  return content;
}

export const Panel = memo(PanelInner);
