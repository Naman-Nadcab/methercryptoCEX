'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { Card, Row, Col, Statistic, Button } from 'antd';
import { AdminChartCard } from '@/components/admin/charts';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Loader2, RefreshCw } from 'lucide-react';

const API_URL = getApiBaseUrl();

export default function ProofOfReservesPage() {
  const { accessToken } = useAdminAuthStore();
  const [data, setData] = useState<{
    totalLiabilities: number;
    totalHotReserves: number;
    reserveRatio: number;
    ledgerTotals: Array<{ chain_symbol: string; token_symbol: string; amount: string }>;
    hotWallets: Array<{ chain_name: string; balance: string }>;
    coldWallets: Array<{ chain_name: string; address: string | null }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/operations/proof-of-reserves`, {
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

  const distData = (data?.ledgerTotals ?? []).map((l) => ({ name: `${l.chain_symbol}/${l.token_symbol}`, amount: parseFloat(l.amount || '0') }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold admin-metric-value">Proof of Reserves</h1>
          <p className="text-sm admin-metric-label mt-0.5">User liabilities, hot/cold reserves, reserve ratio</p>
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
                <Statistic title="Total Liabilities" value={data?.totalLiabilities?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '0'} />
              </Card>
            </Col>
            <Col xs={24} sm={6}>
              <Card size="small" className="admin-card">
                <Statistic title="Hot Reserves" value={data?.totalHotReserves?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '0'} />
              </Card>
            </Col>
            <Col xs={24} sm={6}>
              <Card size="small" className="admin-card">
                <Statistic title="Reserve Ratio" value={data?.reserveRatio != null ? `${(data.reserveRatio * 100).toFixed(1)}%` : '—'} valueStyle={{ color: (data?.reserveRatio ?? 1) >= 1 ? '#10B981' : '#F59E0B' }} />
              </Card>
            </Col>
            <Col xs={24} sm={6}>
              <Card size="small" className="admin-card">
                <Statistic title="Assets" value={(data?.ledgerTotals ?? []).length} suffix="pairs" />
              </Card>
            </Col>
          </Row>

          <AdminChartCard title="Reserve Distribution" subtitle="Liabilities by asset">
            {distData.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-sm admin-metric-label">No ledger data</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={distData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="name" stroke="#9CA3AF" fontSize={11} />
                  <YAxis stroke="#9CA3AF" fontSize={11} />
                  <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                  <Bar dataKey="amount" fill="#10B981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </AdminChartCard>

          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Card title="Ledger Totals" size="small" className="admin-card">
                {(data?.ledgerTotals ?? []).length === 0 ? (
                  <p className="text-sm admin-metric-label py-4">No ledger data.</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {(data?.ledgerTotals ?? []).map((l, i) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span>{l.chain_symbol}/{l.token_symbol}</span>
                        <span className="font-mono">{parseFloat(l.amount || '0').toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </Col>
            <Col xs={24} md={12}>
              <Card title="Quick Links" size="small" className="admin-card">
                <Link href="/admin/wallets/funds-summary"><span className="admin-accent-blue hover:underline">Funds Summary</span></Link>
                <span className="mx-2">·</span>
                <Link href="/admin/wallets/hot"><span className="admin-accent-blue hover:underline">Hot Wallets</span></Link>
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  );
}
