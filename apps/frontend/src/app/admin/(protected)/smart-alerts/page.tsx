'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { Card, Row, Col, Statistic, Button, Tag } from 'antd';
import { AdminChartCard } from '@/components/admin/charts';
import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from 'recharts';
import { Loader2, RefreshCw, Bell } from 'lucide-react';

const API_URL = getApiBaseUrl();
const COLORS = ['#EF4444', '#F59E0B', '#3B82F6', '#10B981'];

interface Alert {
  type: string;
  severity: string;
  message: string;
  count?: number;
}

export default function SmartAlertsPage() {
  const { accessToken } = useAdminAuthStore();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [summary, setSummary] = useState<{ amlOpen: number; pendingWithdrawals: number; circuitOpen: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/operations/smart-alerts`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (json?.success && json?.data) {
        setAlerts(json.data.alerts ?? []);
        setSummary(json.data.summary ?? null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const pieData = summary
    ? [
        { name: 'AML Open', value: summary.amlOpen || 1 },
        { name: 'Pending Withdrawals', value: summary.pendingWithdrawals || 1 },
        { name: 'Circuit Open', value: summary.circuitOpen ? 1 : 0 },
      ].filter((d) => d.value > 0)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold admin-metric-value">Smart Alert System</h1>
          <p className="text-sm admin-metric-label mt-0.5">Withdrawal spikes, liquidity crashes, AML alerts, API failures</p>
        </div>
        <Button type="default" icon={<RefreshCw className="w-4 h-4" />} onClick={fetchData} loading={loading}>Refresh</Button>
      </div>

      {loading && alerts.length === 0 ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 admin-accent-blue animate-spin" /></div>
      ) : (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={8}>
              <Card size="small" className="admin-card">
                <Statistic title="AML Open" value={summary?.amlOpen ?? 0} valueStyle={{ color: (summary?.amlOpen ?? 0) > 0 ? '#F59E0B' : undefined }} />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card size="small" className="admin-card">
                <Statistic title="Pending Withdrawals" value={summary?.pendingWithdrawals ?? 0} />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card size="small" className="admin-card">
                <Statistic title="Circuit Open" value={summary?.circuitOpen ? 'Yes' : 'No'} valueStyle={{ color: summary?.circuitOpen ? '#EF4444' : '#10B981' }} />
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <AdminChartCard title="Alert Distribution" subtitle="Active alert sources">
                {pieData.length === 0 ? (
                  <div className="flex items-center justify-center h-48 text-sm admin-metric-label">No active alerts</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" nameKey="name">
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </AdminChartCard>
            </Col>
            <Col xs={24} lg={12}>
              <Card title="Active Alerts" className="admin-card">
                {alerts.length === 0 ? (
                  <p className="text-sm admin-metric-label py-4">No alerts. System is healthy.</p>
                ) : (
                  <div className="space-y-2">
                    {alerts.map((a, i) => (
                      <div key={i} className={`flex items-center gap-3 p-3 rounded ${a.severity === 'critical' ? 'bg-red-500/10' : a.severity === 'high' ? 'bg-amber-500/10' : 'bg-blue-500/10'}`}>
                        <Bell className="w-4 h-4 shrink-0" />
                        <div className="flex-1">
                          <div className="text-sm font-medium">{a.message}</div>
                          <Tag color={a.severity === 'critical' ? 'red' : a.severity === 'high' ? 'orange' : 'blue'} className="text-xs mt-1">
                            {a.severity}
                          </Tag>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </Col>
          </Row>

          <Card title="Quick Actions" className="admin-card">
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/compliance/alerts"><Button size="small">AML Alerts</Button></Link>
              <Link href="/admin/wallets/withdrawals"><Button size="small">Withdrawals</Button></Link>
              <Link href="/admin/control-center"><Button size="small">Control Center</Button></Link>
              <Link href="/admin/incidents"><Button size="small">Incidents</Button></Link>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
