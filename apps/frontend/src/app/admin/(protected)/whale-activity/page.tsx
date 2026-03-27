'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { Card, Table, Row, Col, Statistic, Select, InputNumber, Button } from 'antd';
import { AdminChartCard } from '@/components/admin/charts';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Loader2, RefreshCw } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface LargeTrade {
  id: string;
  userId: string;
  market: string;
  side: string;
  notional: number;
  createdAt: string;
}

interface LargeOrder {
  id: string;
  userId: string;
  market: string;
  side: string;
  notional: number;
  status: string;
  createdAt: string;
}

export default function WhaleActivityPage() {
  const { accessToken } = useAdminAuthStore();
  const [period, setPeriod] = useState('24h');
  const [threshold, setThreshold] = useState(10000);
  const [largeTrades, setLargeTrades] = useState<LargeTrade[]>([]);
  const [largeOrders, setLargeOrders] = useState<LargeOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/api/v1/admin/operations/whale-activity?period=${period}&threshold_usd=${threshold}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const json = await res.json();
      if (json?.success && json?.data) {
        setLargeTrades(json.data.largeTrades ?? []);
        setLargeOrders(json.data.largeOrders ?? []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [accessToken, period, threshold]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const tradesByMarket = largeTrades.reduce<Record<string, number>>((acc, t) => {
    acc[t.market] = (acc[t.market] ?? 0) + 1;
    return acc;
  }, {});
  const chartData = Object.entries(tradesByMarket).map(([name, count]) => ({ name, count }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold admin-metric-value">Whale Activity Monitor</h1>
          <p className="text-sm admin-metric-label mt-0.5">Large trades and orders detection</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <InputNumber min={1000} step={5000} value={threshold} onChange={(v) => setThreshold(v ?? 10000)} addonBefore="$" style={{ width: 140 }} />
          <Select value={period} onChange={setPeriod} options={[{ label: '24h', value: '24h' }, { label: '7d', value: '7d' }, { label: '30d', value: '30d' }]} style={{ width: 80 }} />
          <Button type="default" icon={<RefreshCw className="w-4 h-4" />} onClick={fetchData} loading={loading}>Refresh</Button>
        </div>
      </div>

      {loading && largeTrades.length === 0 && largeOrders.length === 0 ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 admin-accent-blue animate-spin" /></div>
      ) : (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={8}>
              <Card size="small" className="admin-card">
                <Statistic title="Large Trades (≥$)" value={largeTrades.length} suffix={threshold.toLocaleString()} />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card size="small" className="admin-card">
                <Statistic title="Large Open Orders" value={largeOrders.length} />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card size="small" className="admin-card">
                <Statistic title="Total Whale Volume" value={(largeTrades.reduce((s, t) => s + t.notional, 0) / 1e6).toFixed(2)} suffix="M" />
              </Card>
            </Col>
          </Row>

          <AdminChartCard title="Large Trades by Market" subtitle={`Threshold: $${threshold.toLocaleString()}`}>
            {chartData.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-sm admin-metric-label">No large trades</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="name" stroke="#9CA3AF" fontSize={11} />
                  <YAxis stroke="#9CA3AF" fontSize={11} />
                  <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                  <Bar dataKey="count" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </AdminChartCard>

          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <Card title="Large Trades" className="admin-card">
                {largeTrades.length === 0 ? (
                  <p className="text-sm admin-metric-label py-4">No large trades in period.</p>
                ) : (
                  <Table size="small" dataSource={largeTrades} rowKey="id" pagination={{ pageSize: 10 }}
                    columns={[
                      { title: 'User', dataIndex: 'userId', key: 'userId', render: (v: string) => <Link href={`/admin/users/${v}`} className="font-mono text-xs admin-accent-blue">{v.slice(0, 8)}…</Link> },
                      { title: 'Market', dataIndex: 'market', key: 'market' },
                      { title: 'Side', dataIndex: 'side', key: 'side' },
                      { title: 'Notional', key: 'notional', render: (_: unknown, r: LargeTrade) => `$${r.notional?.toLocaleString() ?? '0'}` },
                      { title: 'Time', dataIndex: 'createdAt', key: 'createdAt', render: (v: string) => v ? new Date(v).toLocaleString() : '—' },
                    ]}
                  />
                )}
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card title="Large Open Orders" className="admin-card">
                {largeOrders.length === 0 ? (
                  <p className="text-sm admin-metric-label py-4">No large open orders.</p>
                ) : (
                  <Table size="small" dataSource={largeOrders} rowKey="id" pagination={{ pageSize: 10 }}
                    columns={[
                      { title: 'User', dataIndex: 'userId', key: 'userId', render: (v: string) => <Link href={`/admin/users/${v}`} className="font-mono text-xs admin-accent-blue">{v.slice(0, 8)}…</Link> },
                      { title: 'Market', dataIndex: 'market', key: 'market' },
                      { title: 'Side', dataIndex: 'side', key: 'side' },
                      { title: 'Notional', key: 'notional', render: (_: unknown, r: LargeOrder) => `$${r.notional?.toLocaleString() ?? '0'}` },
                      { title: 'Status', dataIndex: 'status', key: 'status' },
                    ]}
                  />
                )}
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  );
}
