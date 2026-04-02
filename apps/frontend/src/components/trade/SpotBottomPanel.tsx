'use client';

import Link from 'next/link';
import { Loader2, X, RefreshCw, Trash2, Download } from 'lucide-react';
import { ordersToCsv, tradesToCsv, downloadCsv } from '@/lib/exportCsv';
import { useSpotBottomPanel, type Order } from './useSpotBottomPanel';
import { useBalancesByAccount } from '@/lib/balances';
import { ROUTES, SPOT_TRADE_HREF, walletPath } from '@/lib/routes';
import { useMemo, useState, useEffect, useRef } from 'react';

interface SpotBottomPanelProps {
  symbol: string;
  isAuth: boolean;
  ordersVersion?: number;
  tradesVersion?: number;
}

function displayStatus(s: string): string {
  if (s === 'OPEN' || s === 'NEW') return 'Open';
  if (s === 'PENDING_TRIGGER') return 'Pending Trigger';
  if (s === 'PARTIALLY_FILLED') return 'Partially Filled';
  if (s === 'REJECTED') return 'Rejected';
  if (s === 'CANCELLED') return 'Cancelled';
  if (s === 'FILLED') return 'Filled';
  return s || 'Unknown';
}

function executionStatusPill(status: string) {
  const u = (status || '').toUpperCase();
  const base =
    'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide transition-colors duration-300';
  if (u === 'OPEN' || u === 'NEW') {
    return (
      <span
        className={`${base} bg-sky-500/15 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200`}
        title="Working order"
      >
        Open
      </span>
    );
  }
  if (u === 'PARTIALLY_FILLED') {
    return (
      <span
        className={`${base} bg-amber-500/18 text-amber-900 dark:bg-amber-500/22 dark:text-amber-100`}
        title="Partially filled"
      >
        Partial
      </span>
    );
  }
  if (u === 'FILLED') {
    return (
      <span className={`${base} bg-emerald-500/15 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200`} title="Filled">
        Filled
      </span>
    );
  }
  if (u === 'PENDING_TRIGGER') {
    return <span className={`${base} bg-violet-500/15 text-violet-900 dark:bg-violet-400/20 dark:text-violet-100`}>Trigger</span>;
  }
  if (u === 'CANCELLED' || u === 'REJECTED') {
    return (
      <span className={`${base} bg-accent/90 text-foreground/80 dark:bg-accent/40 dark:text-foreground/80`}>{displayStatus(status)}</span>
    );
  }
  return <span className={`${base} bg-accent/80 text-foreground/80 dark:bg-accent/30 dark:text-foreground/90`}>{displayStatus(status)}</span>;
}

