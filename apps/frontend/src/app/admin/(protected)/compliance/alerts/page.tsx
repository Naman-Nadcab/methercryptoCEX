'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAdminAuthStore } from '@/store/admin-auth';
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

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

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

  const severityVariant = (s: string): 'LIVE' | 'DEGRADED' | 'RISK' | 'NEUTRAL' =>
    s === 'high' ? 'RISK' : s === 'medium' ? 'DEGRADED' : 'NEUTRAL';

  return (
    <div className="space-y-6">
      <SectionHeader
        title="AML Alerts"
        subtitle="Review and escalate alerts. Update status or escalate to STR."
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
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
            className="rounded-lg border border-gray-600 bg-gray-800 text-gray-200 px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="reviewing">Reviewing</option>
            <option value="closed">Closed</option>
          </select>
          <select
            value={severityFilter}
            onChange={(e) => { setSeverityFilter(e.target.value); setPage(0); }}
            className="rounded-lg border border-gray-600 bg-gray-800 text-gray-200 px-3 py-2 text-sm"
          >
            <option value="">All severities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>

        {loading && !alerts.length ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
          </div>
        ) : (
          <DataTableContainer>
            <DataTableHead>
              <DataTableRow>
                <DataTableTh>Alert ID</DataTableTh>
                <DataTableTh>User</DataTableTh>
                <DataTableTh>Type</DataTableTh>
                <DataTableTh>Severity</DataTableTh>
                <DataTableTh>Status</DataTableTh>
                <DataTableTh>Created</DataTableTh>
                <DataTableTh className="w-20">{''}</DataTableTh>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {alerts.map((a) => (
                <DataTableRow key={a.id}>
                  <DataTableCell className="font-mono text-xs">{a.id.slice(0, 8)}…</DataTableCell>
                  <DataTableCell className="font-mono text-xs">{a.user_id.slice(0, 8)}…</DataTableCell>
                  <DataTableCell>{a.alert_type}</DataTableCell>
                  <DataTableCell>
                    <StatusBadge variant={severityVariant(a.severity)} label={a.severity} showDot />
                  </DataTableCell>
                  <DataTableCell>
                    <StatusBadge
                      variant={a.status === 'closed' ? 'NEUTRAL' : a.status === 'reviewing' ? 'DEGRADED' : 'RISK'}
                      label={a.status}
                      showDot
                    />
                  </DataTableCell>
                  <DataTableCell className="text-gray-400 text-xs">
                    {new Date(a.created_at).toLocaleString()}
                  </DataTableCell>
                  <DataTableCell>
                    <Link href={`/admin/compliance/alerts/${a.id}`}>
                      <ActionButton variant="ghost" icon={<ChevronRight className="w-4 h-4" />}>
                        View
                      </ActionButton>
                    </Link>
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTableContainer>
        )}
        {total > limit && (
          <div className="mt-4 flex items-center justify-between text-sm text-gray-400">
            <span>Total {total} alerts</span>
            <div className="flex gap-2">
              <ActionButton variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </ActionButton>
              <ActionButton variant="secondary" disabled={(page + 1) * limit >= total} onClick={() => setPage((p) => p + 1)}>
                Next
              </ActionButton>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
