'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Dropdown';
import { useAdminAuthStore } from '@/store/auth';
import { getAvailableBaseCurrencies, getQuoteAssets } from '@/lib/markets-api';

interface CreatePairFormData {
  base_currency: string;
  quote_asset: string;
  min_order_size: string;
  maker_fee: string;
  taker_fee: string;
  price_precision: string;
  qty_precision: string;
  is_active: boolean;
}

const INITIAL: CreatePairFormData = {
  base_currency: '',
  quote_asset: '',
  min_order_size: '0.001',
  maker_fee: '0.1',
  taker_fee: '0.1',
  price_precision: '8',
  qty_precision: '8',
  is_active: true,
};

export interface CreatePairModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (data: {
    base_currency: string;
    quote_asset: string;
    min_order_size?: number;
    maker_fee?: number;
    taker_fee?: number;
    price_precision?: number;
    qty_precision?: number;
    is_active?: boolean;
  }) => void;
  isLoading?: boolean;
}

export function CreatePairModal({ open, onClose, onConfirm, isLoading }: CreatePairModalProps) {
  const token = useAdminAuthStore((s) => s.accessToken);
  const [form, setForm] = useState<CreatePairFormData>(INITIAL);

  useEffect(() => {
    if (open) setForm(INITIAL);
  }, [open]);

  const baseCurrenciesQ = useQuery({
    queryKey: ['admin', 'settings', 'base-currencies', token],
    queryFn: () => getAvailableBaseCurrencies(token),
    enabled: !!token && open,
    staleTime: 60_000,
  });

  const quoteAssetsQ = useQuery({
    queryKey: ['admin', 'settings', 'quote-assets', token],
    queryFn: () => getQuoteAssets(token),
    enabled: !!token && open,
    staleTime: 60_000,
  });

  const baseCurrencies = baseCurrenciesQ.data?.data?.currencies ?? [];
  const quoteAssets = quoteAssetsQ.data?.data?.assets ?? [];

  const set = (key: keyof CreatePairFormData, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const makerFee = parseFloat(form.maker_fee);
  const takerFee = parseFloat(form.taker_fee);
  const minOrder = parseFloat(form.min_order_size);
  const pricePrecision = parseInt(form.price_precision, 10);
  const qtyPrecision = parseInt(form.qty_precision, 10);

  const valid =
    form.base_currency &&
    form.quote_asset &&
    Number.isFinite(makerFee) && makerFee >= 0 && makerFee <= 100 &&
    Number.isFinite(takerFee) && takerFee >= 0 && takerFee <= 100 &&
    Number.isFinite(minOrder) && minOrder >= 0 &&
    Number.isFinite(pricePrecision) && pricePrecision >= 0 &&
    Number.isFinite(qtyPrecision) && qtyPrecision >= 0;

  const handleConfirm = () => {
    if (!valid) return;
    onConfirm({
      base_currency: form.base_currency,
      quote_asset: form.quote_asset,
      min_order_size: minOrder,
      maker_fee: makerFee / 100,
      taker_fee: takerFee / 100,
      price_precision: pricePrecision,
      qty_precision: qtyPrecision,
      is_active: form.is_active,
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="Create Trading Pair" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Base Currency"
            placeholder="Select base…"
            value={form.base_currency}
            onChange={(v) => set('base_currency', v)}
            options={baseCurrencies.map((c) => ({ value: c.symbol, label: c.name ? `${c.symbol} — ${c.name}` : c.symbol }))}
          />
          <Select
            label="Quote Asset"
            placeholder="Select quote…"
            value={form.quote_asset}
            onChange={(v) => set('quote_asset', v)}
            options={quoteAssets.map((a) => ({ value: a.symbol, label: a.name ? `${a.symbol} — ${a.name}` : a.symbol }))}
          />
        </div>

        <Input
          label="Min Order Size"
          type="number"
          min={0}
          step="any"
          value={form.min_order_size}
          onChange={(e) => set('min_order_size', e.target.value)}
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Maker Fee (%)"
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={form.maker_fee}
            onChange={(e) => set('maker_fee', e.target.value)}
          />
          <Input
            label="Taker Fee (%)"
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={form.taker_fee}
            onChange={(e) => set('taker_fee', e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Price Precision"
            type="number"
            min={0}
            max={18}
            step={1}
            value={form.price_precision}
            onChange={(e) => set('price_precision', e.target.value)}
          />
          <Input
            label="Quantity Precision"
            type="number"
            min={0}
            max={18}
            step={1}
            value={form.qty_precision}
            onChange={(e) => set('qty_precision', e.target.value)}
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => set('is_active', e.target.checked)}
            className="h-4 w-4 rounded border-admin-border text-admin-primary focus:ring-admin-primary"
          />
          <span className="text-sm font-medium text-admin-text">Active on creation</span>
        </label>
      </div>

      <ModalFooter className="-mx-6 -mb-5 mt-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={handleConfirm} disabled={isLoading || !valid} loading={isLoading}>
          Create Pair
        </Button>
      </ModalFooter>
    </Modal>
  );
}
