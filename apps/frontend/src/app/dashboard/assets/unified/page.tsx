'use client';

import { useState } from 'react';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import Image from 'next/image';
import {
  Eye,
  EyeOff,
  Download,
  ArrowLeftRight,
  RefreshCw,
  ChevronRight,
  Wallet,
  LayoutGrid,
  TrendingUp,
  Clock,
  Search,
  BookOpen,
  Sparkles,
  Activity,
  BarChart3,
} from 'lucide-react';
import { useBalancesTrading } from '@/lib/balances';

export default function UnifiedTradingPage() {
  const { accessToken, _hasHydrated } = useAuthStore();
  const { data: tradingData, isLoading: loading } = useBalancesTrading(!!_hasHydrated && !!accessToken);
  const balances = tradingData?.balances ?? [];
  const totalEquity = tradingData?.totalEquity ?? { usd: 0 };
  const availableBalance = tradingData?.availableBalance ?? { usd: 0 };
  const unrealizedPnl = tradingData?.unrealizedPnl ?? { usd: 0 };

  const [showBalance, setShowBalance] = useState(true);
  const [hideSmallBalances, setHideSmallBalances] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showGuide, setShowGuide] = useState(true);
  const [ordersExpanded, setOrdersExpanded] = useState(false);

  const getTokenIcon = (symbol: string) => {
    return `/assets/upload/currency-logo/${symbol.toLowerCase()}.svg`;
  };

  const formatNumber = (num: number | string, decimals = 2) => {
    const n = typeof num === 'string' ? parseFloat(num) : num;
    if (!Number.isFinite(n)) return '0.' + '0'.repeat(decimals);
    return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };

  const filteredBalances = balances
    .filter(b => {
      if (hideSmallBalances && parseFloat(b.usd_value) < 1 && parseFloat(b.usd_value) > -1) return false;
      if (searchQuery) {
        return b.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
               b.name.toLowerCase().includes(searchQuery.toLowerCase());
      }
      return true;
    });

  const guideSteps = [
    { num: 1, title: 'Overview', active: true },
    { num: 2, title: 'Deposit Funds', active: false },
    { num: 3, title: 'Start Trading', active: false },
  ];

  return (
    <div className="p-6">
          {/* Guide Banner */}
          {showGuide && (
            <div className="bg-card rounded-xl p-5 mb-6 border border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25">
                    <BookOpen className="w-7 h-7 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground text-lg">Spot Trading Account Guide</h3>
                    <div className="flex items-center gap-4 mt-2">
                      {guideSteps.map((step, i) => (
                        <div key={step.num} className="flex items-center gap-2">
                          <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-semibold ${
                            step.active 
                              ? 'bg-primary text-primary-foreground' 
                              : 'bg-accent text-muted-foreground'
                          }`}>
                            {step.num}
                          </div>
                          <span className={`text-sm ${step.active ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                            {step.title}
                          </span>
                          {i < guideSteps.length - 1 && <ChevronRight className="w-4 h-4 text-gray-300" />}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <button 
                  onClick={() => setShowGuide(false)}
                  className="px-5 py-2.5 bg-primary hover:bg-primary/85 text-white text-sm font-medium rounded-xl transition-colors shadow-lg shadow-blue-500/25"
                >
                  Got it
                </button>
              </div>
            </div>
          )}

          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-foreground">Unified Trading</h1>
                <button
                  onClick={() => setShowBalance(!showBalance)}
                  className="p-2 text-muted-foreground hover:text-primary hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                >
                  {showBalance ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                </button>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100 dark:border-blue-800/30">
                <BarChart3 className="w-4 h-4 text-primary" />
                <span className="text-sm text-primary font-medium">Spot Trading</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/wallet/deposit/crypto"
                className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary/85 text-white font-medium text-sm rounded-xl shadow-lg shadow-blue-500/25 transition-all hover:shadow-blue-500/40"
              >
                <Download className="w-4 h-4" />
                Deposit
              </Link>
              <Link
                href="/wallet/convert"
                className="flex items-center gap-2 px-5 py-2.5 bg-card text-foreground/80 font-medium text-sm rounded-xl border border-border hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Convert
              </Link>
              <Link
                href="/wallet/transfer"
                className="flex items-center gap-2 px-5 py-2.5 bg-card text-foreground/80 font-medium text-sm rounded-xl border border-border hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
              >
                <ArrowLeftRight className="w-4 h-4" />
                Transfer
              </Link>
              <Link
                href="/wallet/history"
                className="flex items-center gap-2 px-4 py-2.5 bg-card text-foreground/80 font-medium text-sm rounded-xl border border-border hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
              >
                <Clock className="w-4 h-4" />
                History
              </Link>
            </div>
          </div>

          {/* Balance Summary */}
          <div className="bg-card rounded-xl p-6 mb-6 border border-border">
            <div className="grid grid-cols-3 gap-8">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
                    <Wallet className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-muted-foreground">Total Equity</p>
                    <Link href="/wallet/pnl" className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-primary text-xs rounded-lg flex items-center gap-1 hover:bg-blue-200 dark:hover:bg-blue-800/40 transition-colors">
                      <TrendingUp className="w-3 h-3" /> P&L
                    </Link>
                  </div>
                </div>
                <p className="text-3xl font-bold text-foreground">
                  {showBalance ? formatNumber(totalEquity.usd) : '******'} <span className="text-sm font-normal text-muted-foreground">USD</span>
                </p>
              </div>
              <div className="border-l border-border pl-8">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
                    <Activity className="w-5 h-5 text-white" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">Available Balance</p>
                </div>
                <p className="text-3xl font-bold text-foreground">
                  {showBalance ? formatNumber(availableBalance.usd) : '******'} <span className="text-sm font-normal text-muted-foreground">USD</span>
                </p>
              </div>
              <div className="border-l border-border pl-8">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
                    <TrendingUp className="w-5 h-5 text-white" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">Unrealized P&L</p>
                </div>
                <p className="text-3xl font-bold text-foreground">
                  {showBalance ? formatNumber(unrealizedPnl.usd) : '******'} <span className="text-sm font-normal text-muted-foreground">USD</span>
                </p>
              </div>
            </div>
          </div>

          {/* Table Card */}
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            {/* Filters */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search coin..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 pr-4 py-2.5 bg-muted dark:bg-[#2b2f36] border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-primary focus:border-transparent w-64"
                  />
                </div>
                <label className="flex items-center gap-2.5 cursor-pointer px-3 py-2 bg-muted dark:bg-[#2b2f36] rounded-xl border border-border">
                  <input
                    type="checkbox"
                    checked={hideSmallBalances}
                    onChange={(e) => setHideSmallBalances(e.target.checked)}
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <span className="text-sm text-muted-foreground">Hide small balances</span>
                </label>
                <Link 
                  href="/wallet/convert"
                  className="text-sm text-primary hover:text-primary/85 flex items-center gap-1 font-medium"
                >
                  <Sparkles className="w-4 h-4" />
                  Convert Small Balances
                </Link>
              </div>

              {/* Savings Promo */}
              <div className="flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl border border-blue-100 dark:border-blue-800/30">
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div className="text-sm">
                  <span className="text-foreground/80">Savings USDT </span>
                  <span className="text-green-500 font-semibold">6.14%</span>
                </div>
                <ChevronRight className="w-4 h-4 text-primary" />
              </div>
            </div>

            {/* Table */}
            <table className="w-full">
              <thead>
                <tr className="bg-background">
                  <th className="text-left px-6 py-4 text-xs font-semibold text-muted-foreground uppercase">Currency</th>
                  <th className="text-right px-6 py-4 text-xs font-semibold text-muted-foreground uppercase">Total Balance</th>
                  <th className="text-right px-6 py-4 text-xs font-semibold text-muted-foreground uppercase">Available Balance</th>
                  <th className="text-right px-6 py-4 text-xs font-semibold text-muted-foreground uppercase">In Orders</th>
                  <th className="text-right px-6 py-4 text-xs font-semibold text-muted-foreground uppercase">USD Value</th>
                  <th className="text-right px-6 py-4 text-xs font-semibold text-muted-foreground uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-16 text-center">
                      <div className="flex flex-col items-center">
                        <RefreshCw className="w-8 h-8 text-primary animate-spin mb-3" />
                        <p className="text-sm text-muted-foreground">Loading balances...</p>
                      </div>
                    </td>
                  </tr>
                ) : filteredBalances.length > 0 ? (
                  filteredBalances.map((balance) => (
                    <tr key={balance.token_id} className="hover:bg-accent/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl overflow-hidden bg-accent flex items-center justify-center flex-shrink-0">
                            <Image
                              src={getTokenIcon(balance.symbol)}
                              alt={balance.symbol}
                              width={40}
                              height={40}
                              className="object-contain"
                              unoptimized
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          </div>
                          <div>
                            <span className="font-semibold text-foreground">{balance.symbol}</span>
                            <p className="text-xs text-muted-foreground mt-0.5">{balance.name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-sm text-foreground">
                        {showBalance ? formatNumber(balance.equity || balance.wallet_balance, 8) : '********'}
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-sm text-foreground">
                        {showBalance ? formatNumber(balance.available_balance || balance.wallet_balance, 8) : '********'}
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-sm text-foreground">
                        {showBalance ? formatNumber(balance.locked_balance || '0', 8) : '********'}
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-sm text-foreground">
                        {showBalance ? `$${formatNumber(balance.usd_value, 2)}` : '********'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          href="/trade/spot"
                          className="px-4 py-1.5 text-sm text-primary hover:text-primary/85 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors font-medium"
                        >
                          Trade
                        </Link>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="py-20 text-center">
                      <div className="flex flex-col items-center">
                        <div className="w-20 h-20 bg-accent rounded-xl flex items-center justify-center mb-4">
                          <Wallet className="w-10 h-10 text-gray-300 dark:text-muted-foreground" />
                        </div>
                        <p className="text-muted-foreground font-medium">No assets found</p>
                        <p className="text-sm text-muted-foreground mt-1">Transfer funds to start trading</p>
                        <Link
                          href="/wallet/transfer"
                          className="mt-4 px-6 py-2.5 bg-primary hover:bg-primary/85 text-white font-medium text-sm rounded-xl transition-colors inline-block"
                        >
                          Transfer Now
                        </Link>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
    </div>
  );
}
