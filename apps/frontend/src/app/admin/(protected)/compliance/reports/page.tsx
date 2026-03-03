'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import {
  SectionHeader,
  Panel,
  DataTableContainer,
  DataTableHead,
  DataTableTh,
  DataTableBody,
  DataTableRow,
  DataTableCell,
  StatusBadge,
  ActionButton,
} from '@/components/admin/control-plane';
import { Loader2, AlertTriangle, ChevronRight } from 'lucide-react';

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

  return (
    <div className="space-y-6">
      <SectionHeader
        title="STR / CTR Reports"
        subtitle="Suspicious and cash transaction reports. Submit or acknowledge from detail."
      />
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 flex items-center gap-3 text-red-200">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Panel>
        <div className="flex flex-wrap gap-3 mb-4">
          <select
            value={reportTypeFilter}
            onChange={(e) => { setReportTypeFilter(e.target.value); setPage(0); }}
            className="rounded-lg border border-gray-600 bg-gray-800 text-gray-200 px-3 py-2 text-sm"
          >
            <option value="">All types</option>
            <option value="STR">STR</option>
            <option value="CTR">CTR</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
            className="rounded-lg border border-gray-600 bg-gray-800 text-gray-200 px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="submitted">Submitted</option>
            <option value="acknowledged">Acknowledged</option>
          </select>
        </div>

        {loading && !reports.length ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
          </div>
        ) : (
          <DataTableContainer>
            <DataTableHead>
              <DataTableRow>
                <DataTableTh>Report ID</DataTableTh>
                <DataTableTh>Type</DataTableTh>
                <DataTableTh>User</DataTableTh>
                <DataTableTh>Period</DataTableTh>
                <DataTableTh>Total</DataTableTh>
                <DataTableTh>Status</DataTableTh>
                <DataTableTh>Created</DataTableTh>
                <DataTableTh className="w-20">{''}</DataTableTh>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {reports.map((r) => (
                <DataTableRow key={r.id}>
                  <DataTableCell className="font-mono text-xs">{r.id.slice(0, 8)}…</DataTableCell>
                  <DataTableCell>{r.report_type}</DataTableCell>
                  <DataTableCell className="font-mono text-xs">{r.user_id ? r.user_id.slice(0, 8) + '…' : '—'}</DataTableCell>
                  <DataTableCell className="text-xs text-gray-400">
                    {r.period_start && r.period_end
                      ? `${new Date(r.period_start).toLocaleDateString()} – ${new Date(r.period_end).toLocaleDateString()}`
                      : '—'}
                  </DataTableCell>
                  <DataTableCell className="font-mono text-xs">{r.total_amount ?? '—'}</DataTableCell>
                  <DataTableCell>
                    <StatusBadge
                      variant={r.status === 'acknowledged' ? 'NEUTRAL' : r.status === 'submitted' ? 'DEGRADED' : 'RISK'}
                      label={r.status}
                      showDot
                    />
                  </DataTableCell>
                  <DataTableCell className="text-gray-400 text-xs">{new Date(r.created_at).toLocaleString()}</DataTableCell>
                  <DataTableCell>
                    <Link href={`/admin/compliance/reports/${r.id}`}>
                      <ActionButton variant="ghost" icon={<ChevronRight className="w-4 h-4" />}>View</ActionButton>
                    </Link>
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTableContainer>
        )}
        {total > limit && (
          <div className="mt-4 flex items-center justify-between text-sm text-gray-400">
            <span>Total {total} reports</span>
            <div className="flex gap-2">
              <ActionButton variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</ActionButton>
              <ActionButton variant="secondary" disabled={(page + 1) * limit >= total} onClick={() => setPage((p) => p + 1)}>Next</ActionButton>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
