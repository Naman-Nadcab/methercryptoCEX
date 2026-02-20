'use client';

import { useState, useRef } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { SectionHeader, Panel, ActionButton } from '@/components/admin/control-plane';
import { useManualCredit } from '@/lib/admin-wallets-api';
import { AlertCircle, CheckCircle2, Loader2, Minus, Plus } from 'lucide-react';

export default function WalletsAdjustPage() {
  const { accessToken } = useAdminAuthStore();
  const [userId, setUserId] = useState('');
  const [asset, setAsset] = useState('');
  const [adjustmentType, setAdjustmentType] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const submittedRef = useRef(false);

  const manualCreditMutation = useManualCredit(accessToken);

  const amountNum = parseFloat(amount);
  const isValidAmount = amount.trim() !== '' && !isNaN(amountNum) && amountNum > 0;
  const canSubmit = userId.trim() !== '' && asset.trim() !== '' && isValidAmount && reason.trim() !== '' && adjustmentType === 'credit';
  const isPending = manualCreditMutation.isPending;
  const preventDuplicate = submittedRef.current || isPending;

  const handleOpenConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    if (!canSubmit || preventDuplicate) return;
    submittedRef.current = true;
    const idempotencyKey = `adjust-${userId.trim()}-${asset.trim()}-${amount.trim()}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    manualCreditMutation.mutate(
      {
        user: userId.trim(),
        currency: asset.trim(),
        amount: amount.trim(),
        reason: reason.trim(),
        idempotencyKey,
      },
      {
        onSettled: () => {
          submittedRef.current = false;
        },
        onSuccess: (res) => {
          if (res?.success) {
            setConfirmOpen(false);
            setAmount('');
            setReason('');
          }
        },
      }
    );
  };

  const errorMsg = manualCreditMutation.data && !manualCreditMutation.data.success
    ? manualCreditMutation.data.error?.message ?? manualCreditMutation.data.error?.code ?? 'Request failed'
    : null;
  const success = manualCreditMutation.data?.success === true;

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Balance Adjustment Tool"
        subtitle="Credit via backend ledger only. No direct user_balances updates. Debit is not available with current API."
      />

      <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="text-sm text-amber-800 dark:text-amber-200">
          <p className="font-medium">Backend mutation only</p>
          <p className="mt-1">Adjustments use the existing ledger mechanism. Duplicate submissions are prevented via idempotency. Debit requires a separate backend endpoint (not implemented).</p>
        </div>
      </div>

      <Panel>
        <form onSubmit={handleOpenConfirm} className="max-w-lg space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">User ID or Email (required)</label>
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="user@example.com or UUID"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Asset / Currency (symbol, required)</label>
            <input
              type="text"
              value={asset}
              onChange={(e) => setAsset(e.target.value)}
              placeholder="e.g. USDT, BTC"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Adjustment type</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="type" checked={adjustmentType === 'credit'} onChange={() => setAdjustmentType('credit')} className="rounded" />
                <Plus className="w-4 h-4 text-emerald-500" />
                <span>Credit</span>
              </label>
              <label className="flex items-center gap-2 text-gray-400 cursor-not-allowed">
                <input type="radio" name="type" checked={adjustmentType === 'debit'} onChange={() => {}} disabled className="rounded" />
                <Minus className="w-4 h-4 text-red-500" />
                <span>Debit (not available)</span>
              </label>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount (positive number, required)</label>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
            />
            {amount.trim() && !isValidAmount && <p className="text-xs text-red-600 dark:text-red-400 mt-1">Enter a positive number.</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reason (required)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Operator reason for this adjustment"
              rows={3}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
            />
          </div>
          {errorMsg && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{errorMsg}</p>}
          {success && <p className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-1" role="status"><CheckCircle2 className="w-4 h-4" /> Adjustment submitted successfully.</p>}
          <ActionButton type="submit" variant="primary" disabled={!canSubmit}>
            Submit adjustment
          </ActionButton>
        </form>
      </Panel>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true" aria-labelledby="adjust-confirm-title">
          <div className="w-full max-w-md rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h2 id="adjust-confirm-title" className="text-sm font-semibold text-gray-900 dark:text-white">Confirm balance adjustment</h2>
            </div>
            <div className="p-4 space-y-2 text-sm">
              <p className="text-gray-600 dark:text-gray-400">This will credit the user via the backend ledger. Confirm details:</p>
              <div className="rounded-lg bg-gray-100 dark:bg-gray-800 p-3 space-y-1">
                <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">User</span><span className="text-gray-900 dark:text-white">{userId.trim()}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Currency</span><span className="text-gray-900 dark:text-white">{asset.trim()}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Amount</span><span className="font-mono text-gray-900 dark:text-white">{amount.trim()}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Reason</span><span className="text-gray-900 dark:text-white truncate max-w-[200px]" title={reason.trim()}>{reason.trim()}</span></div>
              </div>
              {errorMsg && <p className="text-xs text-red-600 dark:text-red-400">{errorMsg}</p>}
            </div>
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <ActionButton variant="secondary" onClick={() => setConfirmOpen(false)} disabled={isPending}>Cancel</ActionButton>
              <ActionButton variant="primary" onClick={handleConfirm} loading={isPending} disabled={preventDuplicate}>
                Confirm
              </ActionButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
