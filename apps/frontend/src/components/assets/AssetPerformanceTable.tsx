'use client';

import { useRouter } from 'next/navigation';
import { TrendingUp, TrendingDown } from 'lucide-react';

export interface AssetPerformanceRow {
  symbol: string;
  balance: string;
  change24h: number;
  change24hPercent: number;
  valueUsd: string;
}

export interface AssetPerformanceTableProps {
  rows: AssetPerformanceRow[];
  showBalance: boolean;
}

export function AssetPerformanceTable({ rows, showBalance }: AssetPerformanceTableProps) {
  const router = useRouter();

  const formatNumber = (num: number, decimals = 2) => {
    if (!Number.isFinite(num)) return '0.00';
    return num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };

  return (
    <div className="bg-white dark:bg-[#1e2329] rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden card-bybit">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        Asset Performance
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
              <th className="py-3 px-4 font-medium uppercase tracking-wide">Asset</th>
              <th className="py-3 px-4 font-medium uppercase tracking-wide text-right">Balance</th>
              <th className="py-3 px-4 font-medium uppercase tracking-wide text-right">24h Change</th>
              <th className="py-3 px-4 font-medium uppercase tracking-wide text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-12 px-6 text-center">
                  <p className="text-gray-500 dark:text-gray-400">No assets</p>
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isPositive = row.change24h >= 0;
                const isZero = row.change24h === 0 && row.change24hPercent === 0;
                return (
                  <tr
                    key={row.symbol}
                    onClick={() => router.push(`/wallet/${encodeURIComponent(row.symbol)}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        router.push(`/wallet/${encodeURIComponent(row.symbol)}`);
                      }
                    }}
                    className="border-b border-gray-100 dark:border-gray-800 last:border-0 cursor-pointer hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors"
                  >
                    <td className="py-3 px-4 font-medium text-gray-900 dark:text-white">{row.symbol}</td>
                    <td className="py-3 px-4 text-right tabular-nums text-gray-700 dark:text-gray-300">
                      {showBalance ? row.balance : '****'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {isZero ? (
                        <span className="text-gray-500 dark:text-gray-400 tabular-nums">0.00%</span>
                      ) : (
                        <span
                          className={`inline-flex items-center justify-end gap-0.5 tabular-nums ${
                            isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                          {showBalance ? `${isPositive ? '+' : ''}${formatNumber(row.change24hPercent)}%` : '****'}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums text-gray-700 dark:text-gray-300 font-medium">
                      {showBalance ? row.valueUsd : '****'} <span className="text-gray-500 text-xs">USD</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
