'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { Card, Table, Row, Col, Select, Button } from 'antd';
import { AdminChartCard } from '@/components/admin/charts';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Loader2, RefreshCw } from 'lucide-react';

const API_URL = getApiBaseUrl();

export default function UserBehaviorPage() {
  const { accessToken } = useAdminAuthStore();
  const [period, setPeriod] = useState('24h');
  const [data, setData] = useState<{
    tradeFrequencyAnomalies: Array<{ userId: string; trades: number; tradesPerHour: number }>;
    profitDistribution: Array<{ userId: string; pnl: number; fees: number }>;
    activityHeatmap: Array<{ hour: number; count: number }>;
    botPatterns: Array<{ userId: string; trades: number }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/operations/user-behavior?period=${period}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (json?.success && json?.data) setData(json.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [accessToken, period]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const heatmapData = (data?.activityHeatmap ?? []).map((h) => ({ name: `${h.hour}:00`, count: h.count }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold admin-metric-value">User Behavior Intelligence</h1>
          <p className="text-sm admin-metric-label mt-0.5">Trade frequency anomalies, profit distribution, activity heatmaps, bot patterns</p>
        </div>
        <div className="flex gap-2">
          <Select value={period} onChange={setPeriod} options={[{ label: '24h', value: '24h' }, { label: '7d', value: '7d' }, { label: '30d', value: '30d' }]} style={{ width: 90 }} />
          <Button type="default" icon={<RefreshCw className="w-4 h-4" />} onClick={fetchData} loading={loading}>Refresh</Button>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 admin-accent-blue animate-spin" /></div>
      ) : (
        <>
          <AdminChartCard title="Activity by Hour" subtitle="Trade count per hour (heatmap style)">
            {heatmapData.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-sm admin-metric-label">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={heatmapData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="name" stroke="#9CA3AF" fontSize={10} />
                  <YAxis stroke="#9CA3AF" fontSize={11} />
                  <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                  <Bar dataKey="count" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </AdminChartCard>

          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <Card title="Trade Frequency Anomalies" size="small" className="admin-card">
                {(data?.tradeFrequencyAnomalies ?? []).length === 0 ? (
                  <p className="text-sm admin-metric-label py-4">No anomalies.</p>
                ) : (
                  <Table size="small" dataSource={data?.tradeFrequencyAnomalies ?? []} rowKey="userId" pagination={{ pageSize: 5 }}
                    columns={[
                      { title: 'User', dataIndex: 'userId', key: 'userId', render: (v: string) => <Link href={`/admin/users/${v}`} className="font-mono text-xs admin-accent-blue">{v.slice(0, 8)}…</Link> },
                      { title: 'Trades', dataIndex: 'trades', key: 'trades' },
                      { title: 'Trades/Hour', dataIndex: 'tradesPerHour', key: 'tradesPerHour', render: (v: number) => v?.toFixed(2) ?? '—' },
                    ]}
                  />
                )}
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card title="Profit Distribution" size="small" className="admin-card">
                {(data?.profitDistribution ?? []).length === 0 ? (
                  <p className="text-sm admin-metric-label py-4">No data.</p>
                ) : (
                  <Table size="small" dataSource={data?.profitDistribution ?? []} rowKey="userId" pagination={{ pageSize: 5 }}
                    columns={[
                      { title: 'User', dataIndex: 'userId', key: 'userId', render: (v: string) => <Link href={`/admin/users/${v}`} className="font-mono text-xs admin-accent-blue">{v.slice(0, 8)}…</Link> },
                      { title: 'PnL', dataIndex: 'pnl', key: 'pnl', render: (v: number) => <span className={v >= 0 ? 'text-green-400' : 'text-red-400'}>{v?.toFixed(2) ?? '0'}</span> },
                      { title: 'Fees', dataIndex: 'fees', key: 'fees', render: (v: number) => v?.toFixed(2) ?? '0' },
                    ]}
                  />
                )}
              </Card>
            </Col>
          </Row>

          <Card title="High-Frequency Traders (Possible Bots)" size="small" className="admin-card">
            {(data?.botPatterns ?? []).length === 0 ? (
              <p className="text-sm admin-metric-label py-4">No high-frequency traders.</p>
            ) : (
              <Table size="small" dataSource={data?.botPatterns ?? []} rowKey="userId" pagination={{ pageSize: 10 }}
                columns={[
                  { title: 'User', dataIndex: 'userId', key: 'userId', render: (v: string) => <Link href={`/admin/users/${v}`} className="font-mono text-xs admin-accent-blue">{v.slice(0, 8)}…</Link> },
                  { title: 'Trades', dataIndex: 'trades', key: 'trades' },
                ]}
              />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
