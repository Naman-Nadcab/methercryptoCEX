'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAdminAuthStore } from '@/store/admin-auth';
import { SectionHeader, Panel, ActionButton } from '@/components/admin/control-plane';
import { Loader2, ArrowLeft, AlertTriangle, Send, CheckCircle } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface ReportDetail {
  id: string;
  report_type: string;
  user_id: string | null;
  period_start: string | null;
  period_end: string | null;
  total_amount: string | null;
  status: string;
  payload: unknown;
  created_at: string;
}

export default function ComplianceReportDetailPage() {
  const params = useParams();
  const id = typeof params?.id === 'string' ? params.id : '';
  const { accessToken } = useAdminAuthStore();
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken || !id) return;
    setLoading(true);
    setError(null);
    fetch(`${API_URL}/api/v1/admin/aml/reports/${id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.success && data?.data) setReport(data.data);
        else setError(data?.error?.message ?? 'Report not found');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Request failed'))
      .finally(() => setLoading(false));
  }, [accessToken, id]);

  const handleSubmit = async () => {
    if (!accessToken || !id) return;
    setActionError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/aml/reports/${id}/submit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data?.error?.message ?? 'Submit failed');
        return;
      }
      if (data?.success && report) setReport({ ...report, status: 'submitted' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleAcknowledge = async () => {
    if (!accessToken || !id) return;
    setActionError(null);
    setAcknowledging(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/aml/reports/${id}/acknowledge`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data?.error?.message ?? 'Acknowledge failed');
        return;
      }
      if (data?.success && report) setReport({ ...report, status: 'acknowledged' });
    } finally {
      setAcknowledging(false);
    }
  };

  if (loading && !report) {
    return (
      <div className="flex items-center justify-center min-h-[320px]">
        <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="space-y-4">
        <Link href="/admin/compliance/reports" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white">
          <ArrowLeft className="w-4 h-4" /> Back to reports
        </Link>
        <Panel>
          <div className="flex items-center gap-4 p-6 text-red-400">
            <AlertTriangle className="w-10 h-10 shrink-0" />
            <span>{error ?? 'Report not found'}</span>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/admin/compliance/reports" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white">
        <ArrowLeft className="w-4 h-4" /> Back to reports
      </Link>
      <SectionHeader
        title={`${report.report_type} Report ${report.id.slice(0, 8)}…`}
        subtitle={`Status: ${report.status}`}
      />

      <Panel title="Report details">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><dt className="text-xs text-gray-500 uppercase">ID</dt><dd className="mt-1 font-mono text-sm text-gray-200">{report.id}</dd></div>
          <div><dt className="text-xs text-gray-500 uppercase">Type</dt><dd className="mt-1 text-gray-200">{report.report_type}</dd></div>
          <div><dt className="text-xs text-gray-500 uppercase">User ID</dt><dd className="mt-1 font-mono text-sm text-gray-200">{report.user_id ?? '—'}</dd></div>
          <div><dt className="text-xs text-gray-500 uppercase">Period</dt><dd className="mt-1 text-gray-400 text-sm">{report.period_start && report.period_end ? `${new Date(report.period_start).toLocaleDateString()} – ${new Date(report.period_end).toLocaleDateString()}` : '—'}</dd></div>
          <div><dt className="text-xs text-gray-500 uppercase">Total amount</dt><dd className="mt-1 font-mono text-gray-200">{report.total_amount ?? '—'}</dd></div>
          <div><dt className="text-xs text-gray-500 uppercase">Status</dt><dd className="mt-1 text-gray-200">{report.status}</dd></div>
          <div><dt className="text-xs text-gray-500 uppercase">Created</dt><dd className="mt-1 text-gray-400 text-sm">{new Date(report.created_at).toLocaleString()}</dd></div>
        </dl>
        {report.payload != null && Object.keys(report.payload as object).length > 0 && (
          <div className="mt-4">
            <dt className="text-xs text-gray-500 uppercase">Payload</dt>
            <pre className="mt-1 p-3 rounded-lg bg-gray-800 text-xs text-gray-300 overflow-auto max-h-48">{JSON.stringify(report.payload, null, 2)}</pre>
          </div>
        )}
      </Panel>

      <Panel title="Actions" subtitle="Submit or acknowledge per workflow">
        {actionError && <p className="text-sm text-red-400 mb-3" role="alert">{actionError}</p>}
        <div className="flex flex-wrap gap-2">
          {report.status === 'pending' && (
            <ActionButton variant="primary" icon={<Send className="w-4 h-4" />} loading={submitting} onClick={handleSubmit}>
              Mark Submitted
            </ActionButton>
          )}
          {report.status === 'submitted' && (
            <ActionButton variant="primary" icon={<CheckCircle className="w-4 h-4" />} loading={acknowledging} onClick={handleAcknowledge}>
              Mark Acknowledged
            </ActionButton>
          )}
        </div>
      </Panel>
    </div>
  );
}
