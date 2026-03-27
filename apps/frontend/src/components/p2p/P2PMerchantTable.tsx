'use client';

import { Check } from 'lucide-react';
import { SkeletonTableBody } from '@/components/ui/Skeleton';
import { P2PPaymentMethodIcons } from './P2PPaymentMethodIcons';

export type P2PMerchantRow = {
  id: string;
  merchantName: string;
  price: string;
  available: string;
  limitMin: string;
  limitMax: string;
  paymentMethods: string[];
  completionRate: number;
  totalTrades?: number;
  averageReleaseTimeMin?: number;
  isVerified?: boolean;
};

interface P2PMerchantTableProps {
  type: 'buy' | 'sell';
  rows: P2PMerchantRow[];
  loading?: boolean;
  onBuy: (row: P2PMerchantRow) => void;
  onSell: (row: P2PMerchantRow) => void;
}

export function P2PMerchantTable({ type, rows, loading, onBuy, onSell }: P2PMerchantTableProps) {
  return (
    <div className="exchange-ui flex-1 min-h-0 flex flex-col bg-card overflow-hidden">
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-small border-collapse">
          <thead className="sticky top-0 bg-card z-10 border-b border-border">
            <tr className="text-muted-foreground font-medium text-[11px] uppercase tracking-wide">
              <th className="text-left py-3 px-4">Merchant</th>
              <th className="text-right py-3 px-4">Price</th>
              <th className="text-right py-3 px-4">Available</th>
              <th className="text-right py-3 px-4">Limit</th>
              <th className="text-left py-3 px-4">Payment</th>
              <th className="text-right py-3 px-4 w-28">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonTableBody rows={6} columns={6} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-muted-foreground">
                  No merchants found. Try different filters.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border hover:bg-muted/50 transition-colors"
                >
                  <td className="py-2.5 px-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-foreground font-medium">{row.merchantName}</span>
                        {row.isVerified && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary/15 text-primary text-[10px] font-medium">
                            <Check className="w-3 h-3" strokeWidth={2.5} /> Verified
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span>Completion {row.completionRate}%</span>
                        {(row.totalTrades ?? 0) > 0 && <span>Trades {row.totalTrades}</span>}
                        {(row.averageReleaseTimeMin ?? 0) > 0 && (
                          <span>Release {row.averageReleaseTimeMin} min</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-foreground">
                    {row.price}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-foreground">
                    {row.available}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-muted-foreground">
                    {row.limitMin} - {row.limitMax}
                  </td>
                  <td className="py-2.5 px-4">
                    <P2PPaymentMethodIcons methods={row.paymentMethods} />
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <div className="flex gap-1.5 justify-end">
                      <button
                        type="button"
                        onClick={() => onBuy(row)}
                        className="px-3 py-1.5 rounded text-[11px] font-medium bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
                      >
                        Buy
                      </button>
                      <button
                        type="button"
                        onClick={() => onSell(row)}
                        className="px-3 py-1.5 rounded text-[11px] font-medium bg-destructive/20 text-destructive hover:bg-destructive/30 transition-colors"
                      >
                        Sell
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
