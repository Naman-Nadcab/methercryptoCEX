'use client';

import { MousePointerClick, UserPlus, ShieldCheck, TrendingUp, DollarSign } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';

export interface ReferralFunnelMetrics {
  linkClicks: number;
  signups: number;
  verifiedUsers: number;
  activeTraders: number;
  revenue: number;
}

export interface ReferralFunnelProps {
  metrics?: ReferralFunnelMetrics | null;
  loading?: boolean;
}

const steps = [
  { key: 'linkClicks', label: 'Link Clicks', icon: MousePointerClick },
  { key: 'signups', label: 'Signups', icon: UserPlus },
  { key: 'verifiedUsers', label: 'Verified Users', icon: ShieldCheck },
  { key: 'activeTraders', label: 'Active Traders', icon: TrendingUp },
  { key: 'revenue', label: 'Revenue', icon: DollarSign },
] as const;

const defaultMetrics: ReferralFunnelMetrics = {
  linkClicks: 0,
  signups: 0,
  verifiedUsers: 0,
  activeTraders: 0,
  revenue: 0,
};

function formatMetric(key: string, value: number): string {
  if (key === 'revenue') return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return value.toLocaleString();
}

export function ReferralFunnel({ metrics, loading = false }: ReferralFunnelProps) {
  const m = metrics ?? defaultMetrics;

  return (
    <div className="bg-white dark:bg-[#181a20] rounded-2xl p-6 border border-gray-100 dark:border-gray-800 card-bybit">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Referral Funnel</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Conversion from clicks to revenue</p>
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {steps.map((s) => (
            <div key={s.key} className="flex flex-col gap-2">
              <Skeleton className="h-10 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {steps.map((s, i) => {
            const Icon = s.icon;
            const value = m[s.key];
            return (
              <div
                key={s.key}
                className="flex flex-col items-center sm:items-start p-3 rounded-xl bg-gray-50 dark:bg-[#1e2329] border border-gray-100 dark:border-gray-800"
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                    <Icon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{s.label}</span>
                </div>
                <span className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">
                  {formatMetric(s.key, value)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
