'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { Card, Row, Col, Statistic, Button, Table } from 'antd';
import { AdminChartCard } from '@/components/admin/charts';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Loader2, RefreshCw } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface ApiMetricsData {
  requestLatency: { name: string; value: number; labels?: Record<string, string> }[];
  spotOrdersTotal: number;
  spotTradesTotal: number;
  metrics: { name: string; value: number; labels?: Record<string, string> }[];
}

export default function ApiMonitoringPage() {
  const { accessToken } = useAdminAuthStore();
  const [data, setData] = useState<ApiMetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(
    async (isRefresh = false) => {
      if (!accessToken) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/v1/admin/analytics/api-metrics`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const json = await res.json();
        if (json?.success && json?.data) setData(json.data);
      } catch (e) {
        console.error('API metrics fetch error', e);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [accessToken]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const latencyChartData = (data?.requestLatency ?? []).slice(0, 10).map((m) => ({
    name: m.labels?.route ?? m.name,
    value: Math.round(m.value * 1000),
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold admin-metric-value">API Monitoring</h1>
          <p className="text-sm admin-metric-label mt-0.5">
            Request volume, error rate, endpoint usage, latency
          </p>
        </div>
        <Button type="default" icon={<RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />} onClick={() => fetchData(true)} loading={refreshing}>
          Refresh
        </Button>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 admin-accent-blue animate-spin" />
        </div>
      ) : (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={8}>
              <Card size="small" className="admin-card">
                <Statistic title="Spot Orders (counter)" value={data?.spotOrdersTotal ?? 0} />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card size="small" className="admin-card">
                <Statistic title="Spot Trades (counter)" value={data?.spotTradesTotal ?? 0} />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card size="small" className="admin-card">
                <Statistic title="Latency Samples" value={(data?.requestLatency ?? []).length} />
              </Card>
            </Col>
          </Row>

          <AdminChartCard title="Request Latency (ms)" subtitle="From Prometheus histogram">
            {latencyChartData.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-sm admin-metric-label">No latency data (Prometheus metrics)</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={latencyChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="name" stroke="#9CA3AF" fontSize={11} angle={-30} textAnchor="end" height={60} />
                  <YAxis stroke="#9CA3AF" fontSize={11} />
                  <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                  <Bar dataKey="value" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </AdminChartCard>

          <Card title="Key Metrics" className="admin-card">
            {data?.metrics && data.metrics.length > 0 ? (
              <Table
                size="small"
                dataSource={data.metrics.slice(0, 20)}
                rowKey={(_, i) => String(i)}
                pagination={false}
                columns={[
                  { title: 'Metric', dataIndex: 'name', key: 'name' },
                  { title: 'Value', dataIndex: 'value', key: 'value', render: (v: number) => v?.toFixed(4) ?? '—' },
                  {
                    title: 'Labels',
                    dataIndex: 'labels',
                    key: 'labels',
                    render: (l: Record<string, string>) => (l && Object.keys(l).length > 0 ? JSON.stringify(l) : '—'),
                  },
                ]}
              />
            ) : (
              <p className="text-sm admin-metric-label py-4">No metrics available. Ensure Prometheus metrics are exposed.</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
