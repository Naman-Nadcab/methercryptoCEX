'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  BarChart3,
  Layout,
  Settings,
  ChevronDown,
  Minimize2,
  Maximize2,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { ROUTES, walletPath } from '@/lib/routes';

/** Design-only Spot Trading page – Bybit-style layout. Logged-in vs logged-out states. Data will be wired later. */

const TIMEFRAMES = ['1s', '1m', '5m', '15m', '30m', '1H', '4H', '1D', 'W', 'M'];
const ORDER_TYPES = ['Limit', 'Market', 'TP/SL'];
const BOTTOM_TABS_LOGGED_IN = ['Open Orders', 'Order History', 'Trade History', 'Assets'];

// Placeholder orderbook rows (qtyPct = normalized depth for bar width)
const PLACEHOLDER_ASKS = [
  { price: '67,832.5', qty: '0.015', qtyPct: 15 },
  { price: '67,831.8', qty: '0.234', qtyPct: 45 },
  { price: '67,831.2', qty: '1.456', qtyPct: 85 },
  { price: '67,830.6', qty: '0.892', qtyPct: 55 },
  { price: '67,830.0', qty: '2.103', qtyPct: 100 },
];
const PLACEHOLDER_BIDS = [
  { price: '67,828.7', qty: '0.124', qtyPct: 25 },
  { price: '67,828.1', qty: '0.567', qtyPct: 60 },
  { price: '67,827.5', qty: '1.234', qtyPct: 95 },
  { price: '67,826.9', qty: '0.345', qtyPct: 40 },
  { price: '67,826.3', qty: '0.678', qtyPct: 70 },
];

