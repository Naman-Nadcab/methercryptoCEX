'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import {
  Card,
  Row,
  Col,
  Statistic,
  Switch,
  Button,
  Select,
  Modal,
  message,
  Tag,
  Space,
  Table,
} from 'antd';
import { AdminChartCard } from '@/components/admin/charts';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts';
import { Loader2, RefreshCw, Play, Pause, AlertTriangle, Activity } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface Overview {
  tradingHalted: boolean;
  settlementPending: number;
  spotMetrics: {
    ordersLastMinute: number;
    tradesLastMinute: number;
    ordersPerSecond: number;
    tradesPerSecond: number;
    orderLatencyP50Ms: number | null;
    orderLatencyP99Ms: number | null;
  };
  markets: { total: number; active: number; disabled: number };
  marketsList: { symbol: string; status: string }[];
}

export default function ControlCenterPage() {
  const { accessToken } = useAdminAuthStore();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [cancelMarket, setCancelMarket] = useState<string>('');
  const [cancelModalOpen, setCancelModalOpen] = useState(false);

  const fetchData = useCallback(
    async (isRefresh = false) => {
      if (!accessToken) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const [overviewRes, haltRes] = await Promise.all([
          fetch(`${API_URL}/api/v1/admin/control/overview`, { headers: { Authorization: `Bearer ${accessToken}` } }),
          fetch(`${API_URL}/api/v1/admin/trading-halt`, { headers: { Authorization: `Bearer ${accessToken}` } }),
        ]);
        const overviewData = await overviewRes.json();
        const haltData = await haltRes.json();
        if (overviewData?.success && overviewData?.data) setOverview(overviewData.data);
        if (haltData?.success && haltData?.data != null && overviewData?.success)
          setOverview((o) => (o ? { ...o, tradingHalted: !!haltData.data.halted } : null));
      } catch (e) {
        console.error('Control center fetch error', e);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [accessToken]
  );

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 15000);
    return () => clearInterval(t);
  }, [fetchData]);

  const handleTradingHalt = async (halted: boolean) => {
    if (!accessToken) return;
    setSaving('trading');
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/trading-halt`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ halted }),
      });
      const data = await res.json();
      if (data?.success) {
        setOverview((o) => (o ? { ...o, tradingHalted: halted } : null));
        message.success(halted ? 'Trading halted' : 'Trading resumed');
      } else message.error(data?.error?.message ?? 'Failed');
    } catch {
      message.error('Request failed');
    } finally {
      setSaving(null);
    }
  };

  const handleCancelAllOrders = async () => {
    if (!accessToken) return;
    setSaving('cancel');
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/control/orders/cancel-all`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(cancelMarket ? { market: cancelMarket } : {}),
      });
      const data = await res.json();
      if (data?.success) {
        message.success(`Cancelled ${data.data?.cancelled ?? 0} orders`);
        setCancelModalOpen(false);
        setCancelMarket('');
        fetchData(true);
      } else message.error(data?.error?.message ?? 'Failed');
    } catch {
      message.error('Request failed');
    } finally {
      setSaving(null);
    }
  };

  const throughputData = overview
    ? [
        { name: 'Orders/min', value: overview.spotMetrics.ordersLastMinute, fill: '#3B82F6' },
        { name: 'Trades/min', value: overview.spotMetrics.tradesLastMinute, fill: '#10B981' },
      ]
    : [];

  const latencyData = overview?.spotMetrics.orderLatencyP50Ms != null
    ? [
        { name: 'P50 (ms)', value: overview.spotMetrics.orderLatencyP50Ms },
        { name: 'P99 (ms)', value: overview.spotMetrics.orderLatencyP99Ms ?? 0 },
      ]
    : [];

  const settlementData = overview
    ? [
        { name: 'Pending', value: overview.settlementPending, fill: '#F59E0B' },
        { name: 'Markets Active', value: overview.markets.active, fill: '#10B981' },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold admin-metric-value">Exchange Control Center</h1>
          <p className="text-sm admin-metric-label mt-0.5">
            Pause trading, disable pairs, cancel orders, monitor engine health, settlement
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

      {loading && !overview ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 admin-accent-blue animate-spin" />
        </div>
      ) : (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={8}>
              <Card size="small" className="admin-card">
                <div className="flex items-center justify-between">
                  <Statistic
                    title="Spot Trading"
                    value={overview?.tradingHalted ? 'Halted' : 'Live'}
                    valueStyle={{ color: overview?.tradingHalted ? '#EF4444' : '#10B981', fontSize: 18 }}
                  />
                  <Switch
                    checked={!overview?.tradingHalted}
                    loading={saving === 'trading'}
                    onChange={(v) => handleTradingHalt(!v)}
                    checkedChildren={<Play className="w-3 h-3" />}
                    unCheckedChildren={<Pause className="w-3 h-3" />}
                  />
                </div>
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card size="small" className="admin-card">
                <Statistic
                  title="Settlement Pending"
                  value={overview?.settlementPending ?? 0}
                  valueStyle={{ color: (overview?.settlementPending ?? 0) > 100 ? '#F59E0B' : undefined }}
                />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card size="small" className="admin-card">
                <Statistic title="Markets" value={`${overview?.markets.active ?? 0} / ${overview?.markets.total ?? 0} active`} />
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Card title="Engine Controls" className="admin-card">
                <Space direction="vertical" className="w-full">
                  <Button
                    type="default"
                    danger={!!overview?.tradingHalted}
                    icon={overview?.tradingHalted ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                    onClick={() => handleTradingHalt(!overview?.tradingHalted)}
                    loading={saving === 'trading'}
                  >
                    {overview?.tradingHalted ? 'Resume Trading' : 'Pause Trading'}
                  </Button>
                  <Button type="default" danger icon={<AlertTriangle className="w-4 h-4" />} onClick={() => setCancelModalOpen(true)}>
                    Cancel All Open Orders
                  </Button>
                  <p className="text-xs admin-metric-label mt-1">
                    Disable specific pairs via{' '}
                    <a href="/admin/trading/spot-markets" className="admin-accent-blue hover:underline">
                      Spot Markets
                    </a>
                    . Settlement workers run in-process; restart requires server restart.
                  </p>
                </Space>
              </Card>
            </Col>
            <Col xs={24} md={12}>
              <Card title="Engine Health" className="admin-card">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="admin-metric-label">Orders/sec</span>
                    <div className="admin-metric-value text-lg">{(overview?.spotMetrics.ordersPerSecond ?? 0).toFixed(2)}</div>
                  </div>
                  <div>
                    <span className="admin-metric-label">Trades/sec</span>
                    <div className="admin-metric-value text-lg">{(overview?.spotMetrics.tradesPerSecond ?? 0).toFixed(2)}</div>
                  </div>
                  <div>
                    <span className="admin-metric-label">Order latency P50</span>
                    <div className="admin-metric-value text-lg">
                      {overview?.spotMetrics.orderLatencyP50Ms != null ? `${overview.spotMetrics.orderLatencyP50Ms} ms` : '—'}
                    </div>
                  </div>
                  <div>
                    <span className="admin-metric-label">Order latency P99</span>
                    <div className="admin-metric-value text-lg">
                      {overview?.spotMetrics.orderLatencyP99Ms != null ? `${overview.spotMetrics.orderLatencyP99Ms} ms` : '—'}
                    </div>
                  </div>
                </div>
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]}>
            <Col xs={24} lg={8}>
              <AdminChartCard title="Trade Throughput" subtitle="Last 60s rolling window">
                {throughputData.length === 0 ? (
                  <div className="flex items-center justify-center h-48 text-sm admin-metric-label">No data yet</div>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={throughputData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="name" stroke="#9CA3AF" fontSize={11} />
                      <YAxis stroke="#9CA3AF" fontSize={11} />
                      <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                      <Bar dataKey="value" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </AdminChartCard>
            </Col>
            <Col xs={24} lg={8}>
              <AdminChartCard title="Order Latency" subtitle="P50 / P99 (ms)">
                {latencyData.length === 0 ? (
                  <div className="flex items-center justify-center h-48 text-sm admin-metric-label">No latency data yet</div>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={latencyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="name" stroke="#9CA3AF" fontSize={11} />
                      <YAxis stroke="#9CA3AF" fontSize={11} />
                      <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                      <Bar dataKey="value" fill="#10B981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </AdminChartCard>
            </Col>
            <Col xs={24} lg={8}>
              <AdminChartCard title="Settlement & Markets" subtitle="Queue and active pairs">
                {settlementData.length === 0 ? (
                  <div className="flex items-center justify-center h-48 text-sm admin-metric-label">No data</div>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={settlementData}>
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
          </Row>

          <Card title="Market Status" className="admin-card">
            {overview?.marketsList && overview.marketsList.length > 0 ? (
              <Table
                size="small"
                dataSource={overview.marketsList}
                rowKey="symbol"
                pagination={{ pageSize: 10 }}
                columns={[
                  { title: 'Symbol', dataIndex: 'symbol', key: 'symbol' },
                  {
                    title: 'Status',
                    dataIndex: 'status',
                    key: 'status',
                    render: (v: string) => (
                      <Tag color={v === 'active' ? 'green' : v === 'maintenance' ? 'orange' : 'default'}>{v}</Tag>
                    ),
                  },
                  {
                    title: 'Actions',
                    key: 'actions',
                    render: (_, r: { symbol: string }) => (
                      <a href={`/admin/trading/spot-markets?symbol=${r.symbol}`} className="admin-accent-blue text-xs">
                        Configure
                      </a>
                    ),
                  },
                ]}
              />
            ) : (
              <p className="text-sm admin-metric-label py-4">No spot markets configured.</p>
            )}
          </Card>
        </>
      )}

      <Modal
        title="Cancel All Open Orders"
        open={cancelModalOpen}
        onCancel={() => setCancelModalOpen(false)}
        onOk={handleCancelAllOrders}
        okText="Cancel Orders"
        okButtonProps={{ danger: true, loading: saving === 'cancel' }}
      >
        <p className="admin-metric-label mb-3">This will cancel all open and partially filled orders.</p>
        <Select
          placeholder="All markets (or select one)"
          allowClear
          className="w-full"
          value={cancelMarket || undefined}
          onChange={(v) => setCancelMarket(v ?? '')}
          options={overview?.marketsList?.map((m) => ({ label: m.symbol, value: m.symbol })) ?? []}
        />
      </Modal>
    </div>
  );
}
