'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader, Panel } from '@/components/admin/control-plane';
import { Loader2, RefreshCw, Cpu } from 'lucide-react';

const API_URL = getApiBaseUrl();

export default function EngineRecoveryStatusPage() {
  const { accessToken } = useAdminAuthStore();
  const [data, setData] = useState<{ openOrdersCount: number; lastEngineEventId: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/engine/recovery-status`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (json?.success && json?.data) {
        setData(json.data);
      }
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Engine Recovery Status"
        subtitle="Open orders count and last engine event ID used for matching engine restart recovery (GET /internal/engine/state)."
      />
      <Panel>
        <div className="flex justify-between items-center mb-4">
          <button
            type="button"
            onClick={fetchData}
            className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#1a1f2e] hover:bg-[#252b3b] text-sm"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
        {loading && !data ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : data ? (
          <div className="flex gap-8 items-center">
            <div className="flex items-center gap-3 p-4 rounded-lg bg-[#1a1f2e]">
              <Cpu className="w-8 h-8 text-blue-400" />
              <div>
                <p className="text-sm text-gray-400">Open orders (in DB)</p>
                <p className="text-xl font-mono">{data.openOrdersCount}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 rounded-lg bg-[#1a1f2e]">
              <span className="text-sm text-gray-400">Last engine event ID</span>
              <span className="text-xl font-mono">{data.lastEngineEventId}</span>
            </div>
          </div>
        ) : (
          <p className="text-gray-400">Unable to load recovery status.</p>
        )}
      </Panel>
    </div>
  );
}
