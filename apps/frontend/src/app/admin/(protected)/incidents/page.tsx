'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { Card, Row, Col, Statistic, Button } from 'antd';
import { AdminChartCard } from '@/components/admin/charts';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Loader2, RefreshCw, AlertTriangle } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface Incident {
  type: string;
  count: number;
  severity: string;
}

export default function IncidentManagementPage() {
  const { accessToken } = useAdminAuthStore();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [counters, setCounters] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/operations/incidents`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (json?.success && json?.data) {
        setIncidents(json.data.incidents ?? []);
        setCounters(json.data.counters ?? {});
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const criticalCount = incidents.filter((i) => i.severity === 'critical').reduce((s, i) => s + i.count, 0);
  const highCount = incidents.filter((i) => i.severity === 'high').reduce((s, i) => s + i.count, 0);
  const chartData = incidents.filter((i) => i.count > 0).map((i) => ({ name: i.type.replace(/_/g, ' '), count: i.count }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold admin-metric-value">Incident Management</h1>
          <p className="text-sm admin-metric-label mt-0.5">System outages, wallet issues, API failures, trading engine errors</p>
        </div>
        <Button type="default" icon={<RefreshCw className="w-4 h-4" />} onClick={fetchData} loading={loading}>Refresh</Button>
      </div>

      {loading && incidents.length === 0 ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 admin-accent-blue animate-spin" /></div>
      ) : (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={8}>
              <Card size="small" className="admin-card">
                <Statistic title="Critical" value={criticalCount} valueStyle={{ color: criticalCount > 0 ? '#EF4444' : undefined }} />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card size="small" className="admin-card">
                <Statistic title="High" value={highCount} valueStyle={{ color: highCount > 0 ? '#F59E0B' : undefined }} />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card size="small" className="admin-card">
                <Statistic title="Total Incidents" value={incidents.reduce((s, i) => s + i.count, 0)} />
              </Card>
            </Col>
          </Row>

          <AdminChartCard title="Incidents by Type" subtitle="From monitoring counters">
            {chartData.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-sm admin-metric-label">No incidents</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="name" stroke="#9CA3AF" fontSize={11} angle={-20} textAnchor="end" height={60} />
                  <YAxis stroke="#9CA3AF" fontSize={11} />
                  <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                  <Bar dataKey="count" fill="#EF4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </AdminChartCard>

          <Card title="Incident Types" className="admin-card">
            <Row gutter={[16, 16]}>
              {incidents.map((i) => (
                <Col xs={24} sm={12} md={8} key={i.type}>
                  <div className={`flex items-center gap-3 p-3 rounded ${i.count > 0 ? 'bg-red-500/10 border border-red-500/30' : 'bg-muted/30'}`}>
                    <AlertTriangle className={`w-5 h-5 shrink-0 ${i.count > 0 ? 'text-red-400' : 'text-muted-foreground'}`} />
                    <div>
                      <div className="text-sm font-medium">{i.type.replace(/_/g, ' ')}</div>
                      <div className="text-xs admin-metric-label">
                        Count: {i.count} · {i.severity}
                      </div>
                    </div>
                  </div>
                </Col>
              ))}
            </Row>
          </Card>
        </>
      )}
    </div>
  );
}
