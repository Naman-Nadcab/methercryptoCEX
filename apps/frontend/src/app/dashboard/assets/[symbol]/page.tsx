'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth';
import { useBalancesFunding, useBalancesSpot, type TokenBalance, type SpotBalanceRow } from '@/lib/balances';
import { api } from '@/lib/api';
import { CoinIcon } from '@/components/ui/CoinIcon';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import TransferModal from '@/components/TransferModal';
import {
  ArrowLeft,
  Download,
  Upload,
  ArrowLeftRight,
  TrendingUp,
  ExternalLink,
  Globe,
  BarChart3,
  Coins,
  Clock,
  ChevronDown,
  ChevronUp,
  Loader2,
  Info,
  RefreshCw,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TickerRow {
  symbol: string;
  last_price: string | null;
  change_pct: number | null;
  volume_24h: string;
  high_24h: string | null;
  low_24h: string | null;
}

interface CoinInfo {
  symbol: string;
  name: string;
  description: string;
  market_cap: number | null;
  market_cap_rank: number | null;
  current_price: number | null;
  price_change_percentage_24h: number | null;
  total_volume: number | null;
  circulating_supply: number | null;
  total_supply: number | null;
  max_supply: number | null;
  ath: number | null;
  homepage: string | null;
}

interface Transaction {
  id: string;
  type: string;
  coin: string;
  chain_type: string | null;
  quantity: string;
  status: string;
  date_time: string;
  tx_hash: string | null;
  address: string | null;
  memo: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtNum(n: number | string | null | undefined, decimals = 2): string {
  const v = typeof n === 'string' ? parseFloat(n) : n;
  if (v == null || isNaN(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '$0.00';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtSupply(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function pctColor(v: number | null): string {
  if (v == null) return 'text-muted-foreground';
  return v >= 0 ? 'text-emerald-500' : 'text-red-500';
}

function pctBgColor(v: number | null): string {
  if (v == null) return 'bg-muted/50';
  return v >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10';
}

function statusBadge(status: string) {
  const s = status.toLowerCase();
  if (s === 'completed' || s === 'confirmed' || s === 'success')
    return 'bg-emerald-500/10 text-emerald-500';
  if (s === 'pending' || s === 'processing')
    return 'bg-yellow-500/10 text-yellow-500';
  if (s === 'failed' || s === 'rejected' || s === 'cancelled')
    return 'bg-red-500/10 text-red-500';
  return 'bg-muted/50 text-muted-foreground';
}

function typeBadge(type: string) {
  const t = type.toLowerCase();
  if (t === 'deposit') return 'bg-emerald-500/10 text-emerald-500';
  if (t === 'withdrawal' || t === 'withdraw') return 'bg-orange-500/10 text-orange-500';
  if (t === 'transfer') return 'bg-blue-500/10 text-blue-500';
  return 'bg-muted/50 text-muted-foreground';
}

function resolveSymbol(row: Record<string, unknown>): string {
  return ((row.symbol ?? row.asset ?? row.currency ?? row.coin ?? '') as string).toUpperCase();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AssetSymbolPage() {
  const params = useParams();
  const { accessToken, _hasHydrated } = useAuthStore();
  const rawSymbol = typeof params?.symbol === 'string' ? params.symbol : '';
  const symbol = rawSymbol.toUpperCase();

  const ready = !!_hasHydrated && !!accessToken;

  // Balances
  const { data: fundingData, isLoading: fundingLoading } = useBalancesFunding(ready);
  const { data: spotData, isLoading: spotLoading } = useBalancesSpot(ready);

  const fundingRow: TokenBalance | undefined = useMemo(
    () => (fundingData?.balances ?? []).find((b) => resolveSymbol(b as unknown as Record<string, unknown>) === symbol),
    [fundingData, symbol],
  );
  const spotRow: SpotBalanceRow | undefined = useMemo(
    () => (spotData ?? []).find((b) => resolveSymbol(b as unknown as Record<string, unknown>) === symbol),
    [spotData, symbol],
  );

  const fundingTotal = parseFloat(fundingRow?.total_balance ?? '0');
  const fundingAvailable = parseFloat(fundingRow?.available_balance ?? '0');
  const fundingLocked = parseFloat(fundingRow?.locked_balance ?? '0');
  const spotTotal = parseFloat(spotRow?.balance ?? '0');
  const spotAvailable = parseFloat(spotRow?.available_balance ?? '0');
  const spotLocked = parseFloat(spotRow?.locked_balance ?? '0');
  const grandTotal = fundingTotal + spotTotal;

  // Ticker (live price)
  const [ticker, setTicker] = useState<TickerRow | null>(null);
  useEffect(() => {
    if (!symbol) return;
    const base = getApiBaseUrl();
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${base}/api/v1/spot/tickers`);
        const json = await res.json();
        const list: TickerRow[] = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : Array.isArray(json?.tickers) ? json.tickers : [];
        const pair = list.find(
          (t) => t.symbol === `${symbol}_USDT` || t.symbol === `${symbol}USDT` || t.symbol === `${symbol}/USDT`,
        );
        if (!cancelled && pair) setTicker(pair);
      } catch { /* silently ignore */ }
    };
    load();
    const iv = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [symbol]);

  const livePrice = ticker?.last_price ? parseFloat(ticker.last_price) : null;
  const change24h = ticker?.change_pct ?? null;

  // USD values
  const priceForUsd = livePrice ?? 0;
  const fundingUsd = fundingTotal * priceForUsd;
  const spotUsd = spotTotal * priceForUsd;
  const totalUsd = grandTotal * priceForUsd;

  // Coin info (CoinGecko)
  const [coinInfo, setCoinInfo] = useState<CoinInfo | null>(null);
  const [coinInfoLoading, setCoinInfoLoading] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);

  useEffect(() => {
    if (!symbol || !ready) return;
    let cancelled = false;
    setCoinInfoLoading(true);
    api.get<CoinInfo>(`/api/v1/wallet/coin-info/${symbol.toLowerCase()}`, { notifyOnError: false }).then((res) => {
      if (!cancelled && res.success && res.data) setCoinInfo(res.data);
    }).finally(() => { if (!cancelled) setCoinInfoLoading(false); });
    return () => { cancelled = true; };
  }, [symbol, ready]);

  // Transactions
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [txPage, setTxPage] = useState(1);
  const TX_PER_PAGE = 10;

  const loadTransactions = useCallback(async () => {
    if (!ready || !symbol) return;
    setTxLoading(true);
    try {
      const res = await api.get<Transaction[]>(
        `/api/v1/wallet/transactions/all?coin=${symbol}&limit=50`,
        { notifyOnError: false },
      );
      if (res.success && Array.isArray(res.data)) setTransactions(res.data);
    } catch { /* ignore */ }
    finally { setTxLoading(false); }
  }, [ready, symbol]);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);

  const paginatedTx = useMemo(
    () => transactions.slice((txPage - 1) * TX_PER_PAGE, txPage * TX_PER_PAGE),
    [transactions, txPage],
  );
  const totalTxPages = Math.max(1, Math.ceil(transactions.length / TX_PER_PAGE));

  // Transfer modal
  const [transferOpen, setTransferOpen] = useState(false);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (!symbol) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <p className="text-muted-foreground text-sm">Invalid asset symbol.</p>
          <Link href="/dashboard/assets/overview" className="mt-3 inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
            <ArrowLeft className="w-4 h-4" /> Back to Assets
          </Link>
        </div>
      </div>
    );
  }

  const balancesLoading = fundingLoading || spotLoading;
  const coinName = coinInfo?.name ?? fundingRow?.name ?? symbol;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* ── Breadcrumb ── */}
      <nav className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link href="/dashboard/assets/overview" className="hover:text-foreground transition-colors">Assets</Link>
        <span>/</span>
        <span className="text-foreground font-medium">{symbol}</span>
      </nav>

      {/* ================================================================= */}
      {/* 1. Coin Header                                                    */}
      {/* ================================================================= */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <CoinIcon symbol={symbol} size={40} />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-foreground tracking-tight">{coinName}</h1>
              <span className="text-sm text-muted-foreground font-medium">{symbol}</span>
              {coinInfo?.market_cap_rank && (
                <span className="ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  #{coinInfo.market_cap_rank}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              {livePrice != null ? (
                <>
                  <span className="text-lg font-semibold text-foreground tabular-nums">
                    ${fmtNum(livePrice, livePrice >= 1 ? 2 : 6)}
                  </span>
                  {change24h != null && (
                    <span className={`text-sm font-medium tabular-nums px-2 py-0.5 rounded-md ${pctColor(change24h)} ${pctBgColor(change24h)}`}>
                      {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
                    </span>
                  )}
                </>
              ) : (
                <span className="text-sm text-muted-foreground">Price unavailable</span>
              )}
            </div>
          </div>
        </div>

        {/* Quick action buttons */}
        <div className="sm:ml-auto flex flex-wrap items-center gap-2">
          <Link
            href={`/dashboard/deposit/crypto?coin=${encodeURIComponent(symbol)}`}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium bg-primary hover:bg-primary/90 text-primary-foreground transition-all active:scale-[0.97]"
          >
            <Download className="w-4 h-4" /> Deposit
          </Link>
          <Link
            href={`/dashboard/withdraw/crypto?coin=${encodeURIComponent(symbol)}`}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium bg-card border border-border hover:bg-accent text-foreground transition-all active:scale-[0.97]"
          >
            <Upload className="w-4 h-4" /> Withdraw
          </Link>
          <button
            onClick={() => setTransferOpen(true)}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium bg-card border border-border hover:bg-accent text-foreground transition-all active:scale-[0.97]"
          >
            <ArrowLeftRight className="w-4 h-4" /> Transfer
          </button>
          <Link
            href={`/dashboard/trade/spot?symbol=${encodeURIComponent(`${symbol}_USDT`)}`}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium bg-card border border-border hover:bg-accent text-foreground transition-all active:scale-[0.97]"
          >
            <TrendingUp className="w-4 h-4" /> Trade
          </Link>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 2. Balance Breakdown                                              */}
      {/* ================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Total */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Total Balance</p>
          {balancesLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mt-2" />
          ) : (
            <>
              <p className="text-2xl font-bold text-foreground tabular-nums">{fmtNum(grandTotal, 8)} <span className="text-sm font-normal text-muted-foreground">{symbol}</span></p>
              <p className="text-sm text-muted-foreground tabular-nums">≈ {fmtUsd(totalUsd)}</p>
            </>
          )}
        </div>

        {/* Funding */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Funding Account</p>
          </div>
          {balancesLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mt-2" />
          ) : (
            <>
              <p className="text-xl font-semibold text-foreground tabular-nums">{fmtNum(fundingTotal, 8)} <span className="text-sm font-normal text-muted-foreground">{symbol}</span></p>
              <p className="text-sm text-muted-foreground tabular-nums">≈ {fmtUsd(fundingUsd)}</p>
              <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                <span>Available: <span className="text-foreground tabular-nums">{fmtNum(fundingAvailable, 8)}</span></span>
                <span>Locked: <span className="text-foreground tabular-nums">{fmtNum(fundingLocked, 8)}</span></span>
              </div>
            </>
          )}
        </div>

        {/* Trading */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Trading Account</p>
          </div>
          {balancesLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mt-2" />
          ) : (
            <>
              <p className="text-xl font-semibold text-foreground tabular-nums">{fmtNum(spotTotal, 8)} <span className="text-sm font-normal text-muted-foreground">{symbol}</span></p>
              <p className="text-sm text-muted-foreground tabular-nums">≈ {fmtUsd(spotUsd)}</p>
              <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                <span>Available: <span className="text-foreground tabular-nums">{fmtNum(spotAvailable, 8)}</span></span>
                <span>Locked: <span className="text-foreground tabular-nums">{fmtNum(spotLocked, 8)}</span></span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ================================================================= */}
      {/* 3. Market Info (CoinGecko)                                        */}
      {/* ================================================================= */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Market Info</h2>
          {coinInfo?.homepage && (
            <a
              href={coinInfo.homepage}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <Globe className="w-3.5 h-3.5" /> Website <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        {coinInfoLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : coinInfo ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              <StatBox label="Market Cap" value={fmtUsd(coinInfo.market_cap)} />
              <StatBox label="24h Volume" value={fmtUsd(coinInfo.total_volume)} />
              <StatBox label="Circulating Supply" value={`${fmtSupply(coinInfo.circulating_supply)} ${symbol}`} />
              <StatBox label="Total Supply" value={coinInfo.total_supply ? `${fmtSupply(coinInfo.total_supply)} ${symbol}` : '—'} />
              <StatBox label="All-Time High" value={coinInfo.ath != null ? `$${fmtNum(coinInfo.ath, coinInfo.ath >= 1 ? 2 : 6)}` : '—'} />
            </div>

            {coinInfo.max_supply != null && (
              <div className="mt-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span>Supply Progress</span>
                  <span>{coinInfo.circulating_supply != null ? ((coinInfo.circulating_supply / coinInfo.max_supply) * 100).toFixed(1) : '0'}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${coinInfo.circulating_supply != null ? Math.min(100, (coinInfo.circulating_supply / coinInfo.max_supply) * 100) : 0}%` }}
                  />
                </div>
              </div>
            )}

            {coinInfo.description && (
              <div className="mt-2">
                <p className={`text-xs text-muted-foreground leading-relaxed ${descExpanded ? '' : 'line-clamp-2'}`}>
                  {coinInfo.description}
                </p>
                {coinInfo.description.length > 200 && (
                  <button onClick={() => setDescExpanded(!descExpanded)} className="text-xs text-primary hover:underline mt-1 inline-flex items-center gap-0.5">
                    {descExpanded ? <>Show less <ChevronUp className="w-3 h-3" /></> : <>Read more <ChevronDown className="w-3 h-3" /></>}
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Info className="w-4 h-4" /> Market data unavailable for {symbol}
          </div>
        )}
      </div>

      {/* ================================================================= */}
      {/* 4. Transaction History                                            */}
      {/* ================================================================= */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Transaction History</h2>
            <span className="text-xs text-muted-foreground">({transactions.length})</span>
          </div>
          <button
            onClick={loadTransactions}
            disabled={txLoading}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${txLoading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        {txLoading && transactions.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Coins className="w-8 h-8 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">No transactions for {symbol} yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Deposits, withdrawals, and transfers will appear here</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-muted-foreground uppercase tracking-wider border-b border-border bg-muted/30">
                    <th className="py-2.5 px-5 font-medium">Type</th>
                    <th className="py-2.5 px-5 font-medium">Amount</th>
                    <th className="py-2.5 px-5 font-medium">Status</th>
                    <th className="py-2.5 px-5 font-medium hidden sm:table-cell">Network</th>
                    <th className="py-2.5 px-5 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedTx.map((tx) => {
                    const isDeposit = tx.type?.toLowerCase() === 'deposit';
                    const isWithdraw = tx.type?.toLowerCase() === 'withdrawal' || tx.type?.toLowerCase() === 'withdraw';
                    return (
                      <tr
                        key={tx.id}
                        className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                      >
                        <td className="py-3 px-5">
                          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-md capitalize ${typeBadge(tx.type)}`}>
                            {tx.type}
                          </span>
                        </td>
                        <td className="py-3 px-5 tabular-nums font-medium text-foreground">
                          <span className={isDeposit ? 'text-emerald-500' : isWithdraw ? 'text-red-400' : 'text-foreground'}>
                            {isDeposit ? '+' : isWithdraw ? '-' : ''}{fmtNum(tx.quantity, 8)}
                          </span>
                          <span className="text-xs text-muted-foreground ml-1">{symbol}</span>
                        </td>
                        <td className="py-3 px-5">
                          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-md capitalize ${statusBadge(tx.status)}`}>
                            {tx.status}
                          </span>
                        </td>
                        <td className="py-3 px-5 text-xs text-muted-foreground hidden sm:table-cell">
                          {tx.chain_type ?? '—'}
                        </td>
                        <td className="py-3 px-5 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                          {tx.date_time ? new Date(tx.date_time).toLocaleString() : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalTxPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-border">
                <button
                  onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                  disabled={txPage === 1}
                  className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
                >
                  ← Previous
                </button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  Page {txPage} of {totalTxPages}
                </span>
                <button
                  onClick={() => setTxPage((p) => Math.min(totalTxPages, p + 1))}
                  disabled={txPage === totalTxPages}
                  className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Transfer modal */}
      <TransferModal
        isOpen={transferOpen}
        onClose={() => setTransferOpen(false)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-foreground tabular-nums">{value}</p>
    </div>
  );
}
