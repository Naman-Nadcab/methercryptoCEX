'use client';

import { useCallback, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { SectionHeader, Panel, ActionButton } from '@/components/admin/control-plane';
import { useP2PDisputes, useResolveP2PDispute, type P2PDisputeRow } from '@/lib/admin-wallets-api';
import { formatAmountAdmin } from '@/lib/utils';
import { Loader2, ArrowLeft, CheckCircle2, XCircle, Ban, AlertTriangle, ExternalLink } from 'lucide-react';

type Resolution = 'favor_buyer' | 'favor_seller' | 'cancelled';

const resolutionLabels: Record<Resolution, string> = {
  favor_buyer: 'Release Escrow (favor buyer)',
  favor_seller: 'Refund Escrow (favor seller)',
  cancelled: 'Force Close (cancel)',
};

export default function P2PDisputeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const disputeId = typeof params.id === 'string' ? params.id : '';
  const { accessToken } = useAdminAuthStore();

  const { data: disputesData, isLoading, refetch } = useP2PDisputes(accessToken);
  const resolveMutation = useResolveP2PDispute(accessToken, disputeId);

  const disputes = (disputesData?.data ?? []) as P2PDisputeRow[];
  const dispute = disputes.find((d) => d.id === disputeId);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [reason, setReason] = useState('');

  const handleResolve = useCallback(() => {
    if (!resolution || !reason.trim()) return;
    resolveMutation.mutate(
      { resolution, notes: reason.trim() },
      {
        onSuccess: (res) => {
          if (res?.success) {
            setConfirmOpen(false);
            setResolution(null);
            setReason('');
            refetch();
            router.push('/admin/p2p/trades');
          }
        },
      }
    );
  }, [resolution, reason, resolveMutation, refetch, router]);

  const errorMsg = resolveMutation.data && !resolveMutation.data.success
    ? resolveMutation.data.error?.message ?? resolveMutation.data.error?.code ?? 'Resolve failed'
    : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (!dispute) {
    return (
      <div className="space-y-4">
        <Link href="/admin/p2p/trades" className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline">
          <ArrowLeft className="w-4 h-4" /> Back to Trades
        </Link>
        <Panel>
          <p className="text-gray-600 dark:text-gray-400">Dispute not found or already resolved. Active disputes are listed on the P2P Disputes list.</p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        title={`Dispute ${dispute.id.slice(0, 8)}…`}
        subtitle="Read-only trade and escrow details. Resolve via state transitions only."
        action={
          <div className="flex items-center gap-2">
            <Link
              href="/admin/p2p/trades"
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Trades
            </Link>
          </div>
        }
      />

      <Panel>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Trade participants & terms</h3>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div><dt className="text-gray-500 dark:text-gray-400">Order ID</dt><dd><Link href="/admin/p2p/trades" className="font-mono text-blue-600 dark:text-blue-400 hover:underline">{dispute.order_id}</Link></dd></div>
          <div><dt className="text-gray-500 dark:text-gray-400">Dispute status</dt><dd className="text-gray-900 dark:text-white">{dispute.status}</dd></div>
          <div><dt className="text-gray-500 dark:text-gray-400">Buyer</dt><dd>{(dispute as unknown as { buyer_id?: string }).buyer_id ? <Link href={`/admin/users/${(dispute as unknown as { buyer_id: string }).buyer_id}`} className="text-blue-600 dark:text-blue-400 hover:underline">{dispute.buyer_email ?? dispute.buyer_username ?? '—'}</Link> : (dispute.buyer_email ?? dispute.buyer_username ?? '—')}</dd></div>
          <div><dt className="text-gray-500 dark:text-gray-400">Seller</dt><dd>{(dispute as unknown as { seller_id?: string }).seller_id ? <Link href={`/admin/users/${(dispute as unknown as { seller_id: string }).seller_id}`} className="text-blue-600 dark:text-blue-400 hover:underline">{dispute.seller_email ?? dispute.seller_username ?? '—'}</Link> : (dispute.seller_email ?? dispute.seller_username ?? '—')}</dd></div>
          <div><dt className="text-gray-500 dark:text-gray-400">Crypto amount</dt><dd className="font-mono text-gray-900 dark:text-white">{formatAmountAdmin(dispute.crypto_amount ?? '0')}</dd></div>
          <div><dt className="text-gray-500 dark:text-gray-400">Fiat</dt><dd className="text-gray-900 dark:text-white">{dispute.fiat_amount ?? '—'} {dispute.fiat_currency ?? ''}</dd></div>
          <div><dt className="text-gray-500 dark:text-gray-400">Created</dt><dd className="text-gray-900 dark:text-white">{new Date(dispute.created_at).toLocaleString()}</dd></div>
          {dispute.reason && <div className="sm:col-span-2"><dt className="text-gray-500 dark:text-gray-400">Reason</dt><dd className="text-gray-900 dark:text-white">{dispute.reason}</dd></div>}
        </dl>
      </Panel>

      <Panel>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Evidence & chat</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">Evidence uploads and chat history are shown here when provided by the backend. Use resolve actions below to approve buyer, approve seller, or release escrow.</p>
      </Panel>

      <Panel>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Escrow state</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">Escrow is held until dispute is resolved. Use actions below to release (favor buyer), refund (favor seller), or cancel.</p>
        <Link href={`/admin/p2p/escrows?order_id=${dispute.order_id}`} className="inline-flex items-center gap-1 mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline">
          View Escrow <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </Panel>

      <Panel>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Resolve dispute</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Choose a resolution and provide a mandatory operator reason. These are state transitions; balances are updated by the backend.</p>
        <div className="flex flex-wrap gap-2">
          <ActionButton
            variant="primary"
            icon={<CheckCircle2 className="w-4 h-4" />}
            onClick={() => { setResolution('favor_buyer'); setReason(''); setConfirmOpen(true); }}
            disabled={resolveMutation.isPending}
          >
            Release Escrow
          </ActionButton>
          <ActionButton
            variant="secondary"
            icon={<XCircle className="w-4 h-4" />}
            onClick={() => { setResolution('favor_seller'); setReason(''); setConfirmOpen(true); }}
            disabled={resolveMutation.isPending}
          >
            Refund Escrow
          </ActionButton>
          <ActionButton
            variant="danger"
            icon={<Ban className="w-4 h-4" />}
            onClick={() => { setResolution('cancelled'); setReason(''); setConfirmOpen(true); }}
            disabled={resolveMutation.isPending}
          >
            Force Close
          </ActionButton>
        </div>
      </Panel>

      {confirmOpen && resolution && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true" aria-labelledby="resolve-dispute-title">
          <div className="w-full max-w-md rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
              <h2 id="resolve-dispute-title" className="text-sm font-semibold text-gray-900 dark:text-white">
                {resolutionLabels[resolution]}
              </h2>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <p className="text-gray-600 dark:text-gray-400">Operator reason is required. This action is idempotent-safe.</p>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Reason (required)</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Operator reason for this resolution"
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400"
                />
              </div>
              {errorMsg && <p className="text-xs text-red-600 dark:text-red-400" role="alert">{errorMsg}</p>}
            </div>
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <ActionButton variant="secondary" onClick={() => { setConfirmOpen(false); setResolution(null); setReason(''); resolveMutation.reset(); }}>Cancel</ActionButton>
              <ActionButton
                variant={resolution === 'favor_buyer' ? 'primary' : resolution === 'cancelled' ? 'danger' : 'secondary'}
                loading={resolveMutation.isPending}
                disabled={!reason.trim()}
                onClick={handleResolve}
              >
                Confirm
              </ActionButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
