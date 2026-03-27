'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader, Panel, ActionButton, MetricWidget } from '@/components/admin/control-plane';
import { Card, Row, Col, Table } from 'antd';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts';
import { Loader2, RefreshCw, Database } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface IndexerData {
  chains: Array<{
    chain: string;
    chainId: string;
    current_block_height: number | null;
    last_processed_block: number | null;
    pending_deposits: number;
    confirming_deposits: number;
    sync_status: string;
  }>;
  blockProgress: Array<{ chain: string; block: number }>;
  confirmationsTimeline: Array<{ hour: string; count: number }>;
  pendingPerChain: Array<{ chain: string; pending: number }>;
}

export default function IndexerMonitorPage() {
  const { accessToken } = useAdminAuthStore();
  const [data, setData] = useState<IndexerData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/indexer/status`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (json?.success && json?.data) setData(json.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  const d = data ?? {
    chains: [],
    blockProgress: [],
    confirmationsTimeline: [],
    pendingPerChain: [],
  };

  const totalPending = d.chains.reduce((s, c) => s + c.pending_deposits + c.confirming_deposits, 0);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Deposit Indexer Monitor"
        subtitle="Block processing progress, deposit confirmations, and pending deposits per chain"
        action={
          <ActionButton variant="secondary" onClick={fetchData} loading={loading} icon={<RefreshCw className="w-4 h-4" />}>
            Refresh
          </ActionButton>
        }
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <MetricWidget
            label="Chains tracked"
            value={d.chains.length}
            variant="neutral"
            icon={<Database className="w-5 h-5" />}
          />
        </Col>
        <Col xs={24} sm={8}>
          <MetricWidget
            label="Total pending deposits"
            value={totalPending}
            variant={totalPending > 0 ? 'warning' : 'neutral'}
          />
        </Col>
        <Col xs={24} sm={8}>
          <MetricWidget
            label="Syncing chains"
            value={d.chains.filter(c => c.sync_status === 'syncing').length}
            variant="positive"
          />
        </Col>
      </Row>

      <Panel title="Block processing progress" subtitle="Last processed block by chain">
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={d.blockProgress.length ? d.blockProgress : [{ chain: '—', block: 0 }]}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="chain" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="block" fill="#3b82f6" name="Block height" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Panel title="Deposit confirmations (24h)" subtitle="Completed deposits by hour">
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={d.confirmationsTimeline.length ? d.confirmationsTimeline : [{ hour: '', count: 0 }]}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="hour" tick={{ fontSize: 10 }} tickFormatter={v => v ? new Date(v).toLocaleTimeString([], { hour: '2-digit' }) : ''} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number) => [v, 'Deposits']} labelFormatter={v => v ? new Date(v).toLocaleString() : ''} />
                  <Area type="monotone" dataKey="count" stroke="#10b981" fill="#10b981" fillOpacity={0.3} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </Col>
        <Col xs={24} md={12}>
          <Panel title="Pending deposits per chain" subtitle="Current backlog">
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.pendingPerChain.length ? d.pendingPerChain : [{ chain: '—', pending: 0 }]} layout="vertical" margin={{ left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis dataKey="chain" type="category" width={80} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="pending" fill="#f59e0b" name="Pending" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </Col>
      </Row>

      <Panel title="Indexer status by chain" subtitle="Sync status and block heights">
        <Table
          dataSource={d.chains}
          rowKey="chainId"
          size="small"
          columns={[
            { title: 'Chain', dataIndex: 'chain', key: 'chain' },
            { title: 'Last block', dataIndex: 'last_processed_block', key: 'last_processed_block', render: (v: number | null) => v ?? '—' },
            { title: 'Pending', dataIndex: 'pending_deposits', key: 'pending_deposits' },
            { title: 'Confirming', dataIndex: 'confirming_deposits', key: 'confirming_deposits' },
            {
              title: 'Status',
              dataIndex: 'sync_status',
              key: 'sync_status',
              render: (s: string) => (
                <span className={`px-2 py-0.5 rounded text-xs ${s === 'syncing' ? 'bg-green-500/20 text-green-600' : s === 'pending' ? 'bg-amber-500/20 text-amber-600' : 'bg-gray-500/20 text-gray-600'}`}>
                  {s}
                </span>
              ),
            },
          ]}
          pagination={false}
        />
      </Panel>
    </div>
  );
}
