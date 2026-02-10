'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { getMessageFromApiError } from '@/lib/errorMessages';
import { Loader2, RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react';

type MarketDetail = {
  id: string;
  symbol: string;
  base_asset: string;
  quote_asset: string;
  status: string;
  min_qty: string;
  min_notional: string;
  maker_fee: string;
  taker_fee: string;
  circuit_breaker_count?: number;
  circuit_breaker_tripped?: boolean;
  open_orders_count?: number;
  volume_24h?: string;
  last_price?: string | null;
};

type MarketListItem = { id: string; symbol: string };

export default function MarketControlPage() {
  const { accessToken } = useAdminAuthStore();
  const [markets, setMarkets] = useState<MarketListItem[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [detail, setDetail] = useState<MarketDetail | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const fetchMarkets = useCallback(async () => {
    if (!accessToken) {
      setLoadingList(false);
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
        setLoadingList(false);
        return;
      }
      if (data.success && Array.isArray(data.data)) {
        setMarkets(data.data.map((m: { id: string; symbol: string }) => ({ id: m.id, symbol: m.symbol })));
        if (!selectedSymbol && data.data.length > 0) setSelectedSymbol(data.data[0].symbol);
      }
    } catch {
      setError('Could not load markets. Check your connection.');
    } finally {
      setLoadingList(false);
    }
  }, [accessToken, selectedSymbol]);

  const fetchDetail = useCallback(async () => {
    if (!accessToken || !selectedSymbol) {
      setDetail(null);
      return;
    }
    setLoadingDetail(true);
    setError(null);
    try {
      const res = await fetch(
        `${getApiBaseUrl()}/api/v1/admin/spot/markets/${encodeURIComponent(selectedSymbol)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(getMessageFromApiError(data?.error));
        setDetail(null);
        setLoadingDetail(false);
        return;
      }
      if (data.success && data.data) setDetail(data.data as MarketDetail);
      else setDetail(null);
    } catch {
      setError('Could not load market detail.');
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, [accessToken, selectedSymbol]);

  useEffect(() => {
    fetchMarkets();
  }, [fetchMarkets]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const handleStatusChange = async (status: string) => {
    if (!accessToken || !selectedSymbol || !detail) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `${getApiBaseUrl()}/api/v1/admin/spot/markets/${encodeURIComponent(selectedSymbol)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ status }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(getMessageFromApiError(data?.error));
        setSaving(false);
        return;
      }
      if (data.success) {
        setDetail((d) => (d ? { ...d, status } : null));
      } else {
        setError(getMessageFromApiError(data?.error) || 'Update failed');
      }
    } catch {
      setError('Could not update status.');
    } finally {
      setSaving(false);
    }
  };

  const handleCircuitReset = async () => {
    if (!accessToken || !selectedSymbol) return;
    setResetting(true);
    setError(null);
    setConfirmReset(false);
    try {
      const res = await fetch(
        `${getApiBaseUrl()}/api/v1/admin/spot/markets/${encodeURIComponent(selectedSymbol)}/circuit-reset`,
        { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(getMessageFromApiError(data?.error));
        setResetting(false);
        return;
      }
      if (data.success) {
        setDetail((d) =>
          d
            ? {
                ...d,
                status: 'active',
                circuit_breaker_count: 0,
                circuit_breaker_tripped: false,
              }
            : null
        );
      } else {
        setError(getMessageFromApiError(data?.error) || 'Reset failed');
      }
    } catch {
      setError('Could not reset circuit.');
    } finally {
      setResetting(false);
    }
  };

  const handleUpdateFeesLimits = async (payload: { min_qty?: number; min_notional?: number; maker_fee?: number; taker_fee?: number }) => {
    if (!accessToken || !selectedSymbol) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `${getApiBaseUrl()}/api/v1/admin/spot/markets/${encodeURIComponent(selectedSymbol)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(getMessageFromApiError(data?.error));
        setSaving(false);
        return;
      }
      if (data.success && data.data) {
        setDetail((d) => (d ? { ...d, ...data.data } : null));
      } else {
        setError(getMessageFromApiError(data?.error) || 'Update failed');
      }
    } catch {
      setError('Could not update.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Market Control</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Control trading status, fees, limits, and circuit breakers per market.</p>
      </div>

      {error && (
        <div className="flex items-center justify-between px-4 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-600 dark:text-red-400 text-sm">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-red-500 hover:text-red-700">Dismiss</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Market selector */}
        <div className="lg:col-span-1">
          <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Select market</h2>
            {loadingList ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-10 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                ))}
              </div>
            ) : (
              <select
                value={selectedSymbol}
                onChange={(e) => setSelectedSymbol(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="">— Select —</option>
                {markets.map((m) => (
                  <option key={m.id} value={m.symbol}>
                    {m.symbol}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Detail & controls */}
        <div className="lg:col-span-2 space-y-4">
          {loadingDetail && selectedSymbol ? (
            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-8 animate-pulse">
              <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4" />
              <div className="space-y-3">
                <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-24 bg-gray-200 dark:bg-gray-700 rounded" />
              </div>
            </div>
          ) : detail ? (
            <>
              {/* Status card */}
              <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Trading status</h3>
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${
                      detail.status === 'active'
                        ? 'bg-green-500/20 text-green-700 dark:text-green-400'
                        : detail.status === 'maintenance'
                        ? 'bg-amber-500/20 text-amber-700 dark:text-amber-400'
                        : 'bg-gray-500/20 text-gray-700 dark:text-gray-400'
                    }`}
                  >
                    {detail.status === 'active' ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                    {detail.status}
                  </span>
                  <select
                    value={detail.status}
                    onChange={(e) => handleStatusChange(e.target.value)}
                    disabled={saving}
                    className="px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm disabled:opacity-50"
                  >
                    <option value="active">Active (Trading ON)</option>
                    <option value="maintenance">Maintenance (Trading OFF)</option>
                    <option value="disabled">Disabled</option>
                  </select>
                  {saving && <Loader2 className="w-4 h-4 animate-spin text-gray-500" />}
                </div>
              </div>

              {/* Live stats */}
              <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Live stats</h3>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">Open orders</p>
                    <p className="font-mono font-medium text-gray-900 dark:text-white">{detail.open_orders_count ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">24h volume</p>
                    <p className="font-mono font-medium text-gray-900 dark:text-white">
                      {detail.volume_24h ? Number(detail.volume_24h).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '0'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">Last price</p>
                    <p className="font-mono font-medium text-gray-900 dark:text-white">{detail.last_price ?? '—'}</p>
                  </div>
                </div>
              </div>

              {/* Fees & limits */}
              <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Fees & limits</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">Maker fee</p>
                    <p className="font-mono">{(parseFloat(detail.maker_fee) * 100).toFixed(2)}%</p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">Taker fee</p>
                    <p className="font-mono">{(parseFloat(detail.taker_fee) * 100).toFixed(2)}%</p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">Min qty</p>
                    <p className="font-mono">{detail.min_qty}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">Min notional</p>
                    <p className="font-mono">{detail.min_notional}</p>
                  </div>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">To change fees and limits, use Market List → Edit.</p>
              </div>

              {/* Circuit breaker */}
              <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Circuit breaker</h3>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    Failure count: <strong className="text-gray-900 dark:text-white">{detail.circuit_breaker_count ?? 0}</strong>
                    {detail.circuit_breaker_tripped && (
                      <span className="ml-2 px-2 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-400 text-xs">Tripped</span>
                    )}
                  </span>
                  {(detail.circuit_breaker_count ?? 0) > 0 && (
                    <>
                      {!confirmReset ? (
                        <button
                          type="button"
                          onClick={() => setConfirmReset(true)}
                          className="px-3 py-1.5 text-sm border border-amber-500 text-amber-600 dark:text-amber-400 rounded-lg hover:bg-amber-500/10"
                        >
                          Reset circuit
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">Confirm reset?</span>
                          <button
                            type="button"
                            onClick={handleCircuitReset}
                            disabled={resetting}
                            className="px-3 py-1.5 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 flex items-center gap-1"
                          >
                            {resetting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                            Yes, reset
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmReset(false)}
                            className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </>
          ) : selectedSymbol ? (
            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-8 text-center text-gray-500 dark:text-gray-400">
              Could not load market detail.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
