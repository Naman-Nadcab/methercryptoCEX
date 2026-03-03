'use client';

import { Loader2 } from 'lucide-react';

export type SpotOrderType = 'limit' | 'market' | 'stop_loss' | 'stop_limit' | 'trailing_stop_market';
export type TimeInForce = 'gtc' | 'ioc' | 'fok';

interface SpotOrderEntryPanelProps {
  side: 'buy' | 'sell';
  orderType: SpotOrderType;
  price: string;
  stopPrice: string;
  trailingDelta?: string;
  quantity: string;
  total: string;
  baseAsset: string;
  quoteAsset: string;
  availableBalance: string;
  makerFeePercent?: number;
  takerFeePercent?: number;
  timeInForce?: TimeInForce;
  canSubmit: boolean;
  loading: boolean;
  /** For market orders: estimated avg fill price from orderbook */
  estimatedFillPrice?: string | null;
  /** For market orders: estimated slippage % vs last price */
  estimatedSlippagePct?: number | null;
  onSideChange: (side: 'buy' | 'sell') => void;
  onOrderTypeChange: (type: SpotOrderType) => void;
  onPriceChange: (v: string) => void;
  onStopPriceChange: (v: string) => void;
  onTrailingDeltaChange?: (v: string) => void;
  onQuantityChange: (v: string) => void;
  onSetMaxQty: () => void;
  /** Set quantity to given fraction of available (0.25, 0.5, 0.75, 1). Used for 25%/50%/75%/100% shortcuts. */
  onSetQtyPercent?: (percent: number) => void;
  onTimeInForceChange?: (tif: TimeInForce) => void;
  onSubmit: () => void;
}

