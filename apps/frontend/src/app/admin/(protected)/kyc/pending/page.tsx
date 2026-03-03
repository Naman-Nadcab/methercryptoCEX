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
  ActionButton,
} from '@/components/admin/control-plane';
import { ReasonCaptureModal } from '@/components/admin/ReasonCaptureModal';
import { Loader2, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface KycApplication {
  id: string;
  user_id: string;
  status: string;
  kyc_level?: number;
  created_at: string;
  email?: string;
  phone?: string | null;
  username?: string | null;
  [key: string]: unknown;
}

export default function PendingKYCPage() {
  const { accessToken } = useAdminAuthStore();
  const [applications, setApplications] = useState<KycApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewModal, setReviewModal] = useState<{ app: KycApplication; action: 'approve' | 'reject' } | null>(null);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fetchPending = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/kyc/pending`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Failed to load pending KYC');
        return;
      }
      setApplications(Array.isArray(data?.data) ? data.data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  const handleReviewConfirm = async (reason: string) => {
    if (!reviewModal || !accessToken) return;
    setSubmitError(null);
    setSubmitLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/kyc/${reviewModal.app.id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ action: reviewModal.action, reason: reason.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data?.error?.message ?? 'Review failed');
        return;
      }
      setReviewModal(null);
      fetchPending();
    } finally {
      setSubmitLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Pending KYC"
        subtitle="KYC applications awaiting review. Approve or reject with reason (audit)."
      />
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 flex items-center gap-3 text-red-200 text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          {error}
        </div>
      )}
      <Panel>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
          </div>
        ) : applications.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No pending KYC applications</p>
        ) : (
          <DataTableContainer>
            <DataTableHead>
              <DataTableRow>
                <DataTableTh>Application ID</DataTableTh>
                <DataTableTh>User / Email</DataTableTh>
                <DataTableTh>KYC Level</DataTableTh>
                <DataTableTh>Submitted</DataTableTh>
                <DataTableTh className="w-40">Actions</DataTableTh>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {applications.map((app) => (
                <DataTableRow key={app.id}>
                  <DataTableCell className="font-mono text-xs">{app.id.slice(0, 8)}…</DataTableCell>
                  <DataTableCell>
                    <span className="text-gray-200">{app.email ?? '—'}</span>
                    {app.user_id && (
                      <span className="block text-xs text-gray-500 font-mono">{app.user_id.slice(0, 8)}…</span>
                    )}
                  </DataTableCell>
                  <DataTableCell>{app.kyc_level ?? '—'}</DataTableCell>
                  <DataTableCell className="text-gray-400 text-xs">
                    {new Date(app.created_at).toLocaleString()}
                  </DataTableCell>
                  <DataTableCell>
                    <div className="flex gap-2">
                      <ActionButton variant="primary" icon={<CheckCircle2 className="w-3 h-3" />} onClick={() => setReviewModal({ app, action: 'approve' })}>
                        Approve
                      </ActionButton>
                      <ActionButton variant="danger" icon={<XCircle className="w-3 h-3" />} onClick={() => setReviewModal({ app, action: 'reject' })}>
                        Reject
                      </ActionButton>
                    </div>
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTableContainer>
        )}
      </Panel>

      {reviewModal && (
        <ReasonCaptureModal
          open={!!reviewModal}
          title={reviewModal.action === 'approve' ? 'Approve KYC' : 'Reject KYC'}
          bodyCopy={reviewModal.action === 'approve' ? 'Approve this KYC application. Optionally add a note.' : 'Reject this KYC application. Reason is required for audit.'}
          reasonLabel={reviewModal.action === 'reject' ? 'Reason (required)' : 'Note (optional)'}
          requireReason={reviewModal.action === 'reject'}
          confirmLabel={reviewModal.action === 'approve' ? 'Approve' : 'Reject'}
          variant={reviewModal.action === 'approve' ? 'primary' : 'danger'}
          onClose={() => { setReviewModal(null); setSubmitError(null); }}
          onConfirm={handleReviewConfirm}
          loading={submitLoading}
          error={submitError}
          context={[
            { label: 'Application', value: reviewModal.app.id.slice(0, 8) + '…' },
            { label: 'User', value: String(reviewModal.app.email ?? reviewModal.app.user_id).slice(0, 24) },
          ]}
        />
      )}
    </div>
  );
}
