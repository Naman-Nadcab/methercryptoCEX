'use client';

import { RefreshCw } from 'lucide-react';

export type P2PFiltersValue = {
  side: 'buy' | 'sell';
  crypto: string;
  fiat: string;
  paymentCode: string;
};

const CRYPTOS = ['USDT', 'BTC', 'ETH', 'USDC'];
const FIATS = ['INR', 'USD', 'EUR', 'GBP'];
const PAYMENT_FILTERS = [
  { value: '', label: 'All Payments' },
  { value: 'bank', label: 'Bank Transfer' },
  { value: 'upi', label: 'UPI' },
  { value: 'imps', label: 'IMPS' },
];

type Props = {
  value: P2PFiltersValue;
  onChange: (v: P2PFiltersValue) => void;
  onRefresh?: () => void;
};

export function P2PFilters({ value, onChange, onRefresh }: Props) {
  return (
    <div className="space-y-3">
      {/* Buy / Sell underline tabs */}
      <div className="flex items-center gap-8 border-b border-border/30">
        {(['buy', 'sell'] as const).map((s) => {
          const active = value.side === s;
          return (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange({ ...value, side: s })}
              className={`relative pb-3 text-lg font-bold capitalize tracking-tight transition-colors duration-150 ${
                active
                  ? s === 'buy' ? 'text-[#0ecb81]' : 'text-[#f6465d]'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {s}
              {active && (
                <span className={`absolute bottom-0 left-0 right-0 h-0.5 rounded-full ${
                  s === 'buy' ? 'bg-[#0ecb81]' : 'bg-[#f6465d]'
                }`} />
              )}
            </button>
          );
        })}
      </div>

      {/* Asset pills + dropdowns — single row */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex items-center rounded-xl bg-muted/35 p-1">
          {CRYPTOS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange({ ...value, crypto: c })}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-150 ${
                value.crypto === c
                  ? 'bg-card text-foreground shadow-sm ring-1 ring-border/30'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="hidden h-6 w-px bg-border/30 sm:block" />

        <select
          value={value.fiat}
          onChange={(e) => onChange({ ...value, fiat: e.target.value })}
          className="h-10 min-w-[5.5rem] rounded-xl border border-border/40 bg-background px-3 text-sm font-medium text-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/15"
        >
          {FIATS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>

        <select
          value={value.paymentCode}
          onChange={(e) => onChange({ ...value, paymentCode: e.target.value })}
          className="h-10 min-w-[10rem] rounded-xl border border-border/40 bg-background px-3 text-sm font-medium text-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/15"
        >
          {PAYMENT_FILTERS.map((p) => <option key={p.value || 'all'} value={p.value}>{p.label}</option>)}
        </select>

        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="ml-auto flex h-10 w-10 items-center justify-center rounded-xl border border-border/40 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            aria-label="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
