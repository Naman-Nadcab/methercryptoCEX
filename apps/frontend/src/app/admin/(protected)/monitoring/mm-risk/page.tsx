'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader, Panel, ActionButton } from '@/components/admin/control-plane';
import { Loader2, RefreshCw, Key, TrendingUp, Users } from 'lucide-react';
import Link from 'next/link';

const API_URL = getApiBaseUrl();

interface MmRiskData {
  apiKeysCount: number;
  topTraders: { userId: string; volume24h: string }[];
  usersWithKeys: { userId: string; keysCount: number }[];
}

export default function MmRiskPage() {
  const { accessToken } = useAdminAuthStore();
  const [data, setData] = useState<MmRiskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/monitoring/mm-risk`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? 'Failed to fetch');
        return;
      }
      if (json?.success && json?.data) {
        setData(json.data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const formatVolume = (v: string) => {
    const n = parseFloat(v);
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
    return n.toFixed(2);
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        title="MM Risk Monitoring"
        subtitle="Market Making: API keys, top traders by 24h volume, users with API keys"
        action={
          <ActionButton variant="secondary" onClick={fetchData} loading={loading} icon={<RefreshCw className="w-4 h-4" />}>
            Refresh
          </ActionButton>
        }
      />
      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
      {loading && !data ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
        </div>
      ) : data ? (
        <>
          <Panel title="Summary" subtitle="API keys and activity overview">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <Key className="w-8 h-8 text-blue-500" />
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Active API Keys</p>
                  <p className="text-xl font-semibold text-gray-900 dark:text-white">{data.apiKeysCount}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <Users className="w-8 h-8 text-green-500" />
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Users with API Keys</p>
                  <p className="text-xl font-semibold text-gray-900 dark:text-white">{data.usersWithKeys.length}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <TrendingUp className="w-8 h-8 text-amber-500" />
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Top Traders (24h)</p>
                  <p className="text-xl font-semibold text-gray-900 dark:text-white">{data.topTraders.length}</p>
                </div>
              </div>
            </div>
          </Panel>
          <Panel title="Top Traders (24h Volume)" subtitle="By quote volume in last 24 hours">
            {data.topTraders.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 py-4">No trades in last 24 hours.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-300">#</th>
                      <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-300">User ID</th>
                      <th className="text-right py-2 px-3 font-medium text-gray-700 dark:text-gray-300">Volume (24h)</th>
                      <th className="text-right py-2 px-3 font-medium text-gray-700 dark:text-gray-300">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topTraders.map((t, i) => (
                      <tr key={t.userId} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-2 px-3 text-gray-500">{i + 1}</td>
                        <td className="py-2 px-3 font-mono text-xs text-gray-900 dark:text-white">{t.userId}</td>
                        <td className="py-2 px-3 text-right font-mono text-gray-700 dark:text-gray-300">{formatVolume(t.volume24h)}</td>
                        <td className="py-2 px-3 text-right">
                          <Link href={`/admin/users/${t.userId}`} className="text-blue-600 dark:text-blue-400 hover:underline text-xs">
                            View user
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <Panel title="Users with API Keys" subtitle="Users who have created API keys (potential MM bots)">
            {data.usersWithKeys.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 py-4">No users with API keys.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-300">User ID</th>
                      <th className="text-right py-2 px-3 font-medium text-gray-700 dark:text-gray-300">Keys</th>
                      <th className="text-right py-2 px-3 font-medium text-gray-700 dark:text-gray-300">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.usersWithKeys.map((u) => (
                      <tr key={u.userId} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-2 px-3 font-mono text-xs text-gray-900 dark:text-white">{u.userId}</td>
                        <td className="py-2 px-3 text-right text-gray-700 dark:text-gray-300">{u.keysCount}</td>
                        <td className="py-2 px-3 text-right">
                          <Link href={`/admin/users/${u.userId}`} className="text-blue-600 dark:text-blue-400 hover:underline text-xs">
                            View user
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      ) : null}
    </div>
  );
}
