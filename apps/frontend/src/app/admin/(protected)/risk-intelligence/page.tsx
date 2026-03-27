'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { Card, Table, Tag, Row, Col, Statistic, Button } from 'antd';
import { AdminChartCard } from '@/components/admin/charts';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { Loader2, RefreshCw, AlertTriangle } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface WashSignal {
  userId: string;
  market: string;
  buyVolume: string;
  sellVolume: string;
  buyCount: number;
  sellCount: number;
}

interface SpoofSignal {
  userId: string;
  market: string;
  totalOrders: number;
  cancelledOrders: number;
  cancelRate: number;
}

interface PumpSignal {
  market: string;
  priceChangePct: number;
  volumeSpike: number;
}

export default function RiskIntelligencePage() {
  const { accessToken } = useAdminAuthStore();
  const [wash, setWash] = useState<WashSignal[]>([]);
  const [spoof, setSpoof] = useState<SpoofSignal[]>([]);
  const [pump, setPump] = useState<PumpSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (!accessToken) return;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/analytics/risk-intelligence`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (data?.success && data?.data) {
        setWash(data.data.washTrading ?? []);
        setSpoof(data.data.spoofing ?? []);
        setPump(data.data.priceSpikes ?? []);
      }
    } catch (e) {
      console.error('Risk intelligence fetch error', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const washChartData = wash.slice(0, 8).map((w) => ({ name: `${w.market}`, value: w.buyCount + w.sellCount }));
  const spoofChartData = spoof.slice(0, 8).map((s) => ({ name: `${s.market}`, value: Math.round(s.cancelRate * 100) }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold admin-metric-value">Risk Intelligence Dashboard</h1>
          <p className="text-sm admin-metric-label mt-0.5">
            Wash trading, spoofing, abnormal price spikes — market manipulation monitoring
          </p>
        </div>
        <Button
          type="default"
          icon={<RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />}
          onClick={() => fetchData(true)}
          loading={refreshing}
        >
          Refresh
        </Button>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <Card size="small" className="admin-card">
            <Statistic title="Wash Trade Signals" value={wash.length} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" className="admin-card">
            <Statistic title="Spoofing Signals" value={spoof.length} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" className="admin-card">
            <Statistic title="Price Spike Signals" value={pump.length} />
          </Card>
        </Col>
      </Row>

      {loading && wash.length === 0 && spoof.length === 0 && pump.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 admin-accent-blue animate-spin" />
        </div>
      ) : (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <AdminChartCard title="Wash Trading (5m window)" subtitle="Same user buy+sell same pair">
                {washChartData.length === 0 ? (
                  <div className="flex items-center justify-center h-48 text-sm admin-metric-label">No signals</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={washChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="name" stroke="#9CA3AF" fontSize={11} />
                      <YAxis stroke="#9CA3AF" fontSize={11} />
                      <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                      <Bar dataKey="value" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </AdminChartCard>
            </Col>
            <Col xs={24} lg={12}>
              <AdminChartCard title="Spoofing (Cancel Rate %)" subtitle="High cancel rate per user/market">
                {spoofChartData.length === 0 ? (
                  <div className="flex items-center justify-center h-48 text-sm admin-metric-label">No signals</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={spoofChartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="value"
                        nameKey="name"
                        label={({ name, value }) => `${name} ${value}%`}
                      >
                        {spoofChartData.map((_, i) => (
                          <Cell key={i} fill={['#EF4444', '#F59E0B', '#10B981', '#3B82F6'][i % 4]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </AdminChartCard>
            </Col>
          </Row>

          <Card title="Wash Trading Signals" className="admin-card">
            {wash.length === 0 ? (
              <p className="text-sm admin-metric-label py-4">No wash trade signals in last 5 minutes.</p>
            ) : (
              <Table
                dataSource={wash}
                rowKey={(r) => `${r.userId}-${r.market}`}
                size="small"
                pagination={false}
                columns={[
                  { title: 'User', dataIndex: 'userId', key: 'userId', render: (v: string) => <Link href={`/admin/users/${v}`} className="font-mono text-xs">{v.slice(0, 8)}…</Link> },
                  { title: 'Market', dataIndex: 'market', key: 'market' },
                  { title: 'Buy Vol', dataIndex: 'buyVolume', key: 'buyVolume' },
                  { title: 'Sell Vol', dataIndex: 'sellVolume', key: 'sellVolume' },
                  { title: 'Buys', dataIndex: 'buyCount', key: 'buyCount' },
                  { title: 'Sells', dataIndex: 'sellCount', key: 'sellCount' },
                ]}
              />
            )}
          </Card>

          <Card title="Spoofing Signals" className="admin-card">
            {spoof.length === 0 ? (
              <p className="text-sm admin-metric-label py-4">No spoofing signals in last 10 minutes.</p>
            ) : (
              <Table
                dataSource={spoof}
                rowKey={(r) => `${r.userId}-${r.market}`}
                size="small"
                pagination={false}
                columns={[
                  { title: 'User', dataIndex: 'userId', key: 'userId', render: (v: string) => <Link href={`/admin/users/${v}`} className="font-mono text-xs">{v.slice(0, 8)}…</Link> },
                  { title: 'Market', dataIndex: 'market', key: 'market' },
                  { title: 'Total Orders', dataIndex: 'totalOrders', key: 'totalOrders' },
                  { title: 'Cancelled', dataIndex: 'cancelledOrders', key: 'cancelledOrders' },
                  { title: 'Cancel Rate', key: 'rate', render: (_, r: SpoofSignal) => <Tag color="red">{Math.round(r.cancelRate * 100)}%</Tag> },
                ]}
              />
            )}
          </Card>

          <Card title="Abnormal Price Spikes" className="admin-card">
            {pump.length === 0 ? (
              <p className="text-sm admin-metric-label py-4">No price spike signals.</p>
            ) : (
              <Table
                dataSource={pump}
                rowKey="market"
                size="small"
                pagination={false}
                columns={[
                  { title: 'Market', dataIndex: 'market', key: 'market' },
                  { title: 'Price Change %', dataIndex: 'priceChangePct', key: 'priceChangePct', render: (v: number) => <Tag color="orange">{v.toFixed(2)}%</Tag> },
                  { title: 'Volume Spike', dataIndex: 'volumeSpike', key: 'volumeSpike', render: (v: number) => `${v.toFixed(2)}x` },
                ]}
              />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
