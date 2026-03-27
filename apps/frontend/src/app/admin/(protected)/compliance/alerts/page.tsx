'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { Card, Table, Tag, Select, Button, Space, Row, Col } from 'antd';
import { AdminChartCard, RevenueChart, TradeDistributionChart } from '@/components/admin/charts';
import { Loader2, AlertTriangle, ChevronRight, FileDown } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface AmlAlert {
  id: string;
  user_id: string;
  alert_type: string;
  severity: string;
  status: string;
  details: unknown;
  created_at: string;
}

export default function ComplianceAlertsPage() {
  const searchParams = useSearchParams();
  const { accessToken } = useAdminAuthStore();
  const [alerts, setAlerts] = useState<AmlAlert[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>(() => searchParams?.get('status') || 'open');
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [page, setPage] = useState(0);
  const limit = 20;

  const fetchAlerts = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(limit));
      params.set('offset', String(page * limit));
      if (statusFilter) params.set('status', statusFilter);
      if (severityFilter) params.set('severity', severityFilter);
      const res = await fetch(`${API_URL}/api/v1/admin/aml/alerts?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Failed to load alerts');
        return;
      }
      if (data?.success && data?.data) {
        setAlerts(data.data.alerts ?? []);
        setTotal(data.data.total ?? 0);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [accessToken, page, statusFilter, severityFilter]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const severityColor = (s: string) => (s === 'high' ? 'red' : s === 'medium' ? 'orange' : 'default');
  const statusColor = (s: string) => (s === 'closed' ? 'default' : s === 'reviewing' ? 'processing' : 'error');

  const columns = [
    { title: 'Alert ID', dataIndex: 'id', key: 'id', render: (v: string) => <span className="font-mono text-xs">{v.slice(0, 8)}…</span> },
    { title: 'User', dataIndex: 'user_id', key: 'user_id', render: (v: string) => <span className="font-mono text-xs">{v.slice(0, 8)}…</span> },
    { title: 'Type', dataIndex: 'alert_type', key: 'alert_type' },
    {
      title: 'Severity',
      dataIndex: 'severity',
      key: 'severity',
      render: (v: string) => <Tag color={severityColor(v)}>{v}</Tag>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (v: string) => <Tag color={statusColor(v)}>{v}</Tag>,
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (v: string) => <span className="text-xs admin-metric-label">{new Date(v).toLocaleString()}</span>,
    },
    {
      title: '',
      key: 'action',
      render: (_: unknown, r: AmlAlert) => (
        <Link href={`/admin/compliance/alerts/${r.id}`}>
          <Button type="link" size="small" icon={<ChevronRight className="w-4 h-4" />}>
            View
          </Button>
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold admin-metric-value">AML Alerts</h1>
          <p className="text-sm admin-metric-label mt-0.5">
            Review and escalate alerts. Update status or escalate to STR.
          </p>
        </div>
        <Space>
          <Link href="/admin/compliance/reports">
            <Button type="primary" icon={<FileDown className="w-4 h-4" />}>
              STR / CTR Reports
            </Button>
          </Link>
        </Space>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <AdminChartCard title="Alert volume trend" subtitle="7d — proxy">
            <RevenueChart />
          </AdminChartCard>
        </Col>
        <Col xs={24} md={12}>
          <AdminChartCard title="Risk distribution" subtitle="By severity — 24h">
            <TradeDistributionChart />
          </AdminChartCard>
        </Col>
      </Row>

      {error && (
        <Card className="border-red-500/30 bg-red-500/10">
          <div className="flex items-center gap-3 text-red-200">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span>{error}</span>
          </div>
        </Card>
      )}

      <Card title="Alerts" className="admin-card">
        <div className="flex flex-wrap gap-3 mb-4">
          <Select
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setPage(0); }}
            placeholder="Status"
            style={{ minWidth: 140 }}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'open', label: 'Open' },
              { value: 'reviewing', label: 'Reviewing' },
              { value: 'closed', label: 'Closed' },
            ]}
          />
          <Select
            value={severityFilter}
            onChange={(v) => { setSeverityFilter(v); setPage(0); }}
            placeholder="Severity"
            style={{ minWidth: 140 }}
            options={[
              { value: '', label: 'All severities' },
              { value: 'high', label: 'High' },
              { value: 'medium', label: 'Medium' },
              { value: 'low', label: 'Low' },
            ]}
          />
        </div>

        <Table
          dataSource={alerts}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{
            current: page + 1,
            pageSize: limit,
            total,
            showSizeChanger: false,
            onChange: (p) => setPage(p - 1),
          }}
          size="small"
        />
      </Card>
    </div>
  );
}
