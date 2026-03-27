'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader, Panel } from '@/components/admin/control-plane';
import { Table, Tag } from 'antd';
import { Loader2, RefreshCw, AlertTriangle } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface HistoryEntry {
  id: number;
  event_type: string;
  reason: string | null;
  actor_type: string;
  actor_id: string | null;
  created_at: string;
}

export default function CircuitBreakerHistoryPage() {
  const { accessToken } = useAdminAuthStore();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [circuitOpen, setCircuitOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/compliance/circuit-breaker/history?limit=100`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (json?.success && json?.data) {
        setHistory(json.data.history ?? []);
        setCircuitOpen(json.data.circuitOpen === true);
      }
    } catch {
      setHistory([]);
      setCircuitOpen(false);
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
        title="Circuit Breaker History"
        subtitle="Settlement circuit open/reset events. Use Control Center to reset the circuit after investigation."
      />
      {circuitOpen && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>Settlement circuit is currently <strong>OPEN</strong>. No settlements until reset from Control Center.</span>
        </div>
      )}
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
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : (
          <Table
            dataSource={history}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 25 }}
            columns={[
              { title: 'Event', dataIndex: 'event_type', key: 'event_type', width: 100, render: (v: string) => (v === 'open' ? <Tag color="red">OPEN</Tag> : <Tag color="green">RESET</Tag>) },
              { title: 'Reason', dataIndex: 'reason', key: 'reason', ellipsis: true },
              { title: 'Actor', dataIndex: 'actor_type', key: 'actor_type', width: 90 },
              { title: 'Actor ID', dataIndex: 'actor_id', key: 'actor_id', width: 120, ellipsis: true },
              { title: 'Time', dataIndex: 'created_at', key: 'created_at', width: 200 },
            ]}
          />
        )}
      </Panel>
    </div>
  );
}
