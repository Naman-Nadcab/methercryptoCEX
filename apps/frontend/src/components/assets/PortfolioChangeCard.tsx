'use client';

import { TrendingUp, TrendingDown, Clock } from 'lucide-react';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { Skeleton } from '@/components/ui/Skeleton';

export interface PortfolioChangeCardProps {
  totalUsd: number;
  totalBtc: number;
  change24h: number;
  change24hPercent: number;
  lastUpdated: string;
  showBalance: boolean;
  loading?: boolean;
}

export function PortfolioChangeCard({
  totalUsd,
  totalBtc,
  change24h,
  change24hPercent,
  lastUpdated,
  showBalance,
  loading = false,
}: PortfolioChangeCardProps) {
  const formatNumber = (num: number, decimals = 2) => {
    if (!Number.isFinite(num)) return (0).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };

  const isPositive = change24h >= 0;
  const isZero = change24h === 0 && change24hPercent === 0;

  return (
    <div className="bg-white dark:bg-[#1e2329] rounded-2xl p-6 border border-gray-100 dark:border-gray-800 card-bybit">
      <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 inline-flex items-center gap-1">
        Total Balance <InfoTooltip content="Combined funding and trading account balance in USD." />
      </p>
      {loading ? (
        <>
          <Skeleton className="h-10 w-40 mb-2" />
          <Skeleton className="h-5 w-32" />
        </>
      ) : (
        <>
          <h2 className="text-4xl font-bold text-gray-900 dark:text-white tabular-nums">
            {showBalance ? formatNumber(totalUsd) : '******'} <span className="text-xl font-normal text-gray-500">USD</span>
          </h2>
          <p className="text-base text-gray-500 dark:text-gray-400 mt-1">
            ≈ {showBalance ? formatNumber(totalBtc, 8) : '********'} BTC
          </p>
          <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t border-gray-100 dark:border-[rgba(255,255,255,0.05)]">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">24h Change</span>
              {isZero ? (
                <span className="text-sm font-medium text-gray-500 dark:text-gray-400 tabular-nums">0.00 (0.00%)</span>
              ) : (
                <span
                  className={`inline-flex items-center gap-1 text-sm font-medium tabular-nums ${
                    isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  {showBalance ? `${isPositive ? '+' : ''}${formatNumber(change24h)} (${isPositive ? '+' : ''}${formatNumber(change24hPercent)}%)` : '****'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <Clock className="w-3.5 h-3.5" />
              Last updated: {lastUpdated ? new Date(lastUpdated).toLocaleString() : '--'}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
