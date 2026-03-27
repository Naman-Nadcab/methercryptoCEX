'use client';

import { useState, useEffect } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { adminFetch } from '@/lib/admin/apiClient';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader, Panel } from '@/components/admin/control-plane';
import { Loader2 } from 'lucide-react';

interface Market {
  symbol: string;
  base_asset?: string;
  quote_asset?: string;
  status?: string;
}

interface OrderbookLevel {
  price: string;
  quantity: string;
}

interface OrderbookData {
  symbol: string;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  lastUpdateId?: number;
}

export default function OrderbookPage() {
  const { accessToken } = useAdminAuthStore();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [orderbook, setOrderbook] = useState<OrderbookData | null>(null);
  const [loadingMarkets, setLoadingMarkets] = useState(true);
  const [loadingBook, setLoadingBook] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) {
      setLoadingMarkets(false);
      return;
    }
    adminFetch<Market[]>('/spot/markets', { token: accessToken })
      .then((res) => {
        if (res.success && res.data && Array.isArray(res.data)) {
          setMarkets(res.data);
          if (res.data.length > 0 && !selectedSymbol) {
            setSelectedSymbol(res.data[0].symbol ?? '');
          }
        }
      })
      .catch(() => setError('Failed to load markets'))
      .finally(() => setLoadingMarkets(false));
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken || !selectedSymbol) {
      setOrderbook(null);
      return;
    }
    setLoadingBook(true);
    setError(null);
    const apiUrl = getApiBaseUrl();
    fetch(`${apiUrl}/api/v1/admin/spot/orderbook/${encodeURIComponent(selectedSymbol)}?depth=50`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => res.json())
      .then((result: { success?: boolean; data?: OrderbookData }) => {
        if (result.success && result.data) {
          setOrderbook(result.data);
        } else {
          setOrderbook({ symbol: selectedSymbol, bids: [], asks: [] });
        }
      })
      .catch(() => {
        setError('Failed to load orderbook');
        setOrderbook(null);
      })
      .finally(() => setLoadingBook(false));
  }, [accessToken, selectedSymbol]);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Order Book Monitor"
        subtitle="Live L2 order book by trading pair"
      />
      <Panel title="Select pair" subtitle="Choose a market to view orderbook">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="pair-select" className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Trading pair
          </label>
          <select
            id="pair-select"
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            disabled={loadingMarkets}
            className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white min-w-[160px]"
          >
            {loadingMarkets ? (
              <option>Loading…</option>
            ) : (
              markets.map((m) => (
                <option key={m.symbol} value={m.symbol}>
                  {m.symbol}
                </option>
              ))
            )}
          </select>
        </div>
      </Panel>
      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
      <Panel title={`Orderbook — ${selectedSymbol || '—'}`} subtitle={orderbook ? `${orderbook.bids.length} bids · ${orderbook.asks.length} asks` : 'Select a pair'}>
        {loadingBook && selectedSymbol ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
          </div>
        ) : orderbook ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-semibold text-green-600 dark:text-green-400 mb-2">Bids</h3>
              <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800/90">
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left py-2 px-3 font-medium text-gray-500 dark:text-gray-400">Price</th>
                      <th className="text-right py-2 px-3 font-medium text-gray-500 dark:text-gray-400">Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderbook.bids.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="py-4 text-center text-gray-500 dark:text-gray-400">No bids</td>
                      </tr>
                    ) : (
                      orderbook.bids.map((row, i) => (
                        <tr key={i} className="border-b border-gray-100 dark:border-gray-800">
                          <td className="py-1.5 px-3 font-mono text-green-600 dark:text-green-400">{row.price}</td>
                          <td className="py-1.5 px-3 text-right font-mono text-gray-900 dark:text-white">{row.quantity}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-red-600 dark:text-red-400 mb-2">Asks</h3>
              <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800/90">
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left py-2 px-3 font-medium text-gray-500 dark:text-gray-400">Price</th>
                      <th className="text-right py-2 px-3 font-medium text-gray-500 dark:text-gray-400">Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderbook.asks.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="py-4 text-center text-gray-500 dark:text-gray-400">No asks</td>
                      </tr>
                    ) : (
                      orderbook.asks.map((row, i) => (
                        <tr key={i} className="border-b border-gray-100 dark:border-gray-800">
                          <td className="py-1.5 px-3 font-mono text-red-600 dark:text-red-400">{row.price}</td>
                          <td className="py-1.5 px-3 text-right font-mono text-gray-900 dark:text-white">{row.quantity}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">Select a trading pair to view orderbook</p>
        )}
      </Panel>
    </div>
  );
}
