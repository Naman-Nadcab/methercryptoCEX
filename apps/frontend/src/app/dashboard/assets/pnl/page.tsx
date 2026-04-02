'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import Link from 'next/link';
import { notifyError } from '@/lib/notifyError';
import {
  ChevronRight,
  ChevronDown,
  Wallet,
  LayoutGrid,
  TrendingUp,
  TrendingDown,
  Clock,
  RefreshCw,
  BarChart3,
  Calendar,
  Filter,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';

interface PnlData {
  symbol: string;
  pnl: number;
  pnlPercentage: number;
}

interface PnlSummary {
  totalPnl: number;
  totalFilledValue: number;
}

export default function PnlAnalysisPage() {
  const { accessToken } = useAuthStore();
  
  const [activeTab, setActiveTab] = useState<'assets' | 'spot'>('spot');
  const [selectedSymbol, setSelectedSymbol] = useState('all');
  const [timePeriod, setTimePeriod] = useState('7D');
  const [pnlData, setPnlData] = useState<PnlData[]>([]);
  const [summary, setSummary] = useState<PnlSummary>({ totalPnl: 0, totalFilledValue: 0 });
  const [loading, setLoading] = useState(true);
  const [showSymbolDropdown, setShowSymbolDropdown] = useState(false);
  const [chartData, setChartData] = useState<{ date: string; value: number }[]>([]);
  const [ordersExpanded, setOrdersExpanded] = useState(false);

  const API_URL = getApiBaseUrl();

  const timePeriods = [
    { id: '7D', label: 'Last 7 D' },
    { id: '30D', label: 'Last 30 D' },
    { id: '60D', label: 'Last 60 D' },
    { id: '90D', label: 'Last 90 D' },
    { id: '180D', label: 'Last 180 D' },
    { id: 'custom', label: 'Custom' },
  ];

  const symbols = ['All Symbols', 'BTC', 'ETH', 'USDT', 'SOL', 'XRP'];

  useEffect(() => {
    if (accessToken) {
      fetchPnlData();
    }
  }, [accessToken, activeTab, timePeriod, selectedSymbol]);

  const fetchPnlData = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/v1/wallet/pnl?period=${timePeriod}&type=${activeTab}&symbol=${selectedSymbol}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setPnlData(data.data.rankings || []);
          setSummary(data.data.summary || { totalPnl: 0, totalFilledValue: 0 });
          setChartData(data.data.chartData || generateMockChartData());
        }
      } else {
        setChartData(generateMockChartData());
      }
    } catch (error) {
      notifyError('Failed to load P&L data. Please try again.');
      setChartData(generateMockChartData());
    } finally {
      setLoading(false);
    }
  };

  const generateMockChartData = () => {
    const days = timePeriod === '7D' ? 7 : timePeriod === '30D' ? 30 : timePeriod === '60D' ? 60 : timePeriod === '90D' ? 90 : 180;
    const data = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      data.push({
        date: date.toISOString().split('T')[0],
        value: 0,
      });
    }
    return data;
  };

  const formatNumber = (num: number, decimals = 2) => {
    return num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };

  const chartPoints = chartData.map((d, i) => ({
    x: (i / (chartData.length - 1 || 1)) * 100,
    y: 50,
    date: d.date,
    value: d.value,
  }));

  return (
    <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">P&L Analysis</h1>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100 dark:border-blue-800/30">
                <BarChart3 className="w-4 h-4 text-blue-500" />
                <span className="text-sm text-blue-600 dark:text-blue-400 font-medium">Performance Tracking</span>
              </div>
            </div>
            <button
              onClick={fetchPnlData}
              className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-[#1e2329] text-gray-700 dark:text-gray-300 font-medium text-sm rounded-xl border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {/* Tabs */}
          <div className="bg-white dark:bg-[#1e2329] rounded-2xl border border-gray-100 dark:border-gray-800 mb-6">
            <div className="flex gap-1 p-1.5 bg-gray-100 dark:bg-[#2b2f36] m-4 rounded-xl w-fit">
              <button
                onClick={() => setActiveTab('assets')}
                className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all ${
                  activeTab === 'assets'
                    ? 'bg-white dark:bg-[#1e2329] text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                Assets
              </button>
              <button
                onClick={() => setActiveTab('spot')}
                className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all ${
                  activeTab === 'spot'
                    ? 'bg-white dark:bg-[#1e2329] text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                Spot
              </button>
            </div>

            {/* Filters */}
            <div className="px-6 pb-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {/* Symbol Dropdown */}
                  <div className="relative">
                    <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Symbol</p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowSymbolDropdown(!showSymbolDropdown);
                      }}
                      className="flex items-center justify-between gap-8 px-4 py-2.5 bg-gray-50 dark:bg-[#2b2f36] rounded-xl text-sm text-gray-900 dark:text-white min-w-[180px] border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Filter className="w-4 h-4 text-gray-400" />
                        <span>{selectedSymbol === 'all' ? 'All Symbols' : selectedSymbol}</span>
                      </div>
                      <ChevronDown className={`w-4 h-4 transition-transform ${showSymbolDropdown ? 'rotate-180' : ''}`} />
                    </button>
                    {showSymbolDropdown && (
                      <div className="absolute top-full left-0 mt-2 w-full bg-white dark:bg-[#1e2329] border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl z-10 overflow-hidden">
                        {symbols.map((symbol) => (
                          <button
                            key={symbol}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedSymbol(symbol === 'All Symbols' ? 'all' : symbol);
                              setShowSymbolDropdown(false);
                            }}
                            className={`w-full px-4 py-3 text-left text-sm transition-colors ${
                              (symbol === 'All Symbols' && selectedSymbol === 'all') || symbol === selectedSymbol
                                ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                            }`}
                          >
                            {symbol}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Time Period */}
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Time Period</p>
                    <div className="flex gap-2">
                      {timePeriods.map((period) => (
                        <button
                          key={period.id}
                          onClick={() => setTimePeriod(period.id)}
                          className={`px-4 py-2.5 text-sm font-medium rounded-xl transition-all ${
                            timePeriod === period.id
                              ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/25'
                              : 'bg-gray-50 dark:bg-[#2b2f36] text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600'
                          }`}
                        >
                          {period.id === 'custom' && <Calendar className="w-4 h-4 inline mr-1" />}
                          {period.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-6 mb-6">
            <div className="bg-white dark:bg-[#1e2329] rounded-2xl p-6 border border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  summary.totalPnl >= 0 
                    ? 'bg-gradient-to-br from-green-500 to-emerald-500' 
                    : 'bg-gradient-to-br from-red-500 to-rose-500'
                }`}>
                  {summary.totalPnl >= 0 
                    ? <ArrowUpRight className="w-6 h-6 text-white" />
                    : <ArrowDownRight className="w-6 h-6 text-white" />
                  }
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Total P&L</p>
                  <p className={`text-3xl font-bold ${summary.totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {summary.totalPnl >= 0 ? '+' : ''}{formatNumber(summary.totalPnl)} <span className="text-base font-normal text-gray-500">USD</span>
                  </p>
                </div>
              </div>
            </div>
            <div className="bg-white dark:bg-[#1e2329] rounded-2xl p-6 border border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
                  <BarChart3 className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Total Filled Value</p>
                  <p className="text-3xl font-bold text-blue-500">
                    {formatNumber(summary.totalFilledValue)} <span className="text-base font-normal text-gray-500">USD</span>
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Filled Value Trend Chart */}
            <div className="bg-white dark:bg-[#1e2329] rounded-2xl p-6 border border-gray-100 dark:border-gray-800">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-semibold text-gray-900 dark:text-white text-lg">Filled Value Trend</h3>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <div className="w-3 h-3 rounded bg-blue-500" />
                    <span className="text-xs text-gray-500">Total</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <div className="w-3 h-3 rounded bg-green-500" />
                    <span className="text-xs text-gray-500">Buy</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <div className="w-3 h-3 rounded bg-red-500" />
                    <span className="text-xs text-gray-500">Sell</span>
                  </label>
                </div>
              </div>

              {/* Chart */}
              <div className="relative h-64">
                {/* Y-axis labels */}
                <div className="absolute left-0 top-0 bottom-8 w-10 flex flex-col justify-between text-xs text-gray-400">
                  <span>1.0</span>
                  <span>0.8</span>
                  <span>0.6</span>
                  <span>0.4</span>
                  <span>0.2</span>
                  <span>0</span>
                </div>

                {/* Chart area */}
                <div className="ml-12 h-full relative">
                  {/* Grid lines */}
                  <div className="absolute inset-x-0 top-0 bottom-8 flex flex-col justify-between pointer-events-none">
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <div key={i} className="border-t border-gray-100 dark:border-gray-800" />
                    ))}
                  </div>

                  {/* SVG Chart */}
                  <svg className="w-full h-[calc(100%-2rem)]" viewBox="0 0 100 100" preserveAspectRatio="none">
                    {/* Zero line */}
                    <line x1="0" y1="50" x2="100" y2="50" stroke="#3b82f6" strokeWidth="0.5" strokeDasharray="2,2" />
                    
                    {/* Data line */}
                    <path
                      d={`M 0,50 ${chartPoints.map(p => `L ${p.x},${p.y}`).join(' ')}`}
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth="2"
                    />
                    
                    {/* Data points */}
                    {chartPoints.map((point, i) => (
                      <circle
                        key={i}
                        cx={point.x}
                        cy={point.y}
                        r="2"
                        fill="#3b82f6"
                        className="hover:r-4 cursor-pointer"
                      />
                    ))}
                  </svg>

                  {/* X-axis labels */}
                  <div className="absolute bottom-0 left-0 right-0 flex justify-between text-xs text-gray-400 pt-2">
                    {chartData.filter((_, i) => i % Math.ceil(chartData.length / 6) === 0).map((d, i) => (
                      <span key={i}>{d.date.slice(5)}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* PnL Ranking */}
            <div className="bg-white dark:bg-[#1e2329] rounded-2xl p-6 border border-gray-100 dark:border-gray-800">
              <h3 className="font-semibold text-gray-900 dark:text-white text-lg mb-6">P&L Ranking</h3>
              
              {/* Table Header */}
              <div className="flex justify-between text-xs font-semibold text-gray-400 uppercase mb-4 pb-3 border-b border-gray-100 dark:border-gray-800">
                <span>Symbol</span>
                <span>P&L</span>
              </div>

              {/* Table Body */}
              {loading ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mb-3" />
                  <p className="text-sm text-gray-500">Loading rankings...</p>
                </div>
              ) : pnlData.length > 0 ? (
                <div className="space-y-3">
                  {pnlData.map((item, i) => (
                    <div key={i} className="flex items-center justify-between py-3 px-4 bg-gray-50 dark:bg-[#2b2f36] rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded-lg bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-semibold text-gray-500">
                          {i + 1}
                        </span>
                        <span className="font-medium text-gray-900 dark:text-white">{item.symbol}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {item.pnl >= 0 
                          ? <TrendingUp className="w-4 h-4 text-green-500" />
                          : <TrendingDown className="w-4 h-4 text-red-500" />
                        }
                        <span className={`font-semibold ${item.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {item.pnl >= 0 ? '+' : ''}{formatNumber(item.pnl)} USD
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="w-20 h-20 bg-gray-100 dark:bg-gray-800 rounded-2xl flex items-center justify-center mb-4">
                    <BarChart3 className="w-10 h-10 text-gray-300 dark:text-gray-600" />
                  </div>
                  <p className="text-gray-500 font-medium">No trading data yet</p>
                  <p className="text-sm text-gray-400 mt-1">Start trading to see your P&L</p>
                  <Link
                    href="/trade/spot"
                    className="mt-4 px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-medium text-sm rounded-xl transition-colors"
                  >
                    Start Trading
                  </Link>
                </div>
              )}
            </div>
          </div>
    </div>
  );
}
