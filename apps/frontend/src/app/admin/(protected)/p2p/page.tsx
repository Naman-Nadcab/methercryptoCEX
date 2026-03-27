'use client';

import { useState, useEffect } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { Repeat, Loader2, AlertTriangle, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { AdminChartCard, P2PActivityChart, TradeDistributionChart } from '@/components/admin/charts';

interface P2PStats {
  adsStats: {
    total_ads: number;
    active_ads: number;
    buy_ads: number;
    sell_ads: number;
  };
  orderStats: {
    total_orders: number;
    active_orders: number;
    completed_orders: number;
    disputed_orders: number;
  };
  disputeStats: {
    total_disputes: number;
    open_disputes: number;
    under_review: number;
    resolved_disputes: number;
  };
  paymentMethods: Array<{
    id: string;
    name: string;
    code: string;
    method_type: string;
    is_active: boolean;
  }>;
}

export default function P2PPage() {
  const { accessToken } = useAdminAuthStore();
  const [data, setData] = useState<P2PStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchP2P = async () => {
    setFetchError(null);
    try {
      const apiUrl = getApiBaseUrl();
      const response = await fetch(`${apiUrl}/api/v1/admin/p2p`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        setData(result.data);
        setLastUpdated(new Date());
      } else {
        setFetchError(result?.error?.message ?? 'Failed to load P2P stats');
      }
    } catch (error) {
      console.error('Failed to fetch P2P:', error);
      setFetchError(error instanceof Error ? error.message : 'Failed to load P2P stats');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchP2P();
  }, [accessToken]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">P2P Trading</h1>
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 flex items-center gap-3 text-red-400">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{fetchError}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">P2P Trading</h1>
        <p className="text-gray-400 text-sm mt-1">
          P2P marketplace overview
          {lastUpdated && <span className="ml-2 text-gray-500"> · Last updated {lastUpdated.toLocaleTimeString()}</span>}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Link
          href="/admin/p2p/orders?tab=ads"
          className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4 block hover:border-blue-500/40 dark:hover:border-blue-500/40 transition-colors group"
        >
          <p className="text-sm text-gray-500 dark:text-gray-400">Total Ads</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{data?.adsStats?.total_ads || 0}</p>
          <p className="text-xs text-gray-500 flex items-center gap-1 mt-1">
            {data?.adsStats?.active_ads || 0} active <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
          </p>
        </Link>
        <Link
          href="/admin/p2p/trades"
          className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 block hover:border-blue-500/50 transition-colors group"
        >
          <p className="text-sm text-blue-400">Total Orders</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{data?.orderStats?.total_orders || 0}</p>
          <p className="text-xs text-gray-500 flex items-center gap-1 mt-1">
            {data?.orderStats?.active_orders || 0} in progress <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
          </p>
        </Link>
        <Link
          href="/admin/p2p/orders?status=completed"
          className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 block hover:border-green-500/50 transition-colors group"
        >
          <p className="text-sm text-green-400">Completed</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{data?.orderStats?.completed_orders || 0}</p>
          <p className="text-xs text-gray-500 flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100">
            <ChevronRight className="w-3.5 h-3.5" />
          </p>
        </Link>
        <Link
          href="/admin/p2p/disputes?status=open"
          className={`${(data?.disputeStats?.open_disputes || 0) > 0 ? 'bg-red-500/10 border-red-500/30' : 'bg-gray-800/50 border-gray-700'} border rounded-xl p-4 block hover:border-red-500/50 transition-colors group`}
        >
          <p className={`text-sm ${(data?.disputeStats?.open_disputes || 0) > 0 ? 'text-red-400' : 'text-gray-400'}`}>Open Disputes</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{data?.disputeStats?.open_disputes || 0}</p>
          <p className="text-xs flex items-center gap-1 mt-1">
            {(data?.disputeStats?.open_disputes || 0) > 0 ? (
              <span className="text-red-400">View disputes <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" /></span>
            ) : (
              <span className="text-gray-500">View disputes <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" /></span>
            )}
          </p>
        </Link>
      </div>

      <section>
        <h2 className="text-xs font-semibold admin-metric-label uppercase tracking-wider mb-3">
          P2P analytics
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AdminChartCard title="P2P activity" subtitle="Orders — 7d">
            <P2PActivityChart />
          </AdminChartCard>
          <AdminChartCard title="Order distribution" subtitle="By type — 24h">
            <TradeDistributionChart />
          </AdminChartCard>
        </div>
      </section>

      {/* Dispute Alert */}
      {(data?.disputeStats?.open_disputes || 0) > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-center gap-4">
          <AlertTriangle className="w-6 h-6 text-red-400" />
          <div>
            <p className="text-gray-900 dark:text-white font-medium">Attention Required</p>
            <p className="text-sm text-red-400">
              {data?.disputeStats?.open_disputes} open disputes need resolution
            </p>
          </div>
          <Link 
            href="/admin/p2p/disputes?status=open" 
            className="ml-auto px-4 py-2 bg-red-600 hover:bg-red-700 text-gray-900 dark:text-white rounded-lg text-sm"
          >
            Review Disputes
          </Link>
        </div>
      )}

      {/* Payment Methods */}
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Payment Methods</h2>
        </div>
        {!data?.paymentMethods || data.paymentMethods.length === 0 ? (
          <div className="p-8 text-center">
            <Repeat className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No payment methods configured</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4">
            {data.paymentMethods.map((method) => (
              <div key={method.id} className="bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900 dark:text-white">{method.name}</span>
                  <span className={`text-xs px-2 py-1 rounded ${method.is_active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {method.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">{method.code} • {method.method_type}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
