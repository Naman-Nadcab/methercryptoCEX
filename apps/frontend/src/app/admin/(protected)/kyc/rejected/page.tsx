'use client';

import { useState, useEffect, useCallback } from 'react';
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
} from '@/components/admin/control-plane';
import { Loader2, AlertTriangle } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface KycApplication {
  id: string;
  user_id: string;
  status: string;
  kyc_level?: number;
  created_at: string;
  reviewed_at?: string | null;
  rejection_reason?: string | null;
  email?: string;
  phone?: string | null;
  username?: string | null;
  [key: string]: unknown;
}

export default function RejectedKYCPage() {
  const { accessToken } = useAdminAuthStore();
  const [applications, setApplications] = useState<KycApplication[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const limit = 20;

  const fetchRejected = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/kyc?page=${page}&limit=${limit}&status=rejected`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Failed to load rejected KYC');
        return;
      }
      const list = data?.data?.applications ?? [];
      setApplications(Array.isArray(list) ? list : []);
      setTotal(data?.data?.pagination?.total ?? list.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [accessToken, page]);

  useEffect(() => {
    fetchRejected();
  }, [fetchRejected]);

  return (
    <div className="space-y-6">
      <SectionHeader title="Rejected KYC" subtitle="Rejected KYC applications (from backend)." />
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 flex items-center gap-3 text-red-200 text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          {error}
        </div>
      )}
      <Panel>
        {loading && !applications.length ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
          </div>
        ) : applications.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No rejected KYC yet</p>
        ) : (
          <DataTableContainer>
            <DataTableHead>
              <DataTableRow>
                <DataTableTh>Application ID</DataTableTh>
                <DataTableTh>User / Email</DataTableTh>
                <DataTableTh>KYC Level</DataTableTh>
                <DataTableTh>Rejection reason</DataTableTh>
                <DataTableTh>Reviewed</DataTableTh>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {applications.map((app) => (
                <DataTableRow key={app.id}>
                  <DataTableCell className="font-mono text-xs">{app.id.slice(0, 8)}…</DataTableCell>
                  <DataTableCell>
                    <span className="text-gray-200">{app.email ?? '—'}</span>
                    {app.user_id && <span className="block text-xs text-gray-500 font-mono">{app.user_id.slice(0, 8)}…</span>}
                  </DataTableCell>
                  <DataTableCell>{app.kyc_level ?? '—'}</DataTableCell>
                  <DataTableCell className="text-gray-400 text-sm max-w-[200px] truncate" title={app.rejection_reason ?? undefined}>
                    {app.rejection_reason ?? '—'}
                  </DataTableCell>
                  <DataTableCell className="text-gray-400 text-xs">
                    {app.reviewed_at ? new Date(app.reviewed_at).toLocaleString() : '—'}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTableContainer>
        )}
        {total > limit && (
          <div className="mt-4 flex justify-between text-sm text-gray-400">
            <span>Total {total}</span>
            <div className="flex gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-2 py-1 rounded bg-gray-800 disabled:opacity-50">Previous</button>
              <button type="button" disabled={page * limit >= total} onClick={() => setPage((p) => p + 1)} className="px-2 py-1 rounded bg-gray-800 disabled:opacity-50">Next</button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
