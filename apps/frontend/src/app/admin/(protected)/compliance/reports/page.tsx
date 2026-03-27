'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { Card, Table, Tag, Select, Button, Space, Row, Col, Statistic } from 'antd';
import { Loader2, AlertTriangle, ChevronRight, FileDown, Plus } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface StrCtrReport {
  id: string;
  report_type: string;
  user_id: string | null;
  period_start: string | null;
  period_end: string | null;
  total_amount: string | null;
  status: string;
  created_at: string;
}

export default function ComplianceReportsPage() {
  const { accessToken } = useAdminAuthStore();
  const [reports, setReports] = useState<StrCtrReport[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportTypeFilter, setReportTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const limit = 20;

  const fetchReports = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(limit));
      params.set('offset', String(page * limit));
      if (reportTypeFilter) params.set('reportType', reportTypeFilter);
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`${API_URL}/api/v1/admin/aml/reports?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Failed to load reports');
        return;
      }
      if (data?.success && data?.data) {
        setReports(data.data.reports ?? []);
        setTotal(data.data.total ?? 0);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [accessToken, page, reportTypeFilter, statusFilter]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const handleExport = async () => {
    if (!accessToken) return;
    setExporting(true);
    try {
      const params = new URLSearchParams();
      params.set('format', 'csv');
      params.set('limit', '5000');
      if (reportTypeFilter) params.set('reportType', reportTypeFilter);
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`${API_URL}/api/v1/admin/aml/reports/export?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data?.error?.message ?? 'Export failed');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `str-ctr-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const statusColor = (s: string) => (s === 'acknowledged' ? 'default' : s === 'submitted' ? 'processing' : 'error');

  const columns = [
    { title: 'Report ID', dataIndex: 'id', key: 'id', render: (v: string) => <span className="font-mono text-xs">{v.slice(0, 8)}…</span> },
    { title: 'Type', dataIndex: 'report_type', key: 'report_type', render: (v: string) => <Tag color={v === 'STR' ? 'red' : 'blue'}>{v}</Tag> },
    { title: 'User', dataIndex: 'user_id', key: 'user_id', render: (v: string | null) => (v ? <span className="font-mono text-xs">{v.slice(0, 8)}…</span> : '—') },
    {
      title: 'Period',
      key: 'period',
      render: (_: unknown, r: StrCtrReport) =>
        r.period_start && r.period_end
          ? `${new Date(r.period_start).toLocaleDateString()} – ${new Date(r.period_end).toLocaleDateString()}`
          : '—',
    },
    { title: 'Total', dataIndex: 'total_amount', key: 'total_amount', render: (v: string | null) => v ?? '—' },
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
      render: (_: unknown, r: StrCtrReport) => (
        <Link href={`/admin/compliance/reports/${r.id}`}>
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
          <h1 className="text-xl font-bold admin-metric-value">STR / CTR Reports</h1>
          <p className="text-sm admin-metric-label mt-0.5">
            Suspicious and cash transaction reports. Submit or acknowledge from detail.
          </p>
        </div>
        <Space>
          <Button
            type="default"
            icon={<FileDown className="w-4 h-4" />}
            onClick={handleExport}
            loading={exporting}
          >
            Export CSV
          </Button>
          <Link href="/admin/compliance/alerts">
            <Button type="primary" icon={<Plus className="w-4 h-4" />}>
              AML Alerts
            </Button>
          </Link>
        </Space>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} md={8}>
          <Card size="small" className="admin-card">
            <Statistic title="Total reports" value={total} />
          </Card>
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

      <Card title="Reports" className="admin-card">
        <div className="flex flex-wrap gap-3 mb-4">
          <Select
            value={reportTypeFilter}
            onChange={(v) => { setReportTypeFilter(v); setPage(0); }}
            placeholder="Type"
            style={{ minWidth: 120 }}
            options={[
              { value: '', label: 'All types' },
              { value: 'STR', label: 'STR' },
              { value: 'CTR', label: 'CTR' },
            ]}
          />
          <Select
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setPage(0); }}
            placeholder="Status"
            style={{ minWidth: 140 }}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'pending', label: 'Pending' },
              { value: 'submitted', label: 'Submitted' },
              { value: 'acknowledged', label: 'Acknowledged' },
            ]}
          />
        </div>

        <Table
          dataSource={reports}
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
