'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader, Panel, ActionButton } from '@/components/admin/control-plane';
import { Card, Table, Button, Select, Space, message, Modal, Input } from 'antd';
import { Loader2, RefreshCw, FileText, Send, Plus } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface Report {
  id: string;
  report_type: string;
  user_id: string | null;
  period_start: string | null;
  period_end: string | null;
  total_amount: string | null;
  status: string;
  payload?: unknown;
  created_at: string;
}

export default function StrCtrWorkflowPage() {
  const { accessToken } = useAdminAuthStore();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [generateModal, setGenerateModal] = useState<'str' | 'ctr' | null>(null);
  const [periodStart, setPeriodStart] = useState<string | null>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [periodEnd, setPeriodEnd] = useState<string | null>(() => new Date().toISOString().slice(0, 10));
  const [generating, setGenerating] = useState(false);
  const [escalateAlertId, setEscalateAlertId] = useState('');
  const [escalating, setEscalating] = useState(false);

  const fetchReports = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('type', typeFilter);
      const res = await fetch(`${API_URL}/api/v1/admin/compliance/str-ctr/reports?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (json?.success && json?.data?.reports) setReports(json.data.reports);
      else setReports([]);
    } catch {
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, statusFilter, typeFilter]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const handleGenerateSTR = async () => {
    if (!accessToken) return;
    setGenerating(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/compliance/str-ctr/generate-str`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          periodStart: periodStart ?? new Date().toISOString().slice(0, 10),
          periodEnd: periodEnd ?? new Date().toISOString().slice(0, 10),
          markAlertsReported: true,
        }),
      });
      const json = await res.json();
      if (json?.success) {
        message.success(`Generated ${(json.data?.reportIds ?? []).length} STR report(s)`);
        setGenerateModal(null);
        fetchReports();
      } else message.error(json?.error?.message ?? 'Generate failed');
    } catch {
      message.error('Request failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateCTR = async () => {
    if (!accessToken) return;
    setGenerating(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/compliance/str-ctr/generate-ctr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          periodStart: periodStart ?? new Date().toISOString().slice(0, 10),
          periodEnd: periodEnd ?? new Date().toISOString().slice(0, 10),
        }),
      });
      const json = await res.json();
      if (json?.success) {
        message.success(`Generated ${(json.data?.reportIds ?? []).length} CTR report(s)`);
        setGenerateModal(null);
        fetchReports();
      } else message.error(json?.error?.message ?? 'Generate failed');
    } catch {
      message.error('Request failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleMarkSubmitted = async (reportId: string) => {
    if (!accessToken) return;
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/compliance/str-ctr/reports/${reportId}/mark-submitted`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (json?.success && json?.data?.updated) {
        message.success('Report marked as submitted');
        fetchReports();
      } else message.error(json?.error?.message ?? 'Update failed');
    } catch {
      message.error('Request failed');
    }
  };

  const handleEscalateAlert = async () => {
    if (!accessToken || !escalateAlertId.trim()) return;
    setEscalating(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/compliance/str-ctr/escalate-alert-to-str`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ alertId: escalateAlertId.trim() }),
      });
      const json = await res.json();
      if (json?.success) {
        message.success('Alert escalated to STR');
        setEscalateAlertId('');
        setEscalating(false);
        fetchReports();
      } else message.error(json?.error?.message ?? 'Escalate failed');
    } catch {
      message.error('Request failed');
      setEscalating(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="STR / CTR Reporting Workflow"
        subtitle="Generate STR/CTR reports, escalate alerts to STR, mark reports as submitted to FIU"
        action={
          <>
            <Button type="default" onClick={() => setGenerateModal('str')} icon={<FileText className="w-4 h-4" />}>
              Generate STR
            </Button>
            <Button type="default" onClick={() => setGenerateModal('ctr')} icon={<FileText className="w-4 h-4" />} className="ml-2">
              Generate CTR
            </Button>
            <ActionButton variant="secondary" onClick={fetchReports} loading={loading} icon={<RefreshCw className="w-4 h-4" />} className="ml-2">
              Refresh
            </ActionButton>
          </>
        }
      />

      <Panel title="Escalate single alert to STR" subtitle="Create one STR report from an AML alert">
        <Space.Compact className="w-full max-w-md">
          <Input
            placeholder="AML Alert ID (UUID)"
            value={escalateAlertId}
            onChange={(e) => setEscalateAlertId(e.target.value)}
          />
          <Button type="primary" onClick={handleEscalateAlert} loading={escalating} icon={<Plus className="w-4 h-4" />}>
            Escalate to STR
          </Button>
        </Space.Compact>
        <p className="text-sm text-gray-500 mt-2">Use alert ID from <Link href="/admin/compliance/alerts" className="text-blue-400 hover:underline">AML Alerts</Link>.</p>
      </Panel>

      <Panel title="Reports" subtitle="STR and CTR reports">
        <Space className="mb-4">
          <Select
            placeholder="Type"
            allowClear
            style={{ width: 100 }}
            value={typeFilter || undefined}
            onChange={(v) => setTypeFilter(v ?? '')}
            options={[
              { value: 'STR', label: 'STR' },
              { value: 'CTR', label: 'CTR' },
            ]}
          />
          <Select
            placeholder="Status"
            allowClear
            style={{ width: 120 }}
            value={statusFilter || undefined}
            onChange={(v) => setStatusFilter(v ?? '')}
            options={[
              { value: 'pending', label: 'Pending' },
              { value: 'submitted', label: 'Submitted' },
              { value: 'acknowledged', label: 'Acknowledged' },
            ]}
          />
        </Space>
        <Table
          dataSource={reports}
          rowKey="id"
          size="small"
          loading={loading}
          columns={[
            { title: 'Type', dataIndex: 'report_type', key: 'report_type', width: 70 },
            { title: 'User', dataIndex: 'user_id', key: 'user_id', render: (v: string) => v ? <Link href={`/admin/users/${v}`} className="font-mono text-xs text-blue-400">{v.slice(0, 8)}…</Link> : '—' },
            { title: 'Period', key: 'period', render: (_: unknown, r: Report) => `${r.period_start ?? ''} – ${r.period_end ?? ''}` },
            { title: 'Status', dataIndex: 'status', key: 'status', render: (s: string) => <span className={`px-2 py-0.5 rounded text-xs ${s === 'submitted' ? 'bg-green-500/20' : s === 'pending' ? 'bg-amber-500/20' : 'bg-gray-500/20'}`}>{s}</span> },
            { title: 'Created', dataIndex: 'created_at', key: 'created_at', render: (v: string) => v ? new Date(v).toLocaleString() : '—' },
            {
              title: 'Actions',
              key: 'actions',
              width: 140,
              render: (_: unknown, r: Report) =>
                r.status === 'pending' ? (
                  <Button type="link" size="small" onClick={() => handleMarkSubmitted(r.id)} icon={<Send className="w-3 h-3" />}>
                    Mark submitted
                  </Button>
                ) : null,
            },
          ]}
          pagination={false}
        />
      </Panel>

      <Modal
        title={generateModal === 'str' ? 'Generate STR' : 'Generate CTR'}
        open={generateModal !== null}
        onCancel={() => setGenerateModal(null)}
        footer={[
          <Button key="cancel" onClick={() => setGenerateModal(null)}>Cancel</Button>,
          <Button key="submit" type="primary" loading={generating} onClick={generateModal === 'str' ? handleGenerateSTR : handleGenerateCTR}>
            Generate
          </Button>,
        ]}
      >
        <div className="space-y-4 py-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Period start</label>
            <Input type="date" value={periodStart ?? ''} onChange={(e) => setPeriodStart(e.target.value || null)} />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Period end</label>
            <Input type="date" value={periodEnd ?? ''} onChange={(e) => setPeriodEnd(e.target.value || null)} />
          </div>
          {generateModal === 'str' && <p className="text-sm text-gray-500">STR: open AML alerts in the period are grouped by user; one report per user. Alerts are marked as reported.</p>}
          {generateModal === 'ctr' && <p className="text-sm text-gray-500">CTR: INR transactions ≥ threshold in the period; one report per user.</p>}
        </div>
      </Modal>
    </div>
  );
}
