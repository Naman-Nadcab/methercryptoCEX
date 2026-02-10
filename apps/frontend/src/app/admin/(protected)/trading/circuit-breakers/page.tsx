'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { getMessageFromApiError } from '@/lib/errorMessages';
import { Loader2, RefreshCw, AlertTriangle } from 'lucide-react';

type MarketRow = {
  id: string;
  symbol: string;
  status: string;
  circuit_breaker_count?: number;
  circuit_breaker_tripped?: boolean;
};

export default function CircuitBreakersPage() {
  const { accessToken } = useAdminAuthStore();
  const [markets, setMarkets] = useState<MarketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchMarkets = useCallback(async () => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/admin/spot/markets`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(getMessageFromApiError(data?.error));
        setLoading(false);
        return;
      }
      if (data.success && Array.isArray(data.data)) {
        setMarkets(data.data);
      }
    } catch {
      setError('Could not load markets.');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchMarkets();
  }, [fetchMarkets]);

  const handleReset = async (symbol: string) => {
    if (!accessToken) return;
    setResetting(symbol);
    setError(null);
    try {
      const res = await fetch(
        `${getApiBaseUrl()}/api/v1/admin/spot/markets/${encodeURIComponent(symbol)}/circuit-reset`,
        { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(getMessageFromApiError(data?.error));
        setResetting(null);
        return;
      }
      if (data.success) {
        setMarkets((prev) =>
          prev.map((m) =>
            m.symbol === symbol
              ? { ...m, circuit_breaker_count: 0, circuit_breaker_tripped: false, status: 'active' }
              : m
          )
        );
      } else {
        setError(getMessageFromApiError(data?.error) || 'Reset failed');
      }
    } catch {
      setError('Could not reset circuit.');
    } finally {
      setResetting(null);
    }
  };

  const tripped = markets.filter((m) => m.circuit_breaker_tripped);
  const withCount = markets.filter((m) => (m.circuit_breaker_count ?? 0) > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Circuit Breakers</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Spot market circuit breaker state and reset.</p>
      </div>

      {error && (
        <div className="flex items-center justify-between px-4 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-600 dark:text-red-400 text-sm">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {tripped.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="w-4 h-4" />
                    {tripped.length} market(s) tripped
                  </span>
                )}
                {tripped.length === 0 && withCount.length > 0 && (
                  <span className="text-gray-500">{withCount.length} market(s) with failure count</span>
                )}
                {withCount.length === 0 && tripped.length === 0 && (
                  <span className="text-green-600 dark:text-green-400">No circuit breakers tripped</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => fetchMarkets()}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
              >
                <RefreshCw className="w-4 h-4" /> Refresh
              </button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="p-3">Symbol</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Failure count</th>
                  <th className="p-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {markets.map((m) => (
                  <tr key={m.id} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="p-3 font-medium">{m.symbol}</td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${
                          m.status === 'active'
                            ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                            : m.status === 'maintenance'
                            ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                            : 'bg-gray-500/20 text-gray-600 dark:text-gray-400'
                        }`}
                      >
                        {m.status}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className={m.circuit_breaker_tripped ? 'text-amber-600 dark:text-amber-400 font-medium' : ''}>
                        {m.circuit_breaker_count ?? 0}
                        {m.circuit_breaker_tripped && ' (tripped)'}
                      </span>
                    </td>
                    <td className="p-3">
                      {(m.circuit_breaker_count ?? 0) > 0 && (
                        <button
                          type="button"
                          onClick={() => handleReset(m.symbol)}
                          disabled={resetting === m.symbol}
                          className="text-amber-600 dark:text-amber-400 hover:underline text-xs flex items-center gap-1 disabled:opacity-50"
                        >
                          {resetting === m.symbol ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                          Reset
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {markets.length === 0 && (
              <div className="p-8 text-center text-gray-500 dark:text-gray-400">No spot markets configured.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