function OpenOrderRow({
  o,
  onCancel,
  cancellingId,
}: {
  o: Order;
  onCancel: (id: string) => void;
  cancellingId: string | null | undefined;
}) {
  const [pulse, setPulse] = useState(false);
  const prev = useRef({ status: o.status, filled: o.filled_quantity });
  useEffect(() => {
    if (prev.current.status !== o.status || prev.current.filled !== o.filled_quantity) {
      setPulse(true);
      prev.current = { status: o.status, filled: o.filled_quantity };
      const t = window.setTimeout(() => setPulse(false), 700);
      return () => window.clearTimeout(t);
    }
  }, [o.status, o.filled_quantity]);

  const canCancel = ['OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER'].includes(o.status);
  const filled = parseFloat(o.filled_quantity ?? '0') || 0;
  const qty = parseFloat(o.quantity ?? '0') || 0;
  const filledQtyStr = filled > 0 && qty > 0 ? `${filled.toFixed(4)}/${qty.toFixed(4)}` : (o.quantity ?? '—');
  return (
    <tr
      className={`min-h-[36px] border-b border-border/80 transition-[background-color,box-shadow] duration-500 ease-out hover:bg-background/80 dark:border-border/80 dark:hover:bg-card/40 sm:min-h-[30px] ${
        pulse ? 'bg-primary/12 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.35)] dark:bg-primary/10 dark:shadow-[inset_0_0_0_1px_rgba(96,165,250,0.3)]' : ''
      }`}
    >
      <td className="py-1.5 px-2 align-middle font-mono text-[11px] tabular-nums text-foreground">{o.market}</td>
      <td className="py-1.5 px-2 align-middle">
        <span className="text-[10px] text-muted-foreground">{displayOrderType(o.type)}</span>
      </td>
      <td className="py-1.5 px-2 align-middle">
        <span className={o.side === 'buy' ? 'text-price-up' : 'text-price-down'}>{o.side}</span>
      </td>
      <td className="py-1.5 px-2 align-middle font-mono text-[11px] tabular-nums text-muted-foreground">{o.price ?? '—'}</td>
      <td className="py-1.5 px-2 align-middle text-muted-foreground font-mono tabular-nums text-[11px]">{o.stop_price ?? '—'}</td>
      <td className="py-1.5 px-2 align-middle text-muted-foreground font-mono tabular-nums text-[11px]">{filledQtyStr}</td>
      <td className="py-1.5 px-2 align-middle">{executionStatusPill(o.status)}</td>
      <td className="py-1.5 px-2 align-middle">
        {canCancel && (
          <button
            type="button"
            disabled={!!cancellingId}
            onClick={() => onCancel(o.id)}
            className="min-h-[32px] px-2 py-1 text-destructive hover:underline disabled:opacity-50 text-[10px] touch-manipulation rounded"
          >
            {cancellingId === o.id ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Cancel'}
          </button>
        )}
      </td>
    </tr>
  );
}

function displayOrderType(t: string | undefined): string {
  if (!t) return '—';
  const map: Record<string, string> = {
    limit: 'Limit',
    market: 'Market',
    stop_loss: 'Stop',
    stop_limit: 'Stop Limit',
    trailing_stop_market: 'Trailing',
    oco: 'Bracket',
  };
  return map[t] ?? t;
}

export function SpotBottomPanel(props: SpotBottomPanelProps) {
  const { symbol, isAuth, ordersVersion = 0, tradesVersion = 0 } = props;
  const data = useSpotBottomPanel({ symbol, isAuth, ordersVersion, tradesVersion });
  const { data: balancesByAccount = [] } = useBalancesByAccount(isAuth);
  const allTradingBalances = useMemo(
    () => balancesByAccount.filter((b) => parseFloat(b.trading ?? '0') > 0).slice(0, 24),
    [balancesByAccount]
  );
  const [hideSmallBalances, setHideSmallBalances] = useState(false);
  const [showAllMarkets, setShowAllMarkets] = useState(false);
  const tradingBalances = useMemo(() => {
    if (!hideSmallBalances) return allTradingBalances;
    const min = 0.0001;
    return allTradingBalances.filter((b) => parseFloat(b.trading ?? '0') >= min);
  }, [allTradingBalances, hideSmallBalances]);
  const [sortKey, setSortKey] = useState<string>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const compare = (av: unknown, bv: unknown, key: string, dir: number) => {
    if (key.endsWith('_at')) {
      const at = av ? new Date(String(av)).getTime() : 0;
      const bt = bv ? new Date(String(bv)).getTime() : 0;
      return (at - bt) * dir;
    }
    if (key === 'price' || key === 'quantity' || key === 'filled_quantity' || key === 'fee') {
      return (Number(av ?? 0) - Number(bv ?? 0)) * dir;
    }
    return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
  };

  const displayOpenOrders = useMemo(() => {
    const list = showAllMarkets ? data.openOrders : (data.openOrdersForMarket ?? data.openOrders.filter((o) => o.market === symbol));
    return list;
  }, [data.openOrders, data.openOrdersForMarket, symbol, showAllMarkets]);

  const sortedOpenOrders = useMemo(() => {
    const list = [...displayOpenOrders];
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
      return compare(av, bv, sortKey, dir);
    });
    return list;
  }, [displayOpenOrders, sortKey, sortDir]);

  const sortedOrderHistory = useMemo(() => {
    const list = [...data.orderHistory];
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
      return compare(av, bv, sortKey, dir);
    });
    return list;
  }, [data.orderHistory, sortKey, sortDir]);

  const sortedTrades = useMemo(() => {
    const list = [...data.trades];
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
      return compare(av, bv, sortKey, dir);
    });
    return list;
  }, [data.trades, sortKey, sortDir]);

  const sortGlyph = (key: string) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  if (!isAuth) {
    return (
      <div className="h-full min-h-0 flex flex-col items-center justify-center bg-card text-muted-foreground text-sm">
        Sign in to view your trading activity.
      </div>
    );
  }

  const openOrdersForMarket = symbol ? data.openOrders.filter((o) => o.market === symbol) : [];
  const canCancelAll = symbol && openOrdersForMarket.length > 0 && !data.cancellingAll;

  const tabBtn = (active: boolean) =>
    `min-h-[40px] flex items-center px-3 py-2 text-[11px] font-semibold border-b-2 -mb-px transition-colors duration-150 touch-manipulation sm:px-4 ${
      active
        ? 'border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300'
        : 'border-transparent text-muted-foreground hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground'
    }`;

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-b border-border/90 bg-muted/90 px-1 dark:border-border/90 dark:bg-card/30">
        <div className="flex flex-wrap items-center gap-0.5 sm:gap-1">
          <button type="button" onClick={() => data.setTab('open')} className={tabBtn(data.tab === 'open')}>Open ({data.openOrders.length})</button>
          <button type="button" onClick={() => data.setTab('orders')} className={tabBtn(data.tab === 'orders')}>History</button>
          <button type="button" onClick={() => data.setTab('trades')} className={tabBtn(data.tab === 'trades')}>Trades</button>
          <button type="button" onClick={() => data.setTab('assets')} className={tabBtn(data.tab === 'assets')}>Assets</button>
        </div>
        <div className="flex items-center gap-2 pr-2">
          {data.tab === 'open' && (
            <>
              <button type="button" onClick={() => setShowAllMarkets((v) => !v)} className="min-h-[36px] px-3 py-1.5 text-[10px] text-muted-foreground hover:text-foreground border border-border rounded touch-manipulation" title={showAllMarkets ? 'Show current pair only' : 'Show all markets'}>
                {showAllMarkets ? 'All' : 'Pair'}
              </button>
              {canCancelAll && (
                <button type="button" onClick={() => data.handleCancelAll?.()} disabled={data.cancellingAll} className="min-h-[36px] px-3 py-1.5 text-[10px] text-destructive hover:bg-destructive/10 border border-destructive/30 rounded flex items-center gap-1 disabled:opacity-50 touch-manipulation" title="Cancel all open orders for this pair">
                  {data.cancellingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  Cancel All
                </button>
              )}
            </>
          )}
          {data.tab === 'orders' && data.orderHistory.length > 0 && (
            <button type="button" onClick={() => { const csv = ordersToCsv(data.orderHistory); downloadCsv(`spot-orders-${new Date().toISOString().slice(0,10)}.csv`, csv); }} className="min-h-[36px] px-3 py-1.5 text-[10px] text-muted-foreground hover:text-foreground border border-border rounded flex items-center gap-1 touch-manipulation" title="Export Order History as CSV">
              <Download className="w-3 h-3" /> Export
            </button>
          )}
          {data.tab === 'trades' && data.trades.length > 0 && (
            <button type="button" onClick={() => { const csv = tradesToCsv(data.trades); downloadCsv(`spot-trades-${new Date().toISOString().slice(0,10)}.csv`, csv); }} className="min-h-[36px] px-3 py-1.5 text-[10px] text-muted-foreground hover:text-foreground border border-border rounded flex items-center gap-1 touch-manipulation" title="Export Trade History as CSV">
              <Download className="w-3 h-3" /> Export
            </button>
          )}
          <button type="button" onClick={() => { data.tab === 'open' && data.fetchOpen?.(); data.tab === 'orders' && data.fetchOrderHistory?.(null, false); data.tab === 'trades' && data.fetchTrades?.(1, false); }} className="min-h-[36px] min-w-[36px] flex items-center justify-center text-muted-foreground hover:text-foreground rounded touch-manipulation" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {data.cancelError && (
        <div className="px-3 py-1.5 flex items-center justify-between bg-destructive/10 text-destructive text-xs">
          <span>{data.cancelError}</span>
          <button type="button" onClick={() => data.setCancelError(null)} aria-label="Dismiss"><X className="w-3 h-3" /></button>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto">
        {data.tab === 'open' && (
          data.openLoading ? (
            <div className="p-4 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : data.openOrders.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground text-xs">No open orders</div>
          ) : (
            <table className="w-full text-[11px] table-fixed">
              <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur-sm dark:bg-card/95">
                <tr className="border-b border-border/90 text-left text-[11px] font-medium text-muted-foreground dark:border-border/90 dark:text-muted-foreground">
                  <th className="py-2 px-2 font-medium cursor-pointer w-24" onClick={() => toggleSort('market')}>Market{sortGlyph('market')}</th>
                  <th className="py-2 px-2 font-medium cursor-pointer w-16" onClick={() => toggleSort('type')}>Type{sortGlyph('type')}</th>
                  <th className="py-2 px-2 font-medium cursor-pointer w-12" onClick={() => toggleSort('side')}>Side{sortGlyph('side')}</th>
                  <th className="py-2 px-2 font-medium cursor-pointer w-20" onClick={() => toggleSort('price')}>Price{sortGlyph('price')}</th>
                  <th className="py-2 px-2 font-medium cursor-pointer w-20" onClick={() => toggleSort('stop_price')}>Trigger{sortGlyph('stop_price')}</th>
                  <th className="py-2 px-2 font-medium cursor-pointer w-24" onClick={() => toggleSort('quantity')}>Filled/Qty{sortGlyph('quantity')}</th>
                  <th className="py-2 px-2 font-medium cursor-pointer" onClick={() => toggleSort('status')}>Status{sortGlyph('status')}</th>
                  <th className="py-2 px-2 font-medium w-16">Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedOpenOrders.map((o) => (
                  <OpenOrderRow
                    key={o.id}
                    o={o}
                    onCancel={(id) => data.handleCancel(id)}
                    cancellingId={data.cancellingId}
                  />
                ))}
              </tbody>
            </table>
          )
        )}
        {data.tab === 'orders' && (
          data.orderHistoryLoading ? (
            <div className="p-4 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : data.orderHistory.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground text-xs">No order history</div>
          ) : (
            <table className="w-full text-[11px] table-fixed">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-2 px-2 font-medium cursor-pointer w-24" onClick={() => toggleSort('market')}>Market{sortGlyph('market')}</th>
                  <th className="py-2 px-2 font-medium cursor-pointer w-16" onClick={() => toggleSort('type')}>Type{sortGlyph('type')}</th>
                  <th className="py-2 px-2 font-medium cursor-pointer w-12" onClick={() => toggleSort('side')}>Side{sortGlyph('side')}</th>
                  <th className="py-2 px-2 font-medium cursor-pointer w-20" onClick={() => toggleSort('price')}>Price{sortGlyph('price')}</th>
                  <th className="py-2 px-2 font-medium cursor-pointer w-20" onClick={() => toggleSort('stop_price')}>Trigger{sortGlyph('stop_price')}</th>
                  <th className="py-2 px-2 font-medium cursor-pointer w-24" onClick={() => toggleSort('quantity')}>Filled/Qty{sortGlyph('quantity')}</th>
                  <th className="py-2 px-2 font-medium cursor-pointer" onClick={() => toggleSort('status')}>Status{sortGlyph('status')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedOrderHistory.map((o) => {
                  const filled = parseFloat(o.filled_quantity ?? '0') || 0;
                  const qty = parseFloat(o.quantity ?? '0') || 0;
                  const filledQtyStr = filled > 0 || o.status === 'FILLED' ? `${filled.toFixed(4)}/${qty.toFixed(4)}` : (o.quantity ?? '—');
                  return (
                    <tr key={o.id} className="border-b border-border hover:bg-muted/50 min-h-[36px] sm:min-h-[30px] transition-colors duration-150">
                      <td className="py-1.5 px-2 align-middle text-foreground font-mono tabular-nums">{o.market}</td>
                      <td className="py-1.5 px-2 align-middle text-muted-foreground text-[10px]">{displayOrderType(o.type)}</td>
                      <td className="py-1.5 px-2 align-middle"><span className={o.side === 'buy' ? 'text-price-up' : 'text-price-down'}>{o.side}</span></td>
                      <td className="py-1.5 px-2 align-middle text-muted-foreground font-mono tabular-nums">{o.price ?? '—'}</td>
                      <td className="py-1.5 px-2 align-middle text-muted-foreground font-mono tabular-nums">{o.stop_price ?? '—'}</td>
                      <td className="py-1.5 px-2 align-middle text-muted-foreground font-mono tabular-nums">{filledQtyStr}</td>
                      <td className="py-1.5 px-2 align-middle">{executionStatusPill(o.status)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}
        {data.tab === 'assets' && (
          <div className="p-2">
            <label className="flex items-center gap-2 mb-2 text-[11px] text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={hideSmallBalances}
                onChange={(e) => setHideSmallBalances(e.target.checked)}
                className="rounded border-border"
              />
              Hide small balances
            </label>
            {tradingBalances.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-xs">No trading balance</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                {tradingBalances.map((b) => (
                  <Link key={b.symbol} href={`/wallet/${b.symbol}`} className="flex justify-between items-center px-2 py-1.5 rounded hover:bg-muted text-[11px]">
                    <span className="text-foreground">{b.symbol}</span>
                    <span className="tabular-nums text-muted-foreground">{parseFloat(b.trading ?? '0').toFixed(4)}</span>
                  </Link>
                ))}
              </div>
            )}
            <Link href={walletPath.overview} className="mt-2 block text-center text-[11px] font-medium text-primary hover:underline dark:text-primary">
              View all assets →
            </Link>
          </div>
        )}
        {data.tab === 'trades' && (
          data.tradesLoading ? (
            <div className="p-4 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : data.trades.length === 0 ? (
            <div className="p-4 flex flex-col items-center justify-center gap-2 text-muted-foreground text-xs text-center px-3">
              <p className="font-medium text-foreground/90">No trades yet — start trading</p>
              <p className="text-[10px] max-w-[16rem]">Fills and executions will show here. Place an order from the panel on the right.</p>
              <Link
                href={SPOT_TRADE_HREF}
                className="mt-1 inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Open Spot
              </Link>
            </div>
          ) : (
            <>
              <table className="w-full text-[11px] table-fixed">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-2 px-2 font-medium cursor-pointer w-24" onClick={() => toggleSort('market')}>Market{sortGlyph('market')}</th>
                    <th className="py-2 px-2 font-medium cursor-pointer w-12" onClick={() => toggleSort('side')}>Side{sortGlyph('side')}</th>
                    <th className="py-2 px-2 font-medium cursor-pointer w-20" onClick={() => toggleSort('price')}>Price{sortGlyph('price')}</th>
                    <th className="py-2 px-2 font-medium cursor-pointer w-20" onClick={() => toggleSort('quantity')}>Qty{sortGlyph('quantity')}</th>
                    <th className="py-2 px-2 font-medium cursor-pointer w-16" onClick={() => toggleSort('fee')}>Fee{sortGlyph('fee')}</th>
                    <th className="py-2 px-2 font-medium cursor-pointer" onClick={() => toggleSort('created_at')}>Time{sortGlyph('created_at')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTrades.map((t) => (
                    <tr key={t.id} className="border-b border-border hover:bg-muted/50 min-h-[36px] sm:min-h-[30px] transition-colors duration-150">
                      <td className="py-1.5 px-2 align-middle text-foreground font-mono tabular-nums">{t.market}</td>
                      <td className="py-1.5 px-2 align-middle"><span className={t.side === 'buy' ? 'text-price-up' : 'text-price-down'}>{t.side}</span></td>
                      <td className="py-1.5 px-2 align-middle text-muted-foreground font-mono tabular-nums">{t.price}</td>
                      <td className="py-1.5 px-2 align-middle text-muted-foreground font-mono tabular-nums">{t.quantity}</td>
                      <td className="py-1.5 px-2 align-middle text-muted-foreground font-mono tabular-nums text-[10px]">{t.fee ?? '—'}{t.fee_asset ? ` ${t.fee_asset}` : ''}</td>
                      <td className="py-1.5 px-2 align-middle text-muted-foreground text-[10px]">{t.created_at ? new Date(t.created_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.tradesPage < data.tradesTotalPages && (
                <div className="p-2 border-t border-border">
                  <button
                    type="button"
                    disabled={!!data.tradesLoadMore}
                    onClick={data.loadMoreTrades}
                    className="w-full py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {data.tradesLoadMore ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Load more
                  </button>
                </div>
              )}
            </>
          )
        )}
      </div>
    </div>
  );
}
