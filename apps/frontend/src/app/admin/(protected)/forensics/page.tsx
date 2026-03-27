'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { Card, Table, Row, Col, Input, Button } from 'antd';
import { AdminChartCard } from '@/components/admin/charts';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Loader2, RefreshCw, Search } from 'lucide-react';

const API_URL = getApiBaseUrl();

export default function ForensicsPage() {
  const { accessToken } = useAdminAuthStore();
  const [userId, setUserId] = useState('');
  const [transactions, setTransactions] = useState<Array<{ id: string; userId: string; market: string; side: string; notional: number; createdAt: string }>>([]);
  const [accountClusters, setAccountClusters] = useState<Array<{ userId: string; tradeCount: number; volume: number }>>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (userId.trim()) params.set('user_id', userId.trim());
      const res = await fetch(`${API_URL}/api/v1/admin/operations/forensics?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (json?.success && json?.data) {
        setTransactions(json.data.transactions ?? []);
        setAccountClusters(json.data.accountClusters ?? []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [accessToken, userId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const clusterChartData = accountClusters.slice(0, 10).map((c) => ({ name: c.userId.slice(0, 8) + '…', volume: c.volume, trades: c.tradeCount }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold admin-metric-value">Exchange Forensics</h1>
          <p className="text-sm admin-metric-label mt-0.5">Transaction tracing, account clusters, wallet relationships</p>
        </div>
        <div className="flex gap-2">
          <Input placeholder="User ID" value={userId} onChange={(e) => setUserId(e.target.value)} style={{ width: 200 }} prefix={<Search className="w-4 h-4" />} />
          <Button type="primary" onClick={fetchData} loading={loading} icon={<RefreshCw className="w-4 h-4" />}>Search</Button>
        </div>
      </div>

      {loading && transactions.length === 0 ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 admin-accent-blue animate-spin" /></div>
      ) : (
        <>
          <AdminChartCard title="Account Clusters by Volume" subtitle="Top accounts by 7d volume">
            {clusterChartData.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-sm admin-metric-label">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={clusterChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="name" stroke="#9CA3AF" fontSize={11} />
                  <YAxis stroke="#9CA3AF" fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                  <Bar dataKey="volume" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </AdminChartCard>

          <Card title="Transaction Trace" className="admin-card">
            {transactions.length === 0 ? (
              <p className="text-sm admin-metric-label py-4">No transactions. Enter a user ID to trace or view recent activity.</p>
            ) : (
              <Table size="small" dataSource={transactions} rowKey="id" pagination={{ pageSize: 15 }}
                columns={[
                  { title: 'User', dataIndex: 'userId', key: 'userId', render: (v: string) => <Link href={`/admin/users/${v}`} className="font-mono text-xs admin-accent-blue">{v.slice(0, 8)}…</Link> },
                  { title: 'Market', dataIndex: 'market', key: 'market' },
                  { title: 'Side', dataIndex: 'side', key: 'side' },
                  { title: 'Notional', key: 'notional', render: (_: unknown, r: { notional: number }) => r.notional?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '—' },
                  { title: 'Time', dataIndex: 'createdAt', key: 'createdAt', render: (v: string) => v ? new Date(v).toLocaleString() : '—' },
                ]}
              />
            )}
          </Card>

          <Card title="Account Clusters" className="admin-card">
            {accountClusters.length === 0 ? (
              <p className="text-sm admin-metric-label py-4">No account clusters.</p>
            ) : (
              <Table size="small" dataSource={accountClusters} rowKey="userId" pagination={{ pageSize: 10 }}
                columns={[
                  { title: 'User', dataIndex: 'userId', key: 'userId', render: (v: string) => <Link href={`/admin/users/${v}`} className="font-mono text-xs admin-accent-blue">{v.slice(0, 8)}…</Link> },
                  { title: 'Trades', dataIndex: 'tradeCount', key: 'tradeCount' },
                  { title: 'Volume', key: 'volume', render: (_: unknown, r: { volume: number }) => r.volume?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '—' },
                ]}
              />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
