'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { Card, Table, Row, Col, Statistic, Select, Button } from 'antd';
import { AdminChartCard } from '@/components/admin/charts';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Loader2, RefreshCw } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface Trader {
  userId: string;
  tradeCount: number;
  volume: number;
  totalFees: number;
}

export default function TraderIntelligencePage() {
  const { accessToken } = useAdminAuthStore();
  const [period, setPeriod] = useState('7d');
  const [topTraders, setTopTraders] = useState<Trader[]>([]);
  const [highRisk, setHighRisk] = useState<Array<{ userId: string; alertCount: number }>>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/api/v1/admin/operations/trader-intelligence?period=${period}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const json = await res.json();
      if (json?.success && json?.data) {
        setTopTraders(json.data.topTraders ?? []);
        setHighRisk(json.data.highRiskTraders ?? []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [accessToken, period]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const volumeChartData = topTraders.slice(0, 10).map((t) => ({ name: t.userId.slice(0, 8) + '…', volume: t.volume }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold admin-metric-value">Trader Intelligence</h1>
          <p className="text-sm admin-metric-label mt-0.5">Top traders, volume, profit distribution, high risk traders</p>
        </div>
        <div className="flex gap-2">
          <Select value={period} onChange={setPeriod} options={[{ label: '24h', value: '24h' }, { label: '7d', value: '7d' }, { label: '30d', value: '30d' }]} style={{ width: 90 }} />
          <Button type="default" icon={<RefreshCw className="w-4 h-4" />} onClick={fetchData} loading={loading}>Refresh</Button>
        </div>
      </div>

      {loading && topTraders.length === 0 ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 admin-accent-blue animate-spin" /></div>
      ) : (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={8}>
              <Card size="small" className="admin-card">
                <Statistic title="Top Traders" value={topTraders.length} />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card size="small" className="admin-card">
                <Statistic title="Total Volume (24h)" value={(topTraders.reduce((s, t) => s + t.volume, 0) / 1e6).toFixed(2)} suffix="M" />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card size="small" className="admin-card">
                <Statistic title="High Risk Traders" value={highRisk.length} valueStyle={{ color: highRisk.length > 0 ? '#EF4444' : undefined }} />
              </Card>
            </Col>
          </Row>

          <AdminChartCard title="Top Traders by Volume" subtitle={`Last ${period}`}>
            {volumeChartData.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-sm admin-metric-label">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={volumeChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="name" stroke="#9CA3AF" fontSize={11} />
                  <YAxis stroke="#9CA3AF" fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                  <Bar dataKey="volume" fill="#10B981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </AdminChartCard>

          <Row gutter={[16, 16]}>
            <Col xs={24} lg={14}>
              <Card title="Top Traders" className="admin-card">
                <Table size="small" dataSource={topTraders} rowKey="userId" pagination={{ pageSize: 10 }}
                  columns={[
                    { title: 'User', dataIndex: 'userId', key: 'userId', render: (v: string) => <Link href={`/admin/users/${v}`} className="font-mono text-xs admin-accent-blue">{v.slice(0, 8)}…</Link> },
                    { title: 'Trades', dataIndex: 'tradeCount', key: 'tradeCount' },
                    { title: 'Volume (USD)', key: 'volume', render: (_: unknown, r: Trader) => r.volume?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '—' },
                    { title: 'Fees', key: 'totalFees', render: (_: unknown, r: Trader) => r.totalFees?.toFixed(2) ?? '—' },
                  ]}
                />
              </Card>
            </Col>
            <Col xs={24} lg={10}>
              <Card title="High Risk Traders (AML)" className="admin-card">
                {highRisk.length === 0 ? (
                  <p className="text-sm admin-metric-label py-4">No high risk traders.</p>
                ) : (
                  <Table size="small" dataSource={highRisk} rowKey="userId" pagination={false}
                    columns={[
                      { title: 'User', dataIndex: 'userId', key: 'userId', render: (v: string) => <Link href={`/admin/users/${v}`} className="font-mono text-xs admin-accent-blue">{v.slice(0, 8)}…</Link> },
                      { title: 'Alerts', dataIndex: 'alertCount', key: 'alertCount', render: (v: number) => <span className="text-red-400">{v}</span> },
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
