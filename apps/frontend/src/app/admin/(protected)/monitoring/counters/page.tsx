'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader, Panel, ActionButton } from '@/components/admin/control-plane';
import { Loader2, RefreshCw } from 'lucide-react';

const API_URL = getApiBaseUrl();

export default function MonitoringCountersPage() {
  const { accessToken } = useAdminAuthStore();
  const [counters, setCounters] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const fetchCounters = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/monitoring/counters`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (data?.success && data?.data?.counters) {
        setCounters(data.data.counters);
      } else {
        setCounters({});
      }
    } catch {
      setCounters({});
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchCounters();
  }, [fetchCounters]);

  const entries = Object.entries(counters).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Monitoring Counters"
        subtitle="Redis-backed monitoring signals (invariant, escrow, settlement, abuse, risk)"
        action={
          <ActionButton variant="secondary" onClick={() => fetchCounters()} loading={loading} icon={<RefreshCw className="w-4 h-4" />}>
            Refresh
          </ActionButton>
        }
      />
      <Panel title="Counters" subtitle="Non-zero or all keys. Empty if Redis unavailable.">
        {loading && Object.keys(counters).length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-4">No counters (Redis may be unavailable or no activity yet).</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-300">Key</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-700 dark:text-gray-300">Value</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(([key, value]) => (
                  <tr key={key} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2 px-3 font-mono text-xs text-gray-900 dark:text-white">{key}</td>
                    <td className="py-2 px-3 text-right font-mono text-gray-700 dark:text-gray-300">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
