'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { Card, Row, Col, Statistic, Button, Tag } from 'antd';
import { AdminChartCard } from '@/components/admin/charts';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Loader2, RefreshCw } from 'lucide-react';

const API_URL = getApiBaseUrl();

export default function SystemReliabilityPage() {
  const { accessToken } = useAdminAuthStore();
  const [data, setData] = useState<{
    sloStatus: string;
    settlementPending: number;
    settlementProcessed1h: number;
    settlementSuccessRate: number;
    circuitOpen: boolean;
    tradingHalted: boolean;
    orderLatencyP99: number | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/operations/system-reliability`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (json?.success && json?.data) setData(json.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const metricsData = data ? [
    { name: 'Settlement Pending', value: data.settlementPending, fill: data.settlementPending > 100 ? '#EF4444' : '#3B82F6' },
    { name: 'Processed (1h)', value: data.settlementProcessed1h, fill: '#10B981' },
    { name: 'Success Rate %', value: data.settlementSuccessRate, fill: '#8B5CF6' },
  ] : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold admin-metric-value">System Reliability Center</h1>
          <p className="text-sm admin-metric-label mt-0.5">API uptime, matching engine, settlement success rate, worker health</p>
        </div>
        <Button type="default" icon={<RefreshCw className="w-4 h-4" />} onClick={fetchData} loading={loading}>Refresh</Button>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 admin-accent-blue animate-spin" /></div>
      ) : (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={6}>
              <Card size="small" className="admin-card">
                <Statistic title="SLO Status" value={data?.sloStatus ?? '—'} valueStyle={{ color: data?.sloStatus === 'ok' ? '#10B981' : data?.sloStatus === 'critical' ? '#EF4444' : '#F59E0B' }} />
              </Card>
            </Col>
            <Col xs={24} sm={6}>
              <Card size="small" className="admin-card">
                <Statistic title="Settlement Pending" value={data?.settlementPending ?? 0} />
              </Card>
            </Col>
            <Col xs={24} sm={6}>
              <Card size="small" className="admin-card">
                <Statistic title="Settlement Success" value={data?.settlementSuccessRate?.toFixed(1) ?? '—'} suffix="%" />
              </Card>
            </Col>
            <Col xs={24} sm={6}>
              <Card size="small" className="admin-card">
                <Statistic title="Order Latency P99" value={data?.orderLatencyP99 != null ? `${data.orderLatencyP99} ms` : '—'} />
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12}>
              <Card size="small" className="admin-card">
                <h3 className="text-sm font-semibold mb-2">Health Indicators</h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span>Circuit Breaker</span>
                    <Tag color={data?.circuitOpen ? 'red' : 'green'}>{data?.circuitOpen ? 'Open' : 'Closed'}</Tag>
                  </div>
                  <div className="flex justify-between">
                    <span>Trading</span>
                    <Tag color={data?.tradingHalted ? 'red' : 'green'}>{data?.tradingHalted ? 'Halted' : 'Live'}</Tag>
                  </div>
                </div>
              </Card>
            </Col>
            <Col xs={24} sm={12}>
              <AdminChartCard title="Settlement Metrics" subtitle="Pending vs processed">
                {metricsData.length === 0 ? (
                  <div className="flex items-center justify-center h-32 text-sm admin-metric-label">No data</div>
                ) : (
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={metricsData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="name" stroke="#9CA3AF" fontSize={10} />
                      <YAxis stroke="#9CA3AF" fontSize={11} />
                      <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </AdminChartCard>
            </Col>
          </Row>

          <Card title="Quick Links" className="admin-card">
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/control-center"><Button size="small">Control Center</Button></Link>
              <Link href="/admin/incidents"><Button size="small">Incidents</Button></Link>
              <Link href="/admin/system-health"><Button size="small">System Health</Button></Link>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
