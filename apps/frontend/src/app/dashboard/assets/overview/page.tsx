'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import { useBalancesSummary, useBalancesFunding, type TokenBalance } from '@/lib/balances';
import Link from 'next/link';
import { notifyError } from '@/lib/notifyError';
import {
  Eye,
  EyeOff,
  Download,
  Upload,
  ArrowLeftRight,
  RefreshCw,
  ChevronRight,
  Wallet,
  LayoutGrid,
  TrendingUp,
  Clock,
  MoreHorizontal,
  ArrowRight,
  FileText,
  ChevronDown,
  HelpCircle,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/Tooltip';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { Skeleton } from '@/components/ui/Skeleton';
import { PortfolioChangeCard } from '@/components/assets/PortfolioChangeCard';
import { PortfolioAllocationChart } from '@/components/assets/PortfolioAllocationChart';
import { AssetPerformanceTable } from '@/components/assets/AssetPerformanceTable';

interface AccountBalance {
  type: string;
  totalUsd: number;
  totalBtc: number;
}

interface Transaction {
  id: string;
  type: 'deposit' | 'withdrawal';
  symbol: string;
  amount: string;
  status: string;
  created_at: string;
}

export default function AssetsOverviewPage() {
  const router = useRouter();
  const { accessToken, _hasHydrated } = useAuthStore();

  const [showBalance, setShowBalance] = useState(true);
  const [activeTab, setActiveTab] = useState<'account' | 'asset'>('account');
  const [timePeriod, setTimePeriod] = useState('7D');
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [ordersExpanded, setOrdersExpanded] = useState(false);
  const [showWhyZero, setShowWhyZero] = useState(false);
  const [whyZeroReason, setWhyZeroReason] = useState<{ funds: string; history: string } | null>(null);
  const [whyZeroLoading, setWhyZeroLoading] = useState(false);

  const { data: balanceData, isLoading: loading, error: balanceQueryError, refetch } = useBalancesSummary(
    !!_hasHydrated && !!accessToken
  );
  const { data: fundingData } = useBalancesFunding(!!_hasHydrated && !!accessToken);
  const fundingBalance = balanceData?.fundingBalance ?? { type: 'funding' as const, totalUsd: 0, totalBtc: 0 };
  const tradingBalance = balanceData?.tradingBalance ?? { type: 'trading' as const, totalUsd: 0, totalBtc: 0 };
  const rawBalances = fundingData?.balances ?? [];
  const normalized = rawBalances.map((row) => {
    const r = row as unknown as Record<string, unknown>;
    return {
    symbol: (r.symbol ?? r.asset ?? r.currency ?? r.coin ?? '—') as string,
    total_balance: (r.total_balance ?? r.total ?? r.balance ?? '0') as string,
    available_balance: (r.available_balance ?? r.available ?? r.free ?? '0') as string,
    locked_balance: (r.locked_balance ?? r.locked ?? '0') as string,
    usd_value: (r.usd_value ?? r.usd ?? r.value ?? '0') as string,
  };
  });
  const perCoinBalances = normalized.filter((row) => {
    const total = parseFloat(row.total_balance || '0');
    return total > 0;
  });
  const isBalanceQueryCancelled = balanceQueryError instanceof Error && (balanceQueryError.name === 'AbortError' || String(balanceQueryError.message).toLowerCase().includes('abort'));
  const balanceError = balanceData?.balanceError ?? (balanceQueryError instanceof Error && !isBalanceQueryCancelled ? balanceQueryError.message : null);
  const lastUpdated = balanceData?.lastUpdated ?? '';

  const fetchWhyZero = async () => {
    if (!accessToken) return;
    setWhyZeroLoading(true);
    setWhyZeroReason(null);
    try {
      const data = await api.get<{ reason_funds_zero?: string; reason_history_empty?: string }>('/api/v1/wallet/balance-diagnostic');
      if (data.success && data.data) {
        const d = data.data as { reason_funds_zero?: string; reason_history_empty?: string };
        setWhyZeroReason({
          funds: d.reason_funds_zero || 'Unknown',
          history: d.reason_history_empty || 'Unknown',
        });
      }
    } catch {
      setWhyZeroReason({ funds: 'Could not load reason.', history: 'Could not load reason.' });
    } finally {
      setWhyZeroLoading(false);
    }
  };

  useEffect(() => {
    if (_hasHydrated && accessToken) {
      fetchRecentTransactions();
    }
  }, [_hasHydrated, accessToken]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && accessToken) {
        fetchRecentTransactions();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [accessToken]);

  const fetchRecentTransactions = async () => {
    if (!accessToken) return;
    try {
      const [depositsData, withdrawalsData] = await Promise.all([
        api.get<unknown[]>('/api/v1/wallet/deposit-history?limit=5'),
        api.get<unknown[]>('/api/v1/wallet/withdrawals?limit=5'),
      ]);

      const deposits = (depositsData.success && depositsData.data) ? (Array.isArray(depositsData.data) ? depositsData.data : []) : [];
      const withdrawals = (withdrawalsData.success && withdrawalsData.data) ? (Array.isArray(withdrawalsData.data) ? withdrawalsData.data : []) : [];

      const combined: Transaction[] = [
        ...deposits.map((d: any) => ({
          id: d.id,
          type: 'deposit' as const,
          symbol: d.symbol || 'Unknown',
          amount: d.amount || '0',
          status: d.status || 'pending',
          created_at: d.created_at || d.createdAt,
        })),
        ...withdrawals.map((w: any) => ({
          id: w.id,
          type: 'withdrawal' as const,
          symbol: w.symbol || w.coin || 'Unknown',
          amount: w.amount || w.quantity || '0',
          status: w.status || 'pending',
          created_at: w.created_at || w.date_time || w.createdAt,
        })),
      ]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 10);

      setRecentTransactions(combined);
    } catch (error) {
      notifyError('Failed to load recent transactions. Please try again.');
    }
  };

  const totalUsd = fundingBalance.totalUsd + tradingBalance.totalUsd;
  const totalBtc = fundingBalance.totalBtc + tradingBalance.totalBtc;

  const formatNumber = (num: number, decimals = 2) => {
    if (!Number.isFinite(num)) return (0).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };

  const timePeriods = ['7D', '30D', '90D', '180D'];

  return (
    <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">Assets Overview</h1>
              <button
                onClick={() => setShowBalance(!showBalance)}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-accent rounded-lg transition-colors"
              >
                {showBalance ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
              </button>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3">
              <Link
                href="/wallet/deposit/crypto"
                className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary/85 text-white font-medium text-sm rounded-xl shadow-lg shadow-blue-500/25 transition-all hover:shadow-blue-500/40"
              >
                <Download className="w-4 h-4" />
                Deposit
              </Link>
              <Link
                href="/wallet/withdraw/crypto"
                className="flex items-center gap-2 px-5 py-2.5 bg-card text-foreground/80 font-medium text-sm rounded-xl border border-border hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
              >
                <Upload className="w-4 h-4" />
                Withdraw
              </Link>
              <Link
                href="/wallet/transfer"
                className="flex items-center gap-2 px-5 py-2.5 bg-card text-foreground/80 font-medium text-sm rounded-xl border border-border hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
              >
                <ArrowLeftRight className="w-4 h-4" />
                Transfer
              </Link>
              <Link
                href="/wallet/convert"
                className="flex items-center gap-2 px-5 py-2.5 bg-card text-foreground/80 font-medium text-sm rounded-xl border border-border hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Convert
              </Link>
            </div>
          </div>

          {/* Balance load error */}
          {balanceError && (
            <div className="mb-6 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-amber-800 dark:text-amber-200">{balanceError}</p>
              <div className="flex items-center gap-2">
                {balanceError.includes('Session expired') && (
                  <Link
                    href={`/login?redirect=${encodeURIComponent('/wallet')}`}
                    className="px-4 py-2 text-sm font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700"
                  >
                    Log in again
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-amber-500 text-white hover:bg-amber-600"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {/* Portfolio Value Card */}
          <div className="mb-8">
            <PortfolioChangeCard
              totalUsd={totalUsd}
              totalBtc={totalBtc}
              change24h={0}
              change24hPercent={0}
              lastUpdated={lastUpdated}
              showBalance={showBalance}
              loading={loading}
            />
            {!loading && showBalance && totalUsd === 0 && totalBtc === 0 && (
              <div className="mt-4 p-4 bg-card rounded-xl border border-border">
                <button
                  type="button"
                  onClick={() => { setShowWhyZero(!showWhyZero); if (!whyZeroReason && !whyZeroLoading) fetchWhyZero(); }}
                  className="text-sm text-primary hover:text-primary/85 dark:text-blue-400 font-medium"
                >
                  {showWhyZero ? 'Hide' : 'Why is my balance 0? Why no history?'}
                </button>
                {showWhyZero && (
                  <div className="mt-3 p-4 bg-muted/50 rounded-xl text-sm text-foreground/80 space-y-2">
                    {whyZeroLoading && <p>Checking...</p>}
                    {whyZeroReason && !whyZeroLoading && (
                      <>
                        <p><strong>Funds:</strong> {whyZeroReason.funds}</p>
                        <p><strong>History:</strong> {whyZeroReason.history}</p>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Tabs and Time Period */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex">
              <button
                onClick={() => setActiveTab('account')}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'account'
                    ? 'border-blue-500 text-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                Account
              </button>
              <button
                onClick={() => setActiveTab('asset')}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'asset'
                    ? 'border-blue-500 text-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                Asset
              </button>
            </div>

            <div className="flex items-center gap-1 bg-gray-100 dark:bg-[#2b2f36] rounded-xl p-1">
              {timePeriods.map((period) => (
                <button
                  key={period}
                  onClick={() => setTimePeriod(period)}
                  className={`px-4 py-2 text-xs font-medium rounded-lg transition-all ${
                    timePeriod === period
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  {period}
                </button>
              ))}
            </div>
          </div>

          {/* Account tab: wallet-level balances (Funding + Spot/Trading). Asset tab: coin-level balances only. */}
          {activeTab === 'account' && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Account-centric: Funding Account + Spot / Trading Account rows only */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Where are my funds stored?</h3>
              <p className="text-xs text-muted-foreground mb-4">Funding holds deposits and P2P payouts. Trading holds spot order collateral.</p>
              <div className="space-y-4">
                <div className="bg-card rounded-lg p-5 border border-border transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full border-2 border-yellow-400 flex items-center justify-center bg-yellow-50 dark:bg-yellow-900/20">
                        <div className="w-3 h-3 rounded-full bg-yellow-400" />
                      </div>
                      <span className="font-semibold text-foreground">Funding Account</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="font-semibold text-foreground tabular-nums">
                          {showBalance ? formatNumber(fundingBalance.totalUsd) : '******'} USD
                        </p>
                        <p className="text-xs text-muted-foreground">
                          ≈ {showBalance ? formatNumber(fundingBalance.totalBtc, 8) : '********'} BTC
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Link href="/wallet/deposit/crypto" className="p-2 hover:bg-accent rounded-lg transition-colors" title="Deposit">
                          <Download className="w-4 h-4 text-gray-400 hover:text-blue-500" />
                        </Link>
                        <Link href="/wallet/withdraw/crypto" className="p-2 hover:bg-accent rounded-lg transition-colors" title="Withdraw">
                          <Upload className="w-4 h-4 text-gray-400 hover:text-blue-500" />
                        </Link>
                        <Link href="/wallet/transfer" className="p-2 hover:bg-accent rounded-lg transition-colors" title="Transfer">
                          <ArrowLeftRight className="w-4 h-4 text-gray-400 hover:text-blue-500" />
                        </Link>
                        <Link href="/wallet/convert" className="p-2 hover:bg-accent rounded-lg transition-colors" title="Convert">
                          <RefreshCw className="w-4 h-4 text-gray-400 hover:text-blue-500" />
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-card rounded-lg p-5 border border-border transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center">
                        <Wallet className="w-5 h-5 text-muted-foreground" />
                      </div>
                      <div>
                        <span className="font-semibold text-foreground">Spot / Trading Account</span>
                        <p className="text-xs text-muted-foreground">Used for spot trading orders</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="font-semibold text-foreground tabular-nums">
                          {showBalance ? formatNumber(tradingBalance.totalUsd) : '******'} USD
                        </p>
                        <p className="text-xs text-muted-foreground">
                          ≈ {showBalance ? formatNumber(tradingBalance.totalBtc, 8) : '********'} BTC
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Link href="/wallet/deposit/crypto" className="p-2 hover:bg-accent rounded-lg transition-colors" title="Deposit">
                          <Download className="w-4 h-4 text-gray-400 hover:text-blue-500" />
                        </Link>
                        <Link href="/wallet/transfer" className="p-2 hover:bg-accent rounded-lg transition-colors" title="Transfer">
                          <ArrowLeftRight className="w-4 h-4 text-gray-400 hover:text-blue-500" />
                        </Link>
                        <Link href="/wallet/convert" className="p-2 hover:bg-accent rounded-lg transition-colors" title="Convert">
                          <RefreshCw className="w-4 h-4 text-gray-400 hover:text-blue-500" />
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-6">
              {/* Portfolio Allocation Chart */}
              <PortfolioAllocationChart
                items={perCoinBalances.map((row) => {
                  const val = parseFloat(row.usd_value || '0');
                  const total = totalUsd > 0 ? totalUsd : 1;
                  return { symbol: row.symbol, value: val, percent: (val / total) * 100 };
                })}
              />
              {/* Portfolio value — no fabricated time series; balances above are API-sourced */}
              <div className="bg-card rounded-xl p-5 border border-border">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1 h-5 bg-yellow-400 rounded-full" />
                  <h3 className="font-semibold text-foreground">Portfolio value</h3>
                </div>
                <p className="text-2xl font-bold text-foreground tabular-nums">
                  {showBalance ? `${formatNumber(totalUsd)} USD` : '******'}
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Historical balance charts are not shown here. Use{' '}
                  <Link href="/wallet/history" className="text-blue-500 hover:underline">
                    transaction history
                  </Link>{' '}
                  for past activity.
                </p>
                <p className="text-xs text-gray-400 text-right mt-4">
                  Last updated: {lastUpdated ? new Date(lastUpdated).toLocaleString() : '—'}
                </p>
              </div>

              {/* Recent Deposit & Withdrawal History */}
              <div className="bg-card rounded-xl p-5 border border-border">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-5 bg-yellow-400 rounded-full" />
                    <h3 className="font-semibold text-foreground">Recent Deposit & Withdrawal History</h3>
                  </div>
                  <Link href="/wallet/history" className="flex items-center gap-1 text-sm text-primary hover:text-primary/85 font-medium">
                    All
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>

                {recentTransactions.length > 0 ? (
                  <div className="space-y-3">
                    {recentTransactions.slice(0, 5).map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                            tx.type === 'deposit' 
                              ? 'bg-green-100 dark:bg-green-900/20' 
                              : 'bg-red-100 dark:bg-red-900/20'
                          }`}>
                            {tx.type === 'deposit' ? (
                              <Download className="w-4 h-4 text-green-600" />
                            ) : (
                              <Upload className="w-4 h-4 text-red-600" />
                            )}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground capitalize">{tx.type}</p>
                            <p className="text-xs text-gray-500">{tx.symbol}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`text-sm font-medium ${
                            tx.type === 'deposit' ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {tx.type === 'deposit' ? '+' : '-'}{tx.amount}
                          </p>
                          <p className="text-xs text-gray-500">{new Date(tx.created_at).toLocaleDateString()}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="w-16 h-16 bg-accent rounded-full flex items-center justify-center mb-4">
                      <FileText className="w-8 h-8 text-gray-400" />
                    </div>
                    <p className="text-muted-foreground">No recent history found.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
          )}

          {/* Asset tab: coin-level balances + performance analytics. */}
          {activeTab === 'asset' && (
            <div className="space-y-6">
              {/* Asset Performance Table */}
              <AssetPerformanceTable
                showBalance={showBalance}
                rows={perCoinBalances.map((row) => ({
                  symbol: row.symbol,
                  balance: row.total_balance,
                  change24h: 0,
                  change24hPercent: 0,
                  valueUsd: row.usd_value,
                }))}
              />
              <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Which coins do I own?</h3>
              <div className="bg-card rounded-lg border border-border overflow-hidden transition-all duration-200 ease-out hover:border-gray-300 dark:hover:border-white/20">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-border">
                        <th className="py-3 px-4 font-medium uppercase tracking-wide">Coin</th>
                        <th className="py-3 px-4 font-medium uppercase tracking-wide">Total</th>
                        <th className="py-3 px-4 font-medium uppercase tracking-wide">
                          <span className="inline-flex items-center gap-1">Available
                            <Tooltip>
                              <TooltipTrigger asChild><HelpCircle className="w-3.5 h-3.5 text-gray-400 cursor-help" /></TooltipTrigger>
                              <TooltipContent>Amount you can use for trading, transfers, and withdrawals.</TooltipContent>
                            </Tooltip>
                          </span>
                        </th>
                        <th className="py-3 px-4 font-medium uppercase tracking-wide">
                          <span className="inline-flex items-center gap-1">Locked
                            <Tooltip>
                              <TooltipTrigger asChild><HelpCircle className="w-3.5 h-3.5 text-gray-400 cursor-help" /></TooltipTrigger>
                              <TooltipContent>Reserved for open orders. Released when orders fill or are cancelled.</TooltipContent>
                            </Tooltip>
                          </span>
                        </th>
                        <th className="py-3 px-4 font-medium uppercase tracking-wide">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perCoinBalances.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-0">
                            <div className="py-12 px-6 text-center">
                              <p className="text-foreground font-medium">No assets found</p>
                              <p className="text-sm text-muted-foreground mt-1">Deposit funds to start trading</p>
                              <Link
                                href="/wallet/deposit/crypto"
                                className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary hover:bg-primary/85 text-white text-sm font-medium transition-colors"
                              >
                                <Download className="w-4 h-4" />
                                Deposit
                              </Link>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        perCoinBalances.map((row) => (
                          <tr
                            key={row.symbol}
                            onClick={() => router.push(`/wallet/${encodeURIComponent(row.symbol)}`)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/wallet/${encodeURIComponent(row.symbol)}`); } }}
                            className="border-b border-border last:border-0 cursor-pointer hover:bg-gray-50 dark:hover:bg-card/[0.06] transition-colors duration-150"
                          >
                            <td className="py-3 px-4 font-medium text-foreground">{row.symbol}</td>
                            <td className="py-3 px-4 tabular-nums text-foreground/80">{row.total_balance}</td>
                            <td className="py-3 px-4 tabular-nums text-foreground/80">{row.available_balance}</td>
                            <td className="py-3 px-4 tabular-nums text-foreground/80">{row.locked_balance}</td>
                            <td className="py-3 px-4 tabular-nums text-foreground/80">{row.usd_value}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              </div>
            </div>
          )}
    </div>
  );
}
