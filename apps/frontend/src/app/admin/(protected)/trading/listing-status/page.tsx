'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader, Panel } from '@/components/admin/control-plane';
import { Table, Select, Button, message, Modal } from 'antd';
import { Loader2, RefreshCw } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface MarketStatus {
  id: string;
  symbol: string;
  status: string;
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'delisted', label: 'Delisted' },
];

export default function ListingStatusPage() {
  const { accessToken } = useAdminAuthStore();
  const [list, setList] = useState<MarketStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/trading/listing-status`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (json?.success && Array.isArray(json?.data)) {
        setList(json.data);
      }
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const changeStatus = async (symbol: string, status: string) => {
    if (!accessToken) return;
    setUpdating(symbol);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/trading/listing-status/${encodeURIComponent(symbol)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (json?.success) {
        message.success(`${symbol} set to ${status}`);
        fetchData();
      } else {
        message.error(json?.error?.message ?? 'Update failed');
      }
    } catch {
      message.error('Request failed');
    } finally {
      setUpdating(null);
    }
  };

  const handleStatusChange = (symbol: string, newStatus: string) => {
    Modal.confirm({
      title: 'Change market status',
      content: `Set ${symbol} to ${newStatus}? This affects trading availability.`,
      okText: 'Confirm',
      cancelText: 'Cancel',
      onOk: () => changeStatus(symbol, newStatus),
    });
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Listing / Delisting"
        subtitle="Set spot market status: active, suspended, maintenance, or delisted."
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
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : (
          <Table
            dataSource={list}
            rowKey="id"
            size="small"
            pagination={false}
            columns={[
              { title: 'Symbol', dataIndex: 'symbol', key: 'symbol', width: 140 },
              { title: 'Status', dataIndex: 'status', key: 'status', width: 120 },
              {
                title: 'Action',
                key: 'action',
                width: 200,
                render: (_: unknown, row: MarketStatus) => (
                  <Select
                    value={row.status}
                    options={STATUS_OPTIONS}
                    onChange={(v) => handleStatusChange(row.symbol, v)}
                    loading={updating === row.symbol}
                    className="w-full"
                  />
                ),
              },
            ]}
          />
        )}
      </Panel>
    </div>
  );
}
