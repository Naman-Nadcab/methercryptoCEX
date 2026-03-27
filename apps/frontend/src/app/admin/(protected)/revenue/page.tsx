'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { Card, Row, Col, Statistic, Select, Button } from 'antd';
import { AdminChartCard } from '@/components/admin/charts';
import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from 'recharts';
import { Loader2, RefreshCw } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface RevenueData {
  tradingFees: number;
  withdrawalFees: number;
  p2pCommission: number;
  referralPayouts: number;
  total: number;
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444'];

export default function RevenueIntelligencePage() {
  const { accessToken } = useAdminAuthStore();
  const [period, setPeriod] = useState('7d');
  const [data, setData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(
    async (isRefresh = false) => {
      if (!accessToken) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const res = await fetch(
          `${API_URL}/api/v1/admin/analytics/revenue-breakdown?period=${encodeURIComponent(period)}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const json = await res.json();
        if (json?.success && json?.data) setData(json.data);
      } catch (e) {
        console.error('Revenue fetch error', e);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [accessToken, period]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const pieData = data
    ? [
        { name: 'Trading Fees', value: data.tradingFees },
        { name: 'Withdrawal Fees', value: data.withdrawalFees },
        { name: 'P2P Commission', value: data.p2pCommission },
        { name: 'Referral Payouts (cost)', value: data.referralPayouts },
      ].filter((d) => d.value > 0)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold admin-metric-value">Revenue Intelligence</h1>
          <p className="text-sm admin-metric-label mt-0.5">
            Trading fees, withdrawal fees, P2P commissions, referral payouts
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onChange={setPeriod} options={[{ label: '24h', value: '24h' }, { label: '7d', value: '7d' }, { label: '30d', value: '30d' }]} style={{ width: 100 }} />
          <Button type="default" icon={<RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />} onClick={() => fetchData(true)} loading={refreshing}>
            Refresh
          </Button>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 admin-accent-blue animate-spin" />
        </div>
      ) : (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={6}>
              <Card size="small" className="admin-card">
                <Statistic title="Trading Fees" value={data?.tradingFees?.toFixed(2) ?? '0'} prefix="$" />
              </Card>
            </Col>
            <Col xs={24} sm={6}>
              <Card size="small" className="admin-card">
                <Statistic title="Withdrawal Fees" value={data?.withdrawalFees?.toFixed(2) ?? '0'} prefix="$" />
              </Card>
            </Col>
            <Col xs={24} sm={6}>
              <Card size="small" className="admin-card">
                <Statistic title="P2P Commission" value={data?.p2pCommission?.toFixed(2) ?? '0'} prefix="$" />
              </Card>
            </Col>
            <Col xs={24} sm={6}>
              <Card size="small" className="admin-card">
                <Statistic title="Net Revenue" value={data?.total?.toFixed(2) ?? '0'} prefix="$" valueStyle={{ color: (data?.total ?? 0) >= 0 ? '#10B981' : '#EF4444' }} />
              </Card>
            </Col>
          </Row>

          <AdminChartCard title="Revenue Breakdown" subtitle={`Last ${period} — Referral payouts shown as outflow`}>
            {pieData.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-sm admin-metric-label">No revenue data</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" outerRadius={90} dataKey="value" nameKey="name" label={({ name, value }) => `${name}: $${Math.abs(value).toFixed(2)}`}>
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, '']} contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </AdminChartCard>
        </>
      )}
    </div>
  );
}
