'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { Card, Table, Row, Col, Statistic, Button } from 'antd';
import { AdminChartCard } from '@/components/admin/charts';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { Loader2, RefreshCw } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface MultiIpRow {
  user_id: string;
  ip_count: number;
}
interface AmlRow {
  user_id: string;
  alert_count: number;
  max_risk: string;
}
interface FailedRow {
  user_id: string;
  fail_count: number;
}

export default function UserRiskIntelligencePage() {
  const { accessToken } = useAdminAuthStore();
  const [multiIp, setMultiIp] = useState<MultiIpRow[]>([]);
  const [amlRisky, setAmlRisky] = useState<AmlRow[]>([]);
  const [failedLogins, setFailedLogins] = useState<FailedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(
    async (isRefresh = false) => {
      if (!accessToken) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/v1/admin/analytics/user-risk`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const json = await res.json();
        if (json?.success && json?.data) {
          setMultiIp(json.data.multiIpLogins ?? []);
          setAmlRisky(json.data.amlRiskyUsers ?? []);
          setFailedLogins(json.data.failedLoginSpike ?? []);
        }
      } catch (e) {
        console.error('User risk fetch error', e);
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

  const riskChartData = [
    { name: 'Multi-IP Logins', value: multiIp.length, fill: '#F59E0B' },
    { name: 'AML Risky', value: amlRisky.length, fill: '#EF4444' },
    { name: 'Failed Login Spike', value: failedLogins.length, fill: '#3B82F6' },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold admin-metric-value">User Risk Intelligence</h1>
          <p className="text-sm admin-metric-label mt-0.5">
            High risk users, multiple IP logins, suspicious patterns
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
            <Statistic title="Multi-IP Logins (≥3 IPs)" value={multiIp.length} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" className="admin-card">
            <Statistic title="AML Risky Users" value={amlRisky.length} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" className="admin-card">
            <Statistic title="Failed Login Spike (24h)" value={failedLogins.length} />
          </Card>
        </Col>
      </Row>

      {loading && multiIp.length === 0 && amlRisky.length === 0 && failedLogins.length === 0 ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 admin-accent-blue animate-spin" />
        </div>
      ) : (
        <>
          <AdminChartCard title="Risk Score Distribution" subtitle="By category">
            {riskChartData.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-sm admin-metric-label">No risk signals</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={riskChartData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" nameKey="name" label={({ name, value }) => `${name}: ${value}`}>
                    {riskChartData.map((_, i) => (
                      <Cell key={i} fill={riskChartData[i]!.fill} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </AdminChartCard>

          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <Card title="Multi-IP Logins" className="admin-card">
                {multiIp.length === 0 ? (
                  <p className="text-sm admin-metric-label py-4">No users with 3+ distinct IPs in last 7 days.</p>
                ) : (
                  <Table
                    size="small"
                    dataSource={multiIp}
                    rowKey="user_id"
                    pagination={{ pageSize: 5 }}
                    columns={[
                      {
                        title: 'User',
                        dataIndex: 'user_id',
                        key: 'user_id',
                        render: (v: string) => (
                          <Link href={`/admin/users/${v}`} className="font-mono text-xs admin-accent-blue">
                            {v.slice(0, 8)}…
                          </Link>
                        ),
                      },
                      { title: 'IP Count', dataIndex: 'ip_count', key: 'ip_count' },
                    ]}
                  />
                )}
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card title="AML Risky Users" className="admin-card">
                {amlRisky.length === 0 ? (
                  <p className="text-sm admin-metric-label py-4">No open AML alerts.</p>
                ) : (
                  <Table
                    size="small"
                    dataSource={amlRisky}
                    rowKey="user_id"
                    pagination={{ pageSize: 5 }}
                    columns={[
                      {
                        title: 'User',
                        dataIndex: 'user_id',
                        key: 'user_id',
                        render: (v: string) => (
                          <Link href={`/admin/users/${v}`} className="font-mono text-xs admin-accent-blue">
                            {v.slice(0, 8)}…
                          </Link>
                        ),
                      },
                      { title: 'Alerts', dataIndex: 'alert_count', key: 'alert_count' },
                      { title: 'Max Risk', dataIndex: 'max_risk', key: 'max_risk', render: (v: string) => parseFloat(v || '0').toFixed(2) },
                    ]}
                  />
                )}
              </Card>
            </Col>
          </Row>

          <Card title="Failed Login Spike (≥5 in 24h)" className="admin-card">
            {failedLogins.length === 0 ? (
              <p className="text-sm admin-metric-label py-4">No users with 5+ failed logins in last 24h.</p>
            ) : (
              <Table
                size="small"
                dataSource={failedLogins}
                rowKey="user_id"
                pagination={{ pageSize: 5 }}
                columns={[
                  {
                    title: 'User',
                    dataIndex: 'user_id',
                    key: 'user_id',
                    render: (v: string) => (
                      <Link href={`/admin/users/${v}`} className="font-mono text-xs admin-accent-blue">
                        {v.slice(0, 8)}…
                      </Link>
                    ),
                  },
                  { title: 'Failed Count', dataIndex: 'fail_count', key: 'fail_count' },
                ]}
              />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
