'use client';

import { useState, useEffect } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { TrendingUp, Loader2 } from 'lucide-react';

interface TradingPair {
  id: string;
  symbol: string;
  base_symbol: string;
  quote_symbol: string;
  status: string;
  trading_enabled: boolean;
  maker_fee: string;
  taker_fee: string;
  min_quantity: string;
}

interface OrderStats {
  total_orders: number;
  active_orders: number;
  filled_orders: number;
  orders_24h: number;
}

interface TradeStats {
  total_trades: number;
  trades_24h: number;
  total_volume: string;
}

export default function TradingPage() {
  const { accessToken } = useAdminAuthStore();
  const [pairs, setPairs] = useState<TradingPair[]>([]);
  const [orderStats, setOrderStats] = useState<OrderStats | null>(null);
  const [tradeStats, setTradeStats] = useState<TradeStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTrading = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const response = await fetch(`${apiUrl}/api/v1/admin/trading`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        setPairs(result.data.pairs);
        setOrderStats(result.data.orderStats);
        setTradeStats(result.data.tradeStats);
      }
    } catch (error) {
      console.error('Failed to fetch trading:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrading();
  }, [accessToken]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Spot Trading</h1>
        <p className="text-gray-400 text-sm mt-1">Trading pairs and order statistics</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Trading Pairs</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{pairs.length}</p>
        </div>
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
          <p className="text-sm text-blue-400">Active Orders</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{orderStats?.active_orders || 0}</p>
        </div>
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4">
          <p className="text-sm text-green-400">Total Trades</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{tradeStats?.total_trades || 0}</p>
        </div>
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
          <p className="text-sm text-blue-400">Trades (24h)</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{tradeStats?.trades_24h || 0}</p>
        </div>
      </div>

      {/* Trading Pairs */}
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Trading Pairs</h2>
        </div>
        {pairs.length === 0 ? (
          <div className="p-8 text-center">
            <TrendingUp className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No trading pairs configured</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Pair</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Status</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Maker Fee</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Taker Fee</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Min Qty</th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((pair) => (
                  <tr key={pair.id} className="border-b border-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700/20">
                    <td className="px-6 py-4">
                      <span className="text-gray-900 dark:text-white font-medium">{pair.symbol}</span>
                      <p className="text-xs text-gray-500">{pair.base_symbol}/{pair.quote_symbol}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        pair.status === 'active' && pair.trading_enabled 
                          ? 'bg-green-500/20 text-green-400' 
                          : 'bg-red-500/20 text-red-400'
                      }`}>
                        {pair.trading_enabled ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">{(parseFloat(pair.maker_fee) * 100).toFixed(2)}%</td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">{(parseFloat(pair.taker_fee) * 100).toFixed(2)}%</td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">{pair.min_quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
