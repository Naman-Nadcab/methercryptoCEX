'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader, Panel } from '@/components/admin/control-plane';
import { Table, Tag, Input, Select, message } from 'antd';
import { Loader2, RefreshCw } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface ColdReserve {
  chainId: string;
  coldWalletAddress: string | null;
  hotAddress: string;
  balanceCache: string;
  isActive: boolean;
}

interface Movement {
  id: string;
  chain_id: string;
  previous_address: string | null;
  new_address: string | null;
  actor_type: string;
  actor_id: string | null;
  created_at: string;
}

export default function ColdReservesPage() {
  const { accessToken } = useAdminAuthStore();
  const [reserves, setReserves] = useState<ColdReserve[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [chainFilter, setChainFilter] = useState<string>('');

  const fetchReserves = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/wallets/cold/reserves`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (json?.success && Array.isArray(json?.data)) {
        setReserves(json.data);
      }
    } catch {
      setReserves([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  const fetchMovements = useCallback(async () => {
    if (!accessToken) return;
    setMovementsLoading(true);
    try {
      const url = new URL(`${API_URL}/api/v1/admin/wallets/cold/movements`);
      url.searchParams.set('limit', '50');
      if (chainFilter) url.searchParams.set('chainId', chainFilter);
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (json?.success && Array.isArray(json?.data)) {
        setMovements(json.data);
      }
    } catch {
      setMovements([]);
    } finally {
      setMovementsLoading(false);
    }
  }, [accessToken, chainFilter]);

  useEffect(() => {
    fetchReserves();
  }, [fetchReserves]);

  useEffect(() => {
    fetchMovements();
  }, [fetchMovements]);

  const chainIds = Array.from(new Set(reserves.map((r) => r.chainId)));

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Cold Wallet Reserves & Movement Log"
        subtitle="View cold wallet addresses per chain and audit trail of address changes."
      />
      <Panel>
        <div className="flex justify-between items-center mb-4">
          <button
            type="button"
            onClick={() => { fetchReserves(); fetchMovements(); }}
            className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#1a1f2e] hover:bg-[#252b3b] text-sm"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
        <h3 className="text-sm font-medium text-gray-300 mb-2">Reserves by chain</h3>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : (
          <Table
            dataSource={reserves}
            rowKey="chainId"
            size="small"
            pagination={false}
            columns={[
              { title: 'Chain', dataIndex: 'chainId', key: 'chainId', width: 120 },
              { title: 'Cold address', dataIndex: 'coldWalletAddress', key: 'coldWalletAddress', render: (v: string | null) => v || '—' },
              { title: 'Hot address', dataIndex: 'hotAddress', key: 'hotAddress', ellipsis: true },
              { title: 'Balance cache', dataIndex: 'balanceCache', key: 'balanceCache', width: 100 },
              { title: 'Active', dataIndex: 'isActive', key: 'isActive', width: 80, render: (v: boolean) => (v ? <Tag color="green">Yes</Tag> : <Tag color="default">No</Tag>) },
            ]}
          />
        )}
      </Panel>
      <Panel>
        <h3 className="text-sm font-medium text-gray-300 mb-2">Cold wallet movement history</h3>
        <div className="mb-3 flex gap-2">
          <Select
            placeholder="Filter by chain"
            allowClear
            value={chainFilter || undefined}
            onChange={(v) => setChainFilter(v ?? '')}
            className="w-40"
            options={[{ value: '', label: 'All chains' }, ...chainIds.map((c) => ({ value: c, label: c }))]}
          />
        </div>
        {movementsLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : (
          <Table
            dataSource={movements}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 20 }}
            columns={[
              { title: 'Chain', dataIndex: 'chain_id', key: 'chain_id', width: 100 },
              { title: 'Previous address', dataIndex: 'previous_address', key: 'previous_address', ellipsis: true, render: (v: string | null) => v || '—' },
              { title: 'New address', dataIndex: 'new_address', key: 'new_address', ellipsis: true, render: (v: string | null) => v || '—' },
              { title: 'Actor', dataIndex: 'actor_type', key: 'actor_type', width: 80 },
              { title: 'Actor ID', dataIndex: 'actor_id', key: 'actor_id', width: 120, ellipsis: true },
              { title: 'Time', dataIndex: 'created_at', key: 'created_at', width: 180 },
            ]}
          />
        )}
      </Panel>
    </div>
  );
}