export function SpotTradingDesign() {
  const { accessToken } = useAuthStore();
  const isAuth = Boolean(accessToken);

  const [orderbookTab, setOrderbookTab] = useState<'orderbook' | 'trades'>('orderbook');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState(0);
  const [bottomTab, setBottomTab] = useState(0);
  const [sliderPct, setSliderPct] = useState(0);

  return (
    <div className="h-full min-h-[calc(100vh-48px)] w-full flex flex-col bg-[#0b0e11] text-white font-sans">
      {/* Pair header */}
      <header className="h-14 flex-shrink-0 flex items-center justify-between px-5 border-b border-white/[0.06] bg-[#0b0e11]">
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-2 py-1 rounded hover:bg-card/5 transition-colors">
            <span className="text-base font-semibold text-white">BTC/USDT</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-card/10 text-gray-400 uppercase tracking-wide">
              Spot
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
          </button>
        </div>
        <div className="flex items-center gap-6 text-xs">
          <div>
            <span className="text-gray-500 mr-1">Last Price</span>
            <span className="text-white font-medium tabular-nums">67,828.7</span>
          </div>
          <div>
            <span className="text-gray-500 mr-1">24h Change</span>
            <span className="text-buy font-medium tabular-nums">+0.12%</span>
          </div>
          <div>
            <span className="text-gray-500 mr-1">24h High</span>
            <span className="text-gray-300 tabular-nums">68,245.2</span>
          </div>
          <div>
            <span className="text-gray-500 mr-1">24h Low</span>
            <span className="text-gray-300 tabular-nums">67,102.8</span>
          </div>
          <div>
            <span className="text-gray-500 mr-1">24h Turnover</span>
            <span className="text-gray-300 tabular-nums">1,234.56 BTC</span>
          </div>
        </div>
      </header>

      {/* Main grid: Chart | Orderbook/Recent Trades | Spot Trade – three columns side by side */}
      <div className="flex-1 min-h-0 flex gap-px bg-card/[0.04]">
        {/* Column 1: Chart area */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0 bg-[#0b0e11]">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06] gap-2">
            <div className="flex items-center gap-1">
              <button className="px-2 py-1 text-xs font-medium text-white bg-card/10 rounded hover:bg-card/15 transition-colors">
                Candlestick
              </button>
              <button className="px-2 py-1 text-xs text-gray-500 rounded hover:bg-card/5 hover:text-gray-400 transition-colors">
                Line
              </button>
              <button className="px-2 py-1 text-xs text-gray-500 rounded hover:bg-card/5 hover:text-gray-400 transition-colors">
                Area
              </button>
            </div>
            <div className="flex items-center gap-0.5">
              {TIMEFRAMES.map((tf, i) => (
                <button
                  key={tf}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    i === 2 ? 'bg-card/10 text-white' : 'text-gray-500 hover:text-gray-400 hover:bg-card/5'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-0.5">
              <button className="p-1.5 text-gray-500 rounded hover:bg-card/5 hover:text-gray-400" title="Drawing tools">
                <Layout className="w-3.5 h-3.5" />
              </button>
              <button className="p-1.5 text-gray-500 rounded hover:bg-card/5 hover:text-gray-400" title="Settings">
                <Settings className="w-3.5 h-3.5" />
              </button>
              <button className="p-1.5 text-gray-500 rounded hover:bg-card/5 hover:text-gray-400" title="Minimize">
                <Minimize2 className="w-3.5 h-3.5" />
              </button>
              <button className="p-1.5 text-gray-500 rounded hover:bg-card/5 hover:text-gray-400" title="Fullscreen">
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center bg-[#0d1015] border-b border-white/[0.04]">
            <div className="text-center">
              <BarChart3 className="w-16 h-16 text-gray-600/50 mx-auto mb-3" />
              <p className="text-sm text-gray-500">Chart area</p>
              <p className="text-xs text-gray-600 mt-1">Data will be loaded here</p>
            </div>
          </div>

          {/* Volume bar placeholder */}
          <div className="h-16 flex-shrink-0 flex items-end px-3 pb-2 gap-px bg-[#0b0e11]">
            {[45, 32, 58, 28, 62, 38, 55, 42, 48, 35, 52, 40, 60, 30, 50, 45, 55, 38, 42, 48].map((h, i) => (
              <div
                key={i}
                className="flex-1 min-w-[2px] bg-buy/30 rounded-t"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        </div>

        {/* Column 2: Orderbook / Recent Trades – side by side with Trade panel */}
        <div className="flex flex-col min-h-0 w-[280px] flex-shrink-0 bg-[#0b0e11]">
          {/* Orderbook / Recent Trades tabs */}
          <div className="flex border-b border-white/[0.06]">
            <button
              type="button"
              onClick={() => setOrderbookTab('orderbook')}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                orderbookTab === 'orderbook'
                  ? 'text-white border-b-2 border-buy'
                  : 'text-gray-500 hover:text-gray-400'
              }`}
            >
              Order Book
            </button>
            <button
              type="button"
              onClick={() => setOrderbookTab('trades')}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                orderbookTab === 'trades'
                  ? 'text-white border-b-2 border-buy'
                  : 'text-gray-500 hover:text-gray-400'
              }`}
            >
              Recent Trades
            </button>
          </div>

          {orderbookTab === 'orderbook' ? (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.06]">
                <button className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-400 font-mono">
                  0.1 <ChevronDown className="w-3 h-3" />
                </button>
                <div className="flex items-center gap-0.5">
                  <button className="p-1 text-gray-500 rounded hover:bg-card/5 hover:text-gray-400" title="Settings">
                    <Settings className="w-3 h-3" />
                  </button>
                  <button className="p-1 text-gray-500 rounded hover:bg-card/5 hover:text-gray-400" title="Expand">
                    <Maximize2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-3 py-1.5 border-b border-white/[0.06] text-[11px] text-gray-500 font-mono">
                <span className="text-right">Price (USDT)</span>
                <span className="text-right">Qty (BTC)</span>
                <span className="text-right">Total (USDT)</span>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                {/* Asks */}
                {PLACEHOLDER_ASKS.map((row, i) => (
                  <div
                    key={`a-${i}`}
                    className="relative grid grid-cols-[1fr_1fr_1fr] gap-2 px-3 py-0.5 h-7 items-center text-xs font-mono text-right hover:bg-sell/5 cursor-pointer group overflow-hidden"
                  >
                    <div
                      className="absolute inset-y-0 left-0 bg-sell/10"
                      style={{ width: `${row.qtyPct}%` }}
                    />
                    <span className="relative text-sell">{row.price}</span>
                    <span className="relative text-gray-500">{row.qty}</span>
                    <span className="relative text-gray-500">—</span>
                  </div>
                ))}
                {/* Current price row */}
                <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-3 py-1 h-8 items-center text-xs font-mono font-semibold bg-card/5 border-y border-white/[0.06]">
                  <span className="text-buy">↑67,828.7</span>
                  <span className="text-gray-400">—</span>
                  <span className="text-gray-400">67,828.70 USD</span>
                </div>
                {/* Bids */}
                {PLACEHOLDER_BIDS.map((row, i) => (
                  <div
                    key={`b-${i}`}
                    className="relative grid grid-cols-[1fr_1fr_1fr] gap-2 px-3 py-0.5 h-7 items-center text-xs font-mono text-right hover:bg-buy/5 cursor-pointer group overflow-hidden"
                  >
                    <div
                      className="absolute inset-y-0 left-0 bg-buy/10"
                      style={{ width: `${row.qtyPct}%` }}
                    />
                    <span className="relative text-buy">{row.price}</span>
                    <span className="relative text-gray-500">{row.qty}</span>
                    <span className="relative text-gray-500">—</span>
                  </div>
                ))}
              </div>
              {/* Volume distribution bar */}
              <div className="flex-shrink-0 px-3 py-2 border-t border-white/[0.06]">
                <div className="flex h-1.5 rounded-full overflow-hidden bg-card/5">
                  <div className="bg-buy/60" style={{ width: '41%' }} />
                  <div className="bg-sell/60" style={{ width: '59%' }} />
                </div>
                <div className="flex justify-between text-[10px] text-gray-500 mt-1 font-mono">
                  <span className="text-buy">41% Buy</span>
                  <span className="text-sell">59% Sell</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-3 py-2 border-b border-white/[0.06] text-[11px] text-gray-500 font-mono">
                <span className="text-right">Price</span>
                <span className="text-right">Amount</span>
                <span className="text-right">Time</span>
              </div>
              <div className="flex-1 overflow-y-auto px-3 py-1">
                <p className="text-xs text-gray-600 py-8 text-center">No recent trades</p>
              </div>
            </div>
          )}
        </div>

        {/* Column 3: Spot Trade panel (Buy/Sell) – rightmost. Logged-in vs Logged-out. */}
        <div className="flex flex-col min-h-0 w-[320px] flex-shrink-0 border-l border-white/[0.06] bg-[#0b0e11]">
          <div className="flex flex-col flex-1 min-h-0 overflow-auto">
            <p className="text-xs font-medium text-gray-400 px-3 pt-3 pb-1">Trade</p>
            <div className="flex">
              <button
                type="button"
                onClick={() => setSide('buy')}
                className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                  side === 'buy'
                    ? 'text-buy bg-buy/10 border-b-2 border-buy'
                    : 'text-gray-500 hover:text-gray-400'
                }`}
              >
                Buy
              </button>
              <button
                type="button"
                onClick={() => setSide('sell')}
                className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                  side === 'sell'
                    ? 'text-sell bg-sell/10 border-b-2 border-sell'
                    : 'text-gray-500 hover:text-gray-400'
                }`}
              >
                Sell
              </button>
            </div>
            <div className="flex gap-1 p-2 border-b border-white/[0.06]">
              {ORDER_TYPES.map((t, i) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setOrderType(i)}
                  className={`flex-1 py-2 text-xs font-medium rounded transition-colors ${
                    orderType === i ? 'bg-card/10 text-white' : 'text-gray-500 hover:text-gray-400 hover:bg-card/5'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="p-3 space-y-3">
              {isAuth ? (
                <>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Available Balance</label>
                    <div className="text-sm font-mono text-gray-300">********* USDT</div>
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Price (USDT)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0"
                      className="w-full h-10 px-3 bg-card/5 border border-white/[0.08] rounded text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:border-buy/50"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Quantity (BTC)</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        className="flex-1 h-10 px-3 bg-card/5 border border-white/[0.08] rounded text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:border-buy/50"
                      />
                      <button className="px-3 h-10 text-xs font-medium text-buy hover:opacity-90 transition-opacity">
                        Max
                      </button>
                    </div>
                  </div>
                  <div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={sliderPct}
                      onChange={(e) => setSliderPct(Number(e.target.value))}
                      className="w-full h-1 bg-card/10 rounded-full appearance-none cursor-pointer accent-buy"
                    />
                    <div className="flex justify-between text-[10px] text-gray-500 mt-0.5">
                      <span>0%</span>
                      <span>{sliderPct}%</span>
                      <span>100%</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Order Value (USDT)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0"
                      className="w-full h-10 px-3 bg-card/5 border border-white/[0.08] rounded text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:border-buy/50"
                    />
                  </div>
                  <div className="text-[11px] text-gray-500">
                    Max. {side === 'buy' ? 'buying' : 'selling'} amount <span className="font-mono text-gray-400">********* BTC</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" className="rounded border-white/30 bg-card/5" />
                      <span className="text-gray-400">Post-Only</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" className="rounded border-white/30 bg-card/5" />
                      <span className="text-gray-400">Good-Till-Canceled</span>
                    </label>
                  </div>
                  <button
                    type="button"
                    className={`w-full h-11 rounded-lg text-sm font-semibold flex items-center justify-center ${
                      side === 'buy'
                        ? 'bg-buy hover:bg-buy-hover text-white'
                        : 'bg-sell hover:bg-sell-hover text-white'
                    }`}
                  >
                    {side === 'buy' ? 'Buy' : 'Sell'} BTC
                  </button>
                  <div className="flex justify-center gap-3 text-xs">
                    <Link href={`${ROUTES.dashboard.help}#fee-rate`} className="text-gray-500 hover:text-gray-400">Fee Rate ⓘ</Link>
                  </div>
                  <div className="flex gap-2 pt-2 border-t border-white/[0.06]">
                    <Link href={walletPath.depositCrypto} className="flex-1 py-2 text-center text-xs font-medium bg-card/5 hover:bg-card/10 rounded text-gray-300 transition-colors">
                      Deposit
                    </Link>
                    <Link href={walletPath.transfer} className="flex-1 py-2 text-center text-xs font-medium bg-card/5 hover:bg-card/10 rounded text-gray-300 transition-colors">
                      Transfer
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Available Balance</label>
                    <div className="text-sm font-mono text-gray-500">— USDT</div>
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Price (USDT)</label>
                    <input
                      type="text"
                      readOnly
                      placeholder="67326.0"
                      className="w-full h-10 px-3 bg-card/5 border border-white/[0.08] rounded text-sm font-mono text-gray-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Quantity (BTC)</label>
                    <input
                      type="text"
                      readOnly
                      placeholder="0"
                      className="w-full h-10 px-3 bg-card/5 border border-white/[0.08] rounded text-sm font-mono text-gray-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Order Value (USDT)</label>
                    <input
                      type="text"
                      readOnly
                      placeholder="0"
                      className="w-full h-10 px-3 bg-card/5 border border-white/[0.08] rounded text-sm font-mono text-gray-500"
                    />
                  </div>
                  <div className="text-[11px] text-gray-500">
                    Max. {side === 'buy' ? 'buying' : 'selling'} amount <span className="font-mono text-gray-500">— BTC</span>
                  </div>
                  <Link
                    href={ROUTES.signup}
                    className="block w-full h-11 rounded-lg text-sm font-semibold flex items-center justify-center bg-warning text-gray-900 hover:opacity-90"
                  >
                    Sign Up
                  </Link>
                  <Link
                    href={ROUTES.login}
                    className="block w-full h-10 rounded-lg text-sm font-medium flex items-center justify-center bg-card/10 text-gray-300 hover:bg-card/15"
                  >
                    Log In
                  </Link>
                  <Link href={ROUTES.dashboard.demoTrading} className="block text-center text-xs text-gray-500 hover:text-gray-400">
                    Demo Trading
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom panel – Logged-in: tabs + table; Logged-out: CTA message */}
      <div className="h-56 flex-shrink-0 flex flex-col border-t border-white/[0.06] bg-[#0b0e11]">
        <div className="flex border-b border-white/[0.06] overflow-x-auto">
          {BOTTOM_TABS_LOGGED_IN.map((tab, i) => (
            <button
              key={tab}
              type="button"
              onClick={() => setBottomTab(i)}
              className={`px-4 py-2.5 text-xs font-medium whitespace-nowrap transition-colors ${
                bottomTab === i
                  ? 'text-white border-b-2 border-buy'
                  : 'text-gray-500 hover:text-gray-400'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-auto">
          {isAuth ? (
            bottomTab === 3 ? (
              /* Assets tab */
              <div className="p-4">
                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer mb-3">
                  <input type="checkbox" className="rounded border-white/30" />
                  Hide Small Balances
                </label>
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="text-gray-500 border-b border-white/[0.06]">
                      <th className="text-left py-2 font-medium">Coins</th>
                      <th className="text-right py-2 font-medium">Net Asset Value</th>
                      <th className="text-right py-2 font-medium">Balance</th>
                      <th className="text-right py-2 font-medium">Spot Cost</th>
                      <th className="text-right py-2 font-medium">Last Price</th>
                      <th className="text-right py-2 font-medium">PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-white/[0.06]">
                      <td className="py-2 text-gray-300">BTC/USDT <span className="text-buy">+1.04%</span></td>
                      <td className="py-2 text-right text-gray-400">0.00000000 =0.00 USD</td>
                      <td className="py-2 text-right text-gray-400">0.0000</td>
                      <td className="py-2 text-right text-gray-500">—</td>
                      <td className="py-2 text-right text-gray-500">—</td>
                      <td className="py-2 text-right text-gray-500">—</td>
                    </tr>
                    <tr>
                      <td className="py-2 text-gray-300">USDT</td>
                      <td className="py-2 text-right text-gray-400">0.00 =0.00 USD</td>
                      <td className="py-2 text-right text-gray-400">0.00</td>
                      <td className="py-2 text-right text-gray-500">—</td>
                      <td className="py-2 text-right text-gray-500">—</td>
                      <td className="py-2 text-right text-gray-500">—</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-gray-500 border-b border-white/[0.06]">
                    <th className="text-left py-2 px-4 font-medium">Time</th>
                    <th className="text-left py-2 px-4 font-medium">Pair</th>
                    <th className="text-left py-2 px-4 font-medium">Type</th>
                    <th className="text-right py-2 px-4 font-medium">Price</th>
                    <th className="text-right py-2 px-4 font-medium">Amount</th>
                    <th className="text-right py-2 px-4 font-medium">Filled</th>
                    <th className="text-right py-2 px-4 font-medium">Total</th>
                    <th className="text-left py-2 px-4 font-medium">Status</th>
                    <th className="text-right py-2 px-4 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-gray-600">
                      No data
                    </td>
                  </tr>
                </tbody>
              </table>
            )
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-gray-500">
              Please Log In or Sign Up first.
            </div>
          )}
        </div>
        <div className="flex items-center justify-between px-4 py-2 border-t border-white/[0.06] text-xs text-gray-500">
          <span>BTC/USDT <span className="text-buy font-medium">+1.04%</span></span>
          <div className="flex gap-4">
            <Link href={ROUTES.dashboard.help} className="hover:text-gray-400">Rewards Hub</Link>
            <Link href={ROUTES.dashboard.help} className="hover:text-gray-400">Customer Service</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
