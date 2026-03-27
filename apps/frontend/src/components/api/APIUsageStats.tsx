'use client';

import { Activity, AlertCircle, Gauge } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';

export interface APIUsageStatsProps {
  requestsToday?: number;
  errors?: number;
  rateLimitUsage?: number;
  rateLimitMax?: number;
  loading?: boolean;
}

export function APIUsageStats({
  requestsToday = 0,
  errors = 0,
  rateLimitUsage = 0,
  rateLimitMax = 100,
  loading = false,
}: APIUsageStatsProps) {
  const ratePercent = rateLimitMax > 0 ? Math.min(100, (rateLimitUsage / rateLimitMax) * 100) : 0;

  if (loading) {
    return (
      <div className="bg-white dark:bg-[#181a20] rounded-xl p-5 border border-gray-100 dark:border-gray-800 card-bybit">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-4">API Usage</h3>
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-[#181a20] rounded-xl p-5 border border-gray-100 dark:border-gray-800 card-bybit">
      <h3 className="font-semibold text-gray-900 dark:text-white mb-4">API Usage</h3>
      <div className="grid grid-cols-3 gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
            <Activity className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{requestsToday.toLocaleString()}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Requests today</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{errors.toLocaleString()}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Errors</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-center justify-center">
            <Gauge className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">
              {rateLimitUsage} / {rateLimitMax}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Rate limit usage</p>
            <div className="mt-1 w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full transition-all ${
                  ratePercent >= 90 ? 'bg-red-500' : ratePercent >= 70 ? 'bg-amber-500' : 'bg-blue-500'
                }`}
                style={{ width: `${ratePercent}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
