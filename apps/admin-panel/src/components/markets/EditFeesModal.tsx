'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import type { MarketRow } from '@/lib/markets-api';

export interface EditFeesModalProps {
  open: boolean;
  market: MarketRow | null;
  onClose: () => void;
  onConfirm: (makerFee: number, takerFee: number) => void | Promise<void>;
  isLoading?: boolean;
}

export function EditFeesModal({
  open,
  market,
  onClose,
  onConfirm,
  isLoading,
}: EditFeesModalProps) {
  const [makerFee, setMakerFee] = useState('0.1');
  const [takerFee, setTakerFee] = useState('0.1');

  useEffect(() => {
    if (market && open) {
      const m = market.maker_fee != null ? parseFloat(String(market.maker_fee)) : 0.001;
      const t = market.taker_fee != null ? parseFloat(String(market.taker_fee)) : 0.001;
      setMakerFee((m * 100).toFixed(2));
      setTakerFee((t * 100).toFixed(2));
    }
  }, [market, open]);

  const handleConfirm = () => {
    const m = parseFloat(makerFee);
    const t = parseFloat(takerFee);
    if (!Number.isFinite(m) || m < 0 || m > 100 || !Number.isFinite(t) || t < 0 || t > 100) return;
    onConfirm(m / 100, t / 100);
  };

  const makerNum = parseFloat(makerFee);
  const takerNum = parseFloat(takerFee);
  const valid =
    Number.isFinite(makerNum) &&
    makerNum >= 0 &&
    makerNum <= 100 &&
    Number.isFinite(takerNum) &&
    takerNum >= 0 &&
    takerNum <= 100;

  if (!open) return null;
  const symbol =
    market?.base_asset && market?.quote_asset
      ? `${market.base_asset}/${market.quote_asset}`
      : (market?.symbol ?? '').replace(/_/g, '/');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-gray-900">Edit Fees</h3>
        {symbol && (
          <p className="mt-1 text-sm font-medium text-admin-muted">Market: {symbol}</p>
        )}
        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="edit-maker-fee" className="block text-sm font-medium text-gray-700">
              Maker Fee (%)
            </label>
            <input
              id="edit-maker-fee"
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={makerFee}
              onChange={(e) => setMakerFee(e.target.value)}
              className="mt-1 w-full rounded-lg border border-admin-border bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-admin-primary"
            />
          </div>
          <div>
            <label htmlFor="edit-taker-fee" className="block text-sm font-medium text-gray-700">
              Taker Fee (%)
            </label>
            <input
              id="edit-taker-fee"
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={takerFee}
              onChange={(e) => setTakerFee(e.target.value)}
              className="mt-1 w-full rounded-lg border border-admin-border bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-admin-primary"
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isLoading || !valid}>
            {isLoading ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
