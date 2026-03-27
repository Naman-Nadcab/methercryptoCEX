'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { Card, Row, Col, Statistic, Select, Button } from 'antd';
import { AdminChartCard } from '@/components/admin/charts';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Loader2, RefreshCw } from 'lucide-react';

const API_URL = getApiBaseUrl();
const SYMBOLS = ['ETH_USDT', 'BTC_USDT', 'BNB_USDT', 'SOL_USDT'];

interface StabilityData {
  symbol: string;
  spreadBps: number;
  imbalance: number;
  bidDepth: number;
  askDepth: number;
  priceImpact1pct: number;
  levels: { bids: number; asks: number };
}

export default function LiquidityStabilityPage() {
  const { accessToken } = useAdminAuthStore();
  const [symbol, setSymbol] = useState('ETH_USDT');
  const [period, setPeriod] = useState('24h');
  const [data, setData] = useState<StabilityData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/api/v1/admin/operations/liquidity-stability?symbol=${symbol}&period=${period}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const json = await res.json();
      if (json?.success && json?.data) setData(json.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [accessToken, symbol, period]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const chartData = data ? [
    { name: 'Spread (bps)', value: data.spreadBps, fill: '#F59E0B' },
    { name: 'Price Impact 1%', value: data.priceImpact1pct, fill: '#3B82F6' },
    { name: 'Imbalance |%|', value: Math.abs(data.imbalance) * 100, fill: '#10B981' },
  ] : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold admin-metric-value">Liquidity Stability Monitor</h1>
          <p className="text-sm admin-metric-label mt-0.5">Spread volatility, orderbook stability, imbalance, price impact</p>
        </div>
        <div className="flex gap-2">
          <Select value={symbol} onChange={setSymbol} options={SYMBOLS.map((s) => ({ label: s, value: s }))} style={{ width: 120 }} />
          <Select value={period} onChange={setPeriod} options={[{ label: '24h', value: '24h' }, { label: '7d', value: '7d' }]} style={{ width: 80 }} />
          <Button type="default" icon={<RefreshCw className="w-4 h-4" />} onClick={fetchData} loading={loading}>Refresh</Button>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 admin-accent-blue animate-spin" /></div>
      ) : (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={6}>
              <Card size="small" className="admin-card">
                <Statistic title="Spread (bps)" value={data?.spreadBps?.toFixed(2) ?? '—'} />
              </Card>
            </Col>
            <Col xs={24} sm={6}>
              <Card size="small" className="admin-card">
                <Statistic title="Imbalance" value={data ? `${(data.imbalance * 100).toFixed(1)}%` : '—'} valueStyle={{ color: data && Math.abs(data.imbalance) > 0.3 ? '#F59E0B' : undefined }} />
              </Card>
            </Col>
            <Col xs={24} sm={6}>
              <Card size="small" className="admin-card">
                <Statistic title="Bid Depth" value={data?.bidDepth?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '—'} />
              </Card>
            </Col>
            <Col xs={24} sm={6}>
              <Card size="small" className="admin-card">
                <Statistic title="Price Impact 1%" value={data?.priceImpact1pct?.toFixed(3) ?? '—'} suffix="%" />
              </Card>
            </Col>
          </Row>

          <AdminChartCard title="Stability Metrics" subtitle={`${data?.symbol ?? symbol}`}>
            {chartData.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-sm admin-metric-label">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="name" stroke="#9CA3AF" fontSize={11} />
                  <YAxis stroke="#9CA3AF" fontSize={11} />
                  <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </AdminChartCard>
        </>
      )}
    </div>
  );
}