export function SpotOrderEntryPanel({
  side,
  orderType,
  price,
  stopPrice,
  trailingDelta,
  quantity,
  total,
  baseAsset,
  quoteAsset,
  availableBalance,
  makerFeePercent,
  takerFeePercent,
  timeInForce,
  canSubmit,
  loading,
  estimatedFillPrice,
  estimatedSlippagePct,
  onSideChange,
  onOrderTypeChange,
  onPriceChange,
  onStopPriceChange,
  onTrailingDeltaChange,
  onQuantityChange,
  onSetMaxQty,
  onSetQtyPercent,
  onTimeInForceChange,
  onSubmit,
}: SpotOrderEntryPanelProps) {
  const showPrice = orderType === 'limit' || orderType === 'stop_limit';
  const showStopPrice = orderType === 'stop_loss' || orderType === 'stop_limit';
  const showTrailingDelta = orderType === 'trailing_stop_market';
  const showTif = orderType === 'limit' || orderType === 'stop_limit';
  const tif = timeInForce ?? 'gtc';

  const priceNum = parseFloat(price || '0') || (orderType === 'limit' || orderType === 'stop_limit' ? 0 : parseFloat(stopPrice || '0'));
  const qtyNum = parseFloat(quantity || '0') || 0;
  const fillPrice = orderType === 'market' && estimatedFillPrice ? parseFloat(estimatedFillPrice) : priceNum;
  const notional = (orderType === 'market' ? fillPrice : priceNum) * qtyNum;
  const feeRate = orderType === 'market' ? (takerFeePercent ?? 0.001) : Math.max(makerFeePercent ?? 0.001, takerFeePercent ?? 0.001);
  const estimatedFee = notional > 0 ? (notional * feeRate).toFixed(6) : '0';
  const netReceived = notional > 0
    ? (side === 'buy'
      ? (qtyNum * (1 - feeRate)).toFixed(8)
      : (notional * (1 - feeRate)).toFixed(8))
    : '0';
  const netReceivedAsset = side === 'buy' ? baseAsset : quoteAsset;
  const slippageWarning = orderType === 'market' && estimatedSlippagePct != null && estimatedSlippagePct > 0.5;

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0b0e11] border-l border-white/5">
      <div className="flex border-b border-white/5">
        <button
          type="button"
          onClick={() => onSideChange('buy')}
          aria-label="Buy"
          aria-pressed={side === 'buy'}
          className={`flex-1 py-2.5 text-sm font-medium ${
            side === 'buy' ? 'bg-green-500/20 text-green-500 border-b-2 border-green-500 opacity-100' : 'text-gray-500 opacity-60'
          }`}
        >
          Buy
        </button>
        <button
          type="button"
          onClick={() => onSideChange('sell')}
          aria-label="Sell"
          aria-pressed={side === 'sell'}
          className={`flex-1 py-2.5 text-sm font-medium ${
            side === 'sell' ? 'bg-red-500/20 text-red-500 border-b-2 border-red-500 opacity-100' : 'text-gray-500 opacity-60'
          }`}
        >
          Sell
        </button>
      </div>
      <div className="flex flex-wrap gap-1 p-2 border-b border-white/5">
        <button
          type="button"
          onClick={() => onOrderTypeChange('limit')}
          className={`py-1.5 px-1.5 text-xs font-medium rounded ${
            orderType === 'limit' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-400'
          }`}
        >
          Limit
        </button>
        <button
          type="button"
          onClick={() => onOrderTypeChange('market')}
          className={`py-1.5 px-1.5 text-xs font-medium rounded ${
            orderType === 'market' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-400'
          }`}
        >
          Market
        </button>
        <button
          type="button"
          onClick={() => onOrderTypeChange('stop_loss')}
          className={`py-1.5 px-1.5 text-xs font-medium rounded ${
            orderType === 'stop_loss' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-400'
          }`}
        >
          Stop
        </button>
        <button
          type="button"
          onClick={() => onOrderTypeChange('stop_limit')}
          className={`py-1.5 px-1.5 text-xs font-medium rounded ${
            orderType === 'stop_limit' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-400'
          }`}
        >
          Stop Limit
        </button>
        <button
          type="button"
          onClick={() => onOrderTypeChange('trailing_stop_market')}
          className={`py-1.5 px-1.5 text-xs font-medium rounded ${
            orderType === 'trailing_stop_market' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-400'
          }`}
          aria-label="Trailing stop market order"
        >
          Trailing Stop
        </button>
      </div>
      <div className="flex-1 min-h-0 p-3 space-y-2 overflow-y-auto">
        {showTrailingDelta && (
          <div>
            <label htmlFor="spot-trailing-delta" className="block text-xs text-gray-500 mb-1">Callback rate % (e.g. 0.5)</label>
            <input
              id="spot-trailing-delta"
              type="text"
              inputMode="decimal"
              value={trailingDelta ?? ''}
              onChange={(e) => onTrailingDeltaChange?.(e.target.value)}
              aria-label="Trailing stop callback rate in percent"
              className="w-full h-9 px-2 bg-white/5 rounded border border-white/5 text-white text-sm font-mono tabular-nums focus:outline-none focus:border-white/20"
              placeholder="0.5"
            />
          </div>
        )}
        {showStopPrice && (
          <div>
            <label htmlFor="spot-trigger-price" className="block text-xs text-gray-500 mb-1">Trigger price (stop)</label>
            <input
              id="spot-trigger-price"
              type="text"
              inputMode="decimal"
              value={stopPrice}
              onChange={(e) => onStopPriceChange(e.target.value)}
              aria-label="Trigger price for stop order"
              className="w-full h-9 px-2 bg-white/5 rounded border border-white/5 text-white text-sm font-mono tabular-nums focus:outline-none focus:border-white/20"
              placeholder="0"
            />
          </div>
        )}
        {showTif && onTimeInForceChange && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Time in force</label>
            <div className="flex gap-1">
              {(['gtc', 'ioc', 'fok'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => onTimeInForceChange(v)}
                  className={`flex-1 py-1.5 text-[10px] font-medium rounded uppercase ${
                    tif === v ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-400'
                  }`}
                  title={v === 'gtc' ? 'Good Till Cancelled' : v === 'ioc' ? 'Immediate Or Cancel' : 'Fill Or Kill'}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        )}
        {showPrice && (
          <div>
            <label htmlFor="spot-price" className="block text-xs text-gray-500 mb-1">Price</label>
            <input
              id="spot-price"
              type="text"
              inputMode="decimal"
              value={price}
              onChange={(e) => onPriceChange(e.target.value)}
              aria-label="Limit price"
              className="w-full h-9 px-2 bg-white/5 rounded border border-white/5 text-white text-sm font-mono tabular-nums focus:outline-none focus:border-white/20"
              placeholder={orderType === 'stop_limit' ? 'Limit price' : '0'}
            />
          </div>
        )}
        <div>
          <label htmlFor="spot-quantity" className="block text-xs text-gray-500 mb-1">Quantity</label>
          <div className="flex gap-1">
            <input
              id="spot-quantity"
              type="text"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => onQuantityChange(e.target.value)}
              aria-label="Order quantity"
              className="flex-1 min-w-0 h-9 px-2 bg-white/5 rounded border border-white/5 text-white text-sm font-mono tabular-nums focus:outline-none focus:border-white/20"
              placeholder="0"
            />
            <button
              type="button"
              onClick={onSetMaxQty}
              className="px-2 h-9 text-xs text-blue-400 hover:text-blue-300"
              aria-label="Set quantity to maximum available"
            >
              Max
            </button>
          </div>
          {onSetQtyPercent && (
            <div className="flex gap-1 mt-1">
              {([0.25, 0.5, 0.75, 1] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => onSetQtyPercent(p)}
                  aria-label={`Set quantity to ${p * 100}% of available`}
                  className="flex-1 h-7 text-[10px] text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded"
                >
                  {p * 100}%
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Total</label>
          <div className="h-9 px-2 flex items-center bg-white/5 rounded border border-white/5 text-gray-400 text-sm font-mono tabular-nums">
            {total}
          </div>
        </div>
        {orderType === 'market' && estimatedFillPrice && qtyNum > 0 && (
          <div className="text-[10px] text-gray-500 space-y-0.5">
            <div className="flex justify-between">
              <span>Est. avg fill</span>
              <span className="font-mono tabular-nums text-gray-400">{estimatedFillPrice}</span>
            </div>
            {estimatedSlippagePct != null && (
              <div className={`flex justify-between ${slippageWarning ? 'text-amber-400' : ''}`}>
                <span>Est. slippage</span>
                <span className="font-mono tabular-nums">{estimatedSlippagePct.toFixed(2)}%</span>
              </div>
            )}
          </div>
        )}
        {slippageWarning && (
          <div className="px-2 py-1.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px]">
            Slippage &gt; 0.5%. Consider using a limit order for better execution.
          </div>
        )}
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
        {notional > 0 && (
          <>
            <div className="flex justify-between text-gray-500">
              <span>Est. fee</span>
              <span className="font-mono tabular-nums text-gray-400">{estimatedFee} {side === 'buy' ? quoteAsset : baseAsset}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Net {side === 'buy' ? 'received' : 'received'}</span>
              <span className="font-mono tabular-nums">{netReceived} {netReceivedAsset}</span>
            </div>
          </>
        )}
      </div>
      <div className="p-3">
        <button
          type="button"
          disabled={!canSubmit || loading}
          onClick={onSubmit}
          aria-label={side === 'buy' ? `Buy ${baseAsset}` : `Sell ${baseAsset}`}
          aria-busy={loading}
          className={`w-full h-10 rounded text-sm font-medium flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0e11] ${
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
