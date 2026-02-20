'use client';

import { Loader2 } from 'lucide-react';

interface SpotOrderEntryPanelProps {
  side: 'buy' | 'sell';
  orderType: 'limit' | 'market';
  price: string;
  quantity: string;
  total: string;
  baseAsset: string;
  quoteAsset: string;
  availableBalance: string;
  makerFeePercent?: number;
  takerFeePercent?: number;
  canSubmit: boolean;
  loading: boolean;
  onSideChange: (side: 'buy' | 'sell') => void;
  onOrderTypeChange: (type: 'limit' | 'market') => void;
  onPriceChange: (v: string) => void;
  onQuantityChange: (v: string) => void;
  onSetMaxQty: () => void;
  onSubmit: () => void;
}

export function SpotOrderEntryPanel({
  side,
  orderType,
  price,
  quantity,
  total,
  baseAsset,
  quoteAsset,
  availableBalance,
  makerFeePercent,
  takerFeePercent,
  canSubmit,
  loading,
  onSideChange,
  onOrderTypeChange,
  onPriceChange,
  onQuantityChange,
  onSetMaxQty,
  onSubmit,
}: SpotOrderEntryPanelProps) {
  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0b0e11] border-l border-white/5">
      <div className="flex border-b border-white/5">
        <button
          type="button"
          onClick={() => onSideChange('buy')}
          className={`flex-1 py-2.5 text-sm font-medium ${
            side === 'buy' ? 'bg-green-500/20 text-green-500 border-b-2 border-green-500 opacity-100' : 'text-gray-500 opacity-60'
          }`}
        >
          Buy
        </button>
        <button
          type="button"
          onClick={() => onSideChange('sell')}
          className={`flex-1 py-2.5 text-sm font-medium ${
            side === 'sell' ? 'bg-red-500/20 text-red-500 border-b-2 border-red-500 opacity-100' : 'text-gray-500 opacity-60'
          }`}
        >
          Sell
        </button>
      </div>
      <div className="flex gap-1 p-2 border-b border-white/5">
        <button
          type="button"
          onClick={() => onOrderTypeChange('limit')}
          className={`flex-1 py-1.5 text-xs font-medium rounded ${
            orderType === 'limit' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-400'
          }`}
        >
          Limit
        </button>
        <button
          type="button"
          onClick={() => onOrderTypeChange('market')}
          className={`flex-1 py-1.5 text-xs font-medium rounded ${
            orderType === 'market' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-400'
          }`}
        >
          Market
        </button>
      </div>
      <div className="flex-1 min-h-0 p-3 space-y-2">
        {orderType === 'limit' && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Price</label>
            <input
              type="text"
              inputMode="decimal"
              value={price}
              onChange={(e) => onPriceChange(e.target.value)}
              className="w-full h-9 px-2 bg-white/5 rounded border border-white/5 text-white text-sm font-mono tabular-nums focus:outline-none focus:border-white/20"
              placeholder="0"
            />
          </div>
        )}
        <div>
          <label className="block text-xs text-gray-500 mb-1">Quantity</label>
          <div className="flex gap-1">
            <input
              type="text"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => onQuantityChange(e.target.value)}
              className="flex-1 min-w-0 h-9 px-2 bg-white/5 rounded border border-white/5 text-white text-sm font-mono tabular-nums focus:outline-none focus:border-white/20"
              placeholder="0"
            />
            <button
              type="button"
              onClick={onSetMaxQty}
              className="px-2 h-9 text-xs text-blue-400 hover:text-blue-300"
            >
              Max
            </button>
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Total</label>
          <div className="h-9 px-2 flex items-center bg-white/5 rounded border border-white/5 text-gray-400 text-sm font-mono tabular-nums">
            {total}
          </div>
        </div>
      </div>
      <div className="p-2 border-t border-white/5 text-xs text-gray-500 space-y-1">
        <div className="flex justify-between">
          <span>Available</span>
          <span className="font-mono tabular-nums text-gray-400">{availableBalance}</span>
        </div>
        {(makerFeePercent != null || takerFeePercent != null) && (
          <div className="flex justify-between text-gray-500">
            <span>Fee</span>
            <span className="font-mono tabular-nums">Maker {makerFeePercent != null ? (makerFeePercent * 100).toFixed(2) : '—'}% · Taker {takerFeePercent != null ? (takerFeePercent * 100).toFixed(2) : '—'}%</span>
          </div>
        )}
      </div>
      <div className="p-3">
        <button
          type="button"
          disabled={!canSubmit || loading}
          onClick={onSubmit}
          className={`w-full h-10 rounded text-sm font-medium flex items-center justify-center gap-2 ${
            side === 'buy'
              ? 'bg-green-500 hover:bg-green-600 text-white disabled:opacity-30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:select-none'
              : 'bg-red-500 hover:bg-red-600 text-white disabled:opacity-30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:select-none'
          }`}
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {side === 'buy' ? 'Buy' : 'Sell'} {baseAsset}
        </button>
      </div>
    </div>
  );
}
