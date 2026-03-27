'use client';

import { ShoppingCart, Banknote } from 'lucide-react';

const CRYPTO_OPTIONS = ['USDT', 'BTC', 'ETH', 'USDC'];
const FIAT_OPTIONS = ['INR', 'USD', 'EUR', 'GBP'];
const PAYMENT_OPTIONS = ['All', 'Bank Transfer', 'UPI', 'PayPal', 'PayTM'];

interface P2PFiltersProps {
  type: 'buy' | 'sell';
  crypto: string;
  fiat: string;
  paymentMethod: string;
  amount: string;
  onTypeChange: (t: 'buy' | 'sell') => void;
  onCryptoChange: (c: string) => void;
  onFiatChange: (f: string) => void;
  onPaymentMethodChange: (p: string) => void;
  onAmountChange: (a: string) => void;
}

export function P2PFilters({
  type,
  crypto,
  fiat,
  paymentMethod,
  amount,
  onTypeChange,
  onCryptoChange,
  onFiatChange,
  onPaymentMethodChange,
  onAmountChange,
}: P2PFiltersProps) {
  return (
    <div className="exchange-ui flex flex-wrap items-end gap-4 p-4 bg-card border-b border-border">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onTypeChange('buy')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-small font-medium transition-all ${
            type === 'buy'
              ? 'bg-primary/20 text-primary border border-primary/40'
              : 'bg-muted text-muted-foreground border border-border hover:text-foreground hover:bg-muted/80'
          }`}
        >
          <ShoppingCart className="w-4 h-4" />
          Buy
        </button>
        <button
          type="button"
          onClick={() => onTypeChange('sell')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-small font-medium transition-all ${
            type === 'sell'
              ? 'bg-destructive/20 text-destructive border border-destructive/40'
              : 'bg-muted text-muted-foreground border border-border hover:text-foreground hover:bg-muted/80'
          }`}
        >
          <Banknote className="w-4 h-4" />
          Sell
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">Fiat</span>
          <select
            value={fiat}
            onChange={(e) => onFiatChange(e.target.value)}
            className="h-9 min-w-[100px] px-3 rounded-lg bg-background border border-input text-foreground text-small focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {FIAT_OPTIONS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">Crypto</span>
          <select
            value={crypto}
            onChange={(e) => onCryptoChange(e.target.value)}
            className="h-9 min-w-[100px] px-3 rounded-lg bg-background border border-input text-foreground text-small focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {CRYPTO_OPTIONS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">Payment</span>
          <select
            value={paymentMethod}
            onChange={(e) => onPaymentMethodChange(e.target.value)}
            className="h-9 min-w-[140px] px-3 rounded-lg bg-background border border-input text-foreground text-small focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {PAYMENT_OPTIONS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">Amount</span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(e) => onAmountChange(e.target.value)}
            className="h-9 w-28 px-3 rounded-lg bg-background border border-input text-foreground text-small font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
      </div>
    </div>
  );
}
