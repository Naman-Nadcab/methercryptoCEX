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
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div
        className="flex border-b border-border bg-muted/40 p-1.5 sm:p-2"
        role="tablist"
        aria-label="Trade side"
      >
        {(['buy', 'sell'] as const).map((s) => {
          const active = value.side === s;
          return (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange({ ...value, side: s })}
              className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold capitalize transition-colors sm:flex-none sm:min-w-[7rem] ${
                active
                  ? s === 'buy'
                    ? 'bg-card text-buy shadow-sm ring-1 ring-border'
                    : 'bg-card text-sell shadow-sm ring-1 ring-border'
                  : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
              }`}
            >
              {s}
            </button>
          );
        })}
      </div>

      <div className="p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
          <Filter className="h-4 w-4 text-muted-foreground" aria-hidden />
          Filters
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="min-w-0 sm:min-w-[7rem]">
            <label className="mb-1 block text-xs text-muted-foreground">Asset</label>
            <select
              value={value.crypto}
              onChange={(e) => onChange({ ...value, crypto: e.target.value })}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground sm:h-9"
            >
              {CRYPTOS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0 sm:min-w-[7rem]">
            <label className="mb-1 block text-xs text-muted-foreground">Fiat</label>
            <select
              value={value.fiat}
              onChange={(e) => onChange({ ...value, fiat: e.target.value })}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground sm:h-9"
            >
              {FIATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0 flex-1 sm:max-w-xs sm:flex-none">
            <label className="mb-1 block text-xs text-muted-foreground">Payment</label>
            <select
              value={value.paymentCode}
              onChange={(e) => onChange({ ...value, paymentCode: e.target.value })}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground sm:h-9"
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
    </div>
  );
}
