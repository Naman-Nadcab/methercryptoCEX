'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { Card, Row, Col, Select, Button, Statistic } from 'antd';
import { AdminChartCard } from '@/components/admin/charts';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
} from 'recharts';
import { Loader2, RefreshCw } from 'lucide-react';

const API_URL = getApiBaseUrl();
const SYMBOLS = ['ETH_USDT', 'BTC_USDT', 'BNB_USDT', 'SOL_USDT', 'XRP_USDT'];

interface OrderbookData {
  symbol: string;
  bidDepth: number;
  askDepth: number;
  bidQty: number;
  askQty: number;
  spread: number;
  spreadBps: number;
  imbalance: number;
  bestBid: number;
  bestAsk: number;
  largeOrders: { bids: number; asks: number };
  levels: { bids: number; asks: number };
}

export default function OrderbookIntelligencePage() {
  const { accessToken } = useAdminAuthStore();
  const [symbol, setSymbol] = useState('ETH_USDT');
  const [data, setData] = useState<OrderbookData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(
    async (isRefresh = false) => {
      if (!accessToken) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const res = await fetch(
          `${API_URL}/api/v1/admin/analytics/orderbook-intelligence?symbol=${encodeURIComponent(symbol)}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const json = await res.json();
        if (json?.success && json?.data) setData(json.data);
      } catch (e) {
        console.error('Orderbook intelligence fetch error', e);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [accessToken, symbol]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const depthChartData = data
    ? [
        { name: 'Bid Depth (USD)', value: data.bidDepth, fill: '#10B981' },
        { name: 'Ask Depth (USD)', value: data.askDepth, fill: '#EF4444' },
      ]
    : [];
  const imbalanceChartData = data ? [{ name: 'Imbalance', value: (data.imbalance + 1) * 50 }] : [];
  const spreadChartData = data ? [{ name: 'Spread (bps)', value: data.spreadBps }] : [];
  const largeOrdersData = data
    ? [
        { name: 'Large Bids', value: data.largeOrders.bids },
        { name: 'Large Asks', value: data.largeOrders.asks },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold admin-metric-value">Orderbook Intelligence</h1>
          <p className="text-sm admin-metric-label mt-0.5">
            Market depth, bid/ask imbalance, spread analysis, large order detection
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={symbol}
            onChange={setSymbol}
            options={SYMBOLS.map((s) => ({ label: s, value: s }))}
            style={{ width: 140 }}
          />
          <Button
            type="default"
            icon={<RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />}
            onClick={() => fetchData(true)}
            loading={refreshing}
          >
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
            <Col xs={24} sm={8}>
              <Card size="small" className="admin-card">
                <Statistic title="Bid Depth (USD)" value={data?.bidDepth?.toFixed(0) ?? '—'} />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card size="small" className="admin-card">
                <Statistic title="Ask Depth (USD)" value={data?.askDepth?.toFixed(0) ?? '—'} />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card size="small" className="admin-card">
                <Statistic title="Spread (bps)" value={data?.spreadBps?.toFixed(2) ?? '—'} />
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <AdminChartCard title="Market Depth" subtitle={`${data?.symbol ?? symbol} — Bid vs Ask`}>
                {depthChartData.length === 0 ? (
                  <div className="flex items-center justify-center h-48 text-sm admin-metric-label">No data</div>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={depthChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="name" stroke="#9CA3AF" fontSize={11} />
                      <YAxis stroke="#9CA3AF" fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                      <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                      <Bar dataKey="value" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </AdminChartCard>
            </Col>
            <Col xs={24} lg={12}>
              <AdminChartCard title="Bid/Ask Imbalance" subtitle="Positive = bid-heavy, negative = ask-heavy">
                <div className="flex items-center justify-center h-48">
                  {data ? (
                    <div className="text-center">
                      <div
                        className="text-3xl font-bold"
                        style={{ color: data.imbalance > 0 ? '#10B981' : data.imbalance < 0 ? '#EF4444' : '#9CA3AF' }}
                      >
                        {(data.imbalance * 100).toFixed(1)}%
                      </div>
                      <div className="text-xs admin-metric-label mt-1">Imbalance index</div>
                    </div>
                  ) : (
                    <div className="text-sm admin-metric-label">No data</div>
                  )}
                </div>
              </AdminChartCard>
            </Col>
          </Row>

          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <AdminChartCard title="Large Order Detection" subtitle="Orders ≥20% of book">
                {largeOrdersData.length === 0 ? (
                  <div className="flex items-center justify-center h-48 text-sm admin-metric-label">No data</div>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={largeOrdersData}>
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
              <Card size="small" className="admin-card h-full">
                <h3 className="text-sm font-semibold admin-metric-value mb-3">Orderbook Snapshot</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="admin-metric-label">Best Bid</span>
                    <div className="admin-metric-value font-mono">{data?.bestBid?.toFixed(2) ?? '—'}</div>
                  </div>
                  <div>
                    <span className="admin-metric-label">Best Ask</span>
                    <div className="admin-metric-value font-mono">{data?.bestAsk?.toFixed(2) ?? '—'}</div>
                  </div>
                  <div>
                    <span className="admin-metric-label">Bid Levels</span>
                    <div className="admin-metric-value">{data?.levels?.bids ?? '—'}</div>
                  </div>
                  <div>
                    <span className="admin-metric-label">Ask Levels</span>
                    <div className="admin-metric-value">{data?.levels?.asks ?? '—'}</div>
                  </div>
                </div>
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  );
}
