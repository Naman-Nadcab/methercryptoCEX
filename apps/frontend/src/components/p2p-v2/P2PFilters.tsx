'use client';

import { Filter } from 'lucide-react';

export type P2PFiltersValue = {
  side: 'buy' | 'sell';
  crypto: string;
  fiat: string;
  paymentCode: string;
};

const CRYPTOS = ['USDT', 'BTC', 'ETH', 'USDC'];
const FIATS = ['INR', 'USD', 'EUR', 'GBP'];
const PAYMENT_FILTERS = [
  { value: '', label: 'All methods' },
  { value: 'bank', label: 'Bank' },
  { value: 'upi', label: 'UPI' },
  { value: 'imps', label: 'IMPS' },
];

type Props = {
  value: P2PFiltersValue;
  onChange: (v: P2PFiltersValue) => void;
};

export function P2PFilters({ value, onChange }: Props) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-[#1e2329]">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
        <Filter className="h-4 w-4 text-gray-500" />
        Filters
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div>
          <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">Side</p>
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5 dark:border-gray-700">
            {(['buy', 'sell'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onChange({ ...value, side: s })}
                className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize ${
                  value.side === s
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Asset</label>
          <select
            value={value.crypto}
            onChange={(e) => onChange({ ...value, crypto: e.target.value })}
            className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-sm dark:border-gray-700 dark:bg-[#0b0e11] dark:text-white"
          >
            {CRYPTOS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Fiat</label>
          <select
            value={value.fiat}
            onChange={(e) => onChange({ ...value, fiat: e.target.value })}
            className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-sm dark:border-gray-700 dark:bg-[#0b0e11] dark:text-white"
          >
            {FIATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Payment</label>
          <select
            value={value.paymentCode}
            onChange={(e) => onChange({ ...value, paymentCode: e.target.value })}
            className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-sm dark:border-gray-700 dark:bg-[#0b0e11] dark:text-white"
          >
            {PAYMENT_FILTERS.map((p) => (
              <option key={p.value || 'all'} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
