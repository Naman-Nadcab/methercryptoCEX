'use client';

import { useState } from 'react';
import { X, MessageCircle, Clock, Shield, Check } from 'lucide-react';
import type { P2PMerchantRow } from './P2PMerchantTable';
import { P2PPaymentMethodIcons } from './P2PPaymentMethodIcons';

interface P2PTradeWindowProps {
  open: boolean;
  type: 'buy' | 'sell';
  merchant: P2PMerchantRow | null;
  fiat: string;
  crypto: string;
  onClose: () => void;
  onConfirmPayment: () => void;
}

export function P2PTradeWindow({
  open,
  type,
  merchant,
  fiat,
  crypto,
  onClose,
  onConfirmPayment,
}: P2PTradeWindowProps) {
  const [countdown] = useState(900); // 15 min placeholder
  const [chatMessage, setChatMessage] = useState('');

  if (!open) return null;

  const minutes = Math.floor(countdown / 60);
  const seconds = countdown % 60;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div
        className="exchange-ui w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col bg-card border border-border rounded-xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-heading font-semibold text-foreground">
            {type === 'buy' ? 'Buy' : 'Sell'} {crypto} - Order details
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 py-3 bg-primary/10 border-b border-primary/20 flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary flex-shrink-0" />
          <p className="text-small text-foreground">
            Funds are secured in escrow until payment is confirmed.
          </p>
        </div>

        {merchant && (
          <div className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0">
            <div>
              <p className="text-[11px] text-muted-foreground mb-1">Merchant</p>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-foreground font-medium">{merchant.merchantName}</p>
                {merchant.isVerified && (
                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded bg-primary/15 text-primary text-[11px] font-medium">
                    <Check className="w-3 h-3" strokeWidth={2.5} /> Verified
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-[11px] text-muted-foreground">
                <span>Completion {merchant.completionRate}%</span>
                {(merchant.totalTrades ?? 0) > 0 && <span>Trades {merchant.totalTrades}</span>}
                {(merchant.averageReleaseTimeMin ?? 0) > 0 && (
                  <span>Release {merchant.averageReleaseTimeMin} min</span>
                )}
              </div>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground mb-1">Price</p>
              <p className="text-foreground font-mono text-heading">{merchant.price} {fiat}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground mb-1">Limit</p>
              <p className="text-foreground font-mono">{merchant.limitMin} - {merchant.limitMax} {fiat}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground mb-2">Payment methods</p>
              <P2PPaymentMethodIcons methods={merchant.paymentMethods} className="text-[11px]" />
            </div>
            <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-muted border border-border">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-small text-foreground">Time remaining</span>
              <span className="font-mono tabular-nums text-primary ml-auto">
                {minutes}:{seconds.toString().padStart(2, '0')}
              </span>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground mb-2 flex items-center gap-1">
                <MessageCircle className="w-3.5 h-3.5" /> Trade chat
              </p>
              <div className="min-h-[100px] rounded-lg bg-muted border border-border p-3 text-small text-muted-foreground mb-2">
                No messages yet. Confirm payment details with the merchant here.
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Type a message..."
                  value={chatMessage}
                  onChange={(e) => setChatMessage(e.target.value)}
                  className="flex-1 h-9 px-3 rounded-lg bg-background border border-input text-foreground text-small placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg bg-muted text-foreground text-small font-medium hover:bg-muted/80"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="p-4 border-t border-border">
          <button
            type="button"
            onClick={onConfirmPayment}
            className={`w-full py-3 rounded-lg font-medium text-primary-foreground transition-colors ${
              type === 'buy'
                ? 'bg-primary hover:bg-primary/90'
                : 'bg-destructive hover:bg-destructive/90'
            }`}
          >
            Confirm payment
          </button>
        </div>
      </div>
    </div>
  );
}
