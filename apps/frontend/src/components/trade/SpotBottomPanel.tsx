'use client';

import Link from 'next/link';
import { Loader2, X, Wallet } from 'lucide-react';
import { useSpotBottomPanel } from './useSpotBottomPanel';
import { useBalancesByAccount } from '@/lib/balances';

interface SpotBottomPanelProps {
  symbol: string;
  isAuth: boolean;
  ordersVersion?: number;
}

function displayStatus(s: string): string {
  if (s === 'PENDING_TRIGGER') return 'Pending Trigger';
  return s;
}

export function SpotBottomPanel(props: SpotBottomPanelProps) {
  const { symbol, isAuth, ordersVersion = 0 } = props;
  const data = useSpotBottomPanel({ symbol, isAuth, ordersVersion });
  const { data: balancesByAccount = [] } = useBalancesByAccount(isAuth);
  const tradingBalances = balancesByAccount.filter((b) => parseFloat(b.trading ?? '0') > 0).slice(0, 12);

  if (!isAuth) {
    return (
      <div className="h-[200px] flex-shrink-0 flex items-center justify-center border-t border-white/5 bg-[#0b0e11] text-gray-500 text-sm">
        Sign in to view open orders, order history, and trade history
      </div>
    );
  }

  return (
    <div className="h-[280px] flex-shrink-0 flex flex-col border-t border-white/5 bg-[#0b0e11]">
      <div className="flex border-b border-white/5 gap-px">
        <button type="button" onClick={() => data.setTab('open')} className={`px-3 py-2 text-[11px] font-medium border-b-2 transition-colors ${data.tab === 'open' ? 'text-white border-white/60' : 'text-gray-500 border-transparent hover:text-gray-400'}`}>Open Orders</button>
        <button type="button" onClick={() => data.setTab('orders')} className={`px-3 py-2 text-[11px] font-medium border-b-2 transition-colors ${data.tab === 'orders' ? 'text-white border-white/60' : 'text-gray-500 border-transparent hover:text-gray-400'}`}>Order History</button>
        <button type="button" onClick={() => data.setTab('trades')} className={`px-3 py-2 text-[11px] font-medium border-b-2 transition-colors ${data.tab === 'trades' ? 'text-white border-white/60' : 'text-gray-500 border-transparent hover:text-gray-400'}`}>Trade History</button>
        <button type="button" onClick={() => data.setTab('assets')} className={`px-3 py-2 text-[11px] font-medium border-b-2 transition-colors ${data.tab === 'assets' ? 'text-white border-white/60' : 'text-gray-500 border-transparent hover:text-gray-400'}`}>Assets</button>
      </div>
      {data.cancelError && (
        <div className="px-3 py-1.5 flex items-center justify-between bg-red-500/10 text-red-400 text-xs">
          <span>{data.cancelError}</span>
          <button type="button" onClick={() => data.setCancelError(null)} aria-label="Dismiss"><X className="w-3 h-3" /></button>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto">
        {data.tab === 'open' && (
          data.openLoading ? (
            <div className="p-4 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-500" /></div>
          ) : data.openOrders.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-xs">No open orders</div>
          ) : (
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-gray-500 border-b border-white/5">
                  <th className="py-1.5 px-2 font-medium">Market</th>
                  <th className="py-1.5 px-2 font-medium">Side</th>
                  <th className="py-1.5 px-2 font-medium">Price</th>
                  <th className="py-1.5 px-2 font-medium">Trigger</th>
                  <th className="py-1.5 px-2 font-medium">Qty</th>
                  <th className="py-1.5 px-2 font-medium">Status</th>
                  <th className="py-1.5 px-2 font-medium w-14">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.openOrders.map((o) => {
                  const canCancel = ['OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER'].includes(o.status);
                  return (
                    <tr key={o.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-1 px-2 text-gray-300 tabular-nums">{o.market}</td>
                      <td className="py-1 px-2"><span className={o.side === 'buy' ? 'text-green-400' : 'text-red-400'}>{o.side}</span></td>
                      <td className="py-1 px-2 text-gray-400 tabular-nums">{o.price ?? '—'}</td>
                      <td className="py-1 px-2 text-gray-400 tabular-nums">{o.stop_price ?? '—'}</td>
                      <td className="py-1 px-2 text-gray-400 tabular-nums">{o.quantity}</td>
                      <td className="py-1 px-2"><span className="text-blue-400">{displayStatus(o.status)}</span></td>
                      <td className="py-1 px-2">
                        {canCancel && (
                          <button
                            type="button"
                            disabled={!!data.cancellingId}
                            onClick={() => data.handleCancel(o.id)}
                            className="text-red-400 hover:underline disabled:opacity-50 text-[10px]"
                          >
                            {data.cancellingId === o.id ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Cancel'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}
        {data.tab === 'orders' && (
          data.orderHistoryLoading ? (
            <div className="p-4 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-500" /></div>
          ) : data.orderHistory.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-xs">No order history</div>
          ) : (
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-gray-500 border-b border-white/5">
                  <th className="py-1.5 px-2 font-medium">Market</th>
                  <th className="py-1.5 px-2 font-medium">Side</th>
                  <th className="py-1.5 px-2 font-medium">Price</th>
                  <th className="py-1.5 px-2 font-medium">Qty</th>
                  <th className="py-1.5 px-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.orderHistory.map((o) => (
                  <tr key={o.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-1 px-2 text-gray-300 tabular-nums">{o.market}</td>
                    <td className="py-1 px-2"><span className={o.side === 'buy' ? 'text-green-400' : 'text-red-400'}>{o.side}</span></td>
                    <td className="py-1 px-2 text-gray-400 tabular-nums">{o.price ?? '—'}</td>
                    <td className="py-1 px-2 text-gray-400 tabular-nums">{o.quantity}</td>
                    <td className="py-1 px-2 text-gray-400">{displayStatus(o.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
        {data.tab === 'assets' && (
          <div className="p-2">
            {tradingBalances.length === 0 ? (
              <div className="p-4 text-center text-gray-500 text-xs">No trading balance</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                {tradingBalances.map((b) => (
                  <Link key={b.symbol} href={`/dashboard/assets/${b.symbol}`} className="flex justify-between items-center px-2 py-1.5 rounded hover:bg-white/5 text-[11px]">
                    <span className="text-gray-300">{b.symbol}</span>
                    <span className="tabular-nums text-gray-400">{parseFloat(b.trading ?? '0').toFixed(4)}</span>
                  </Link>
                ))}
              </div>
            )}
            <Link href="/dashboard/assets/overview" className="block mt-2 text-center text-[11px] text-blue-400 hover:text-blue-300">
              View all assets →
            </Link>
          </div>
        )}
        {data.tab === 'trades' && (
          data.tradesLoading ? (
            <div className="p-4 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-500" /></div>
          ) : data.trades.length === 0 ? (
            <div className="p-4 flex flex-col items-center justify-center gap-1 text-gray-500 text-xs">
              <p>No trades yet</p>
              <p className="text-[10px] text-gray-600">Your trade history will appear here</p>
            </div>
          ) : (
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-gray-500 border-b border-white/5">
                  <th className="py-1.5 px-2 font-medium">Market</th>
                  <th className="py-1.5 px-2 font-medium">Side</th>
                  <th className="py-1.5 px-2 font-medium">Price</th>
                  <th className="py-1.5 px-2 font-medium">Qty</th>
                </tr>
              </thead>
              <tbody>
                {data.trades.map((t) => (
                  <tr key={t.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-1 px-2 text-gray-300 tabular-nums">{t.market}</td>
                    <td className="py-1 px-2"><span className={t.side === 'buy' ? 'text-green-400' : 'text-red-400'}>{t.side}</span></td>
                    <td className="py-1 px-2 text-gray-400 tabular-nums">{t.price}</td>
                    <td className="py-1 px-2 text-gray-400 tabular-nums">{t.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}
