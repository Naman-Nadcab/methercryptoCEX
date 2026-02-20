'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAdminAuthStore } from '@/store/admin-auth';
import { SectionHeader, Panel, ActionButton } from '@/components/admin/control-plane';
import { ReasonCaptureModal } from '@/components/admin/ReasonCaptureModal';
import { Loader2, ArrowLeft, AlertTriangle, FileWarning } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface AmlAlertDetail {
  id: string;
  user_id: string;
  alert_type: string;
  severity: string;
  status: string;
  details: unknown;
  created_at: string;
}

export default function ComplianceAlertDetailPage() {
  const params = useParams();
  const id = typeof params?.id === 'string' ? params.id : '';
  const { accessToken } = useAdminAuthStore();
  const [alert, setAlert] = useState<AmlAlertDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [statusModal, setStatusModal] = useState<{ status: string } | null>(null);
  const [escalateModal, setEscalateModal] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!accessToken || !id) return;
    setAlert(null);
    setLoading(true);
    setError(null);
    fetch(`${API_URL}/api/v1/admin/aml/alerts/${id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.success && data?.data) setAlert(data.data);
        else setError(data?.error?.message ?? 'Alert not found');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Request failed'))
      .finally(() => setLoading(false));
  }, [accessToken, id]);

  const handleStatusConfirm = async (reason: string) => {
    if (!statusModal || !accessToken) return;
    setStatusError(null);
    setStatusUpdating(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/aml/alerts/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ status: statusModal.status, note: reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusError(data?.error?.message ?? 'Update failed');
        return;
      }
      if (data?.success && alert) setAlert({ ...alert, status: statusModal.status });
      setStatusModal(null);
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleEscalateConfirm = async () => {
    if (!accessToken) return;
    setStatusError(null);
    setEscalating(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/aml/alerts/${id}/escalate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusError(data?.error?.message ?? 'Escalation failed');
        return;
      }
      setEscalateModal(false);
      if (alert) setAlert({ ...alert, status: 'closed' });
    } finally {
      setEscalating(false);
    }
  };

  if (loading && !alert) {
    return (
      <div className="flex items-center justify-center min-h-[320px]">
        <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (error || !alert) {
    return (
      <div className="space-y-4">
        <Link href="/admin/compliance/alerts" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white">
          <ArrowLeft className="w-4 h-4" /> Back to alerts
        </Link>
        <Panel>
          <div className="flex items-center gap-4 p-6 text-red-400">
            <AlertTriangle className="w-10 h-10 shrink-0" />
            <div>
              <p className="font-medium">{error ?? 'Alert not found'}</p>
              <Link href="/admin/compliance/alerts" className="mt-2 inline-block text-amber-400 hover:underline">Back to AML Alerts</Link>
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/compliance/alerts" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white">
          <ArrowLeft className="w-4 h-4" /> Back to alerts
        </Link>
      </div>
      <SectionHeader
        title={`Alert ${alert.id.slice(0, 8)}…`}
        subtitle={`${alert.alert_type} · ${alert.severity} · ${alert.status}`}
      />

      <Panel title="Alert details" subtitle="Full alert record">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase">Alert ID</dt>
            <dd className="mt-1 font-mono text-sm text-gray-200">{alert.id}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase">User ID</dt>
            <dd className="mt-1 font-mono text-sm text-gray-200">{alert.user_id}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase">Type</dt>
            <dd className="mt-1 text-gray-200">{alert.alert_type}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase">Severity</dt>
            <dd className="mt-1 text-gray-200">{alert.severity}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase">Status</dt>
            <dd className="mt-1 text-gray-200">{alert.status}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase">Created</dt>
            <dd className="mt-1 text-gray-400 text-sm">{new Date(alert.created_at).toLocaleString()}</dd>
          </div>
        </dl>
        {alert.details != null && Object.keys(alert.details as object).length > 0 && (
          <div className="mt-4">
            <dt className="text-xs font-medium text-gray-500 uppercase">Details</dt>
            <pre className="mt-1 p-3 rounded-lg bg-gray-800 text-xs text-gray-300 overflow-auto max-h-48">
              {JSON.stringify(alert.details, null, 2)}
            </pre>
          </div>
        )}
      </Panel>

      <Panel title="Actions" subtitle="Update status or escalate to STR">
        <div className="flex flex-wrap gap-2">
          {alert.status !== 'reviewing' && (
            <ActionButton variant="primary" onClick={() => setStatusModal({ status: 'reviewing' })}>
              Mark Reviewing
            </ActionButton>
          )}
          {alert.status !== 'closed' && (
            <ActionButton variant="secondary" onClick={() => setStatusModal({ status: 'closed' })}>
              Mark Closed
            </ActionButton>
          )}
          {alert.status === 'open' && (
            <ActionButton variant="danger" icon={<FileWarning className="w-4 h-4" />} onClick={() => setEscalateModal(true)}>
              Escalate to STR
            </ActionButton>
          )}
        </div>
        {statusError && <p className="mt-3 text-sm text-red-400" role="alert">{statusError}</p>}
      </Panel>

      {statusModal && (
        <ReasonCaptureModal
          open={!!statusModal}
          title={`Set status to ${statusModal.status}`}
          bodyCopy="Provide a note for the audit trail. This will be recorded with the status change."
          reasonLabel="Note (required)"
          reasonPlaceholder="Operator note for status update"
          confirmLabel={`Set ${statusModal.status}`}
          variant="primary"
          onClose={() => { setStatusModal(null); setStatusError(null); }}
          onConfirm={handleStatusConfirm}
          loading={statusUpdating}
          error={statusError}
          context={[{ label: 'Alert ID', value: alert.id.slice(0, 8) + '…' }]}
        />
      )}

      {escalateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 shadow-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-2">Escalate to STR</h2>
            <p className="text-sm text-gray-400 mb-4">This will create an STR report for this alert. Confirm to proceed.</p>
            {statusError && <p className="text-sm text-red-400 mb-3">{statusError}</p>}
            <div className="flex justify-end gap-2">
              <ActionButton variant="secondary" onClick={() => { setEscalateModal(false); setStatusError(null); }}>Cancel</ActionButton>
              <ActionButton variant="danger" loading={escalating} onClick={handleEscalateConfirm}>Escalate to STR</ActionButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
