'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, AlertTriangle, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { securityApi, type PendingWithdrawalItem, type WithdrawalDetail } from '@/lib/securityApi';
import { formatDateTime } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/toaster';

const WITHLIST_STYLES = {
  allowed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  timelocked: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  not_whitelisted: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
};

const RISK_DECISION_STYLES = {
  allow: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  challenge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  block: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
};

function canApprove(detail: WithdrawalDetail | undefined): boolean {
  if (!detail) return false;
  if (detail.whitelist_status !== 'allowed') return false;
  if (detail.cooldown?.active) return false;
  return true;
}

export interface WithdrawalDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  withdrawal: PendingWithdrawalItem | null;
  /** When true, open the approve sub-dialog as soon as detail is loaded (e.g. when user clicked Approve from table). */
  openApproveOnMount?: boolean;
  onClearApproveOnMount?: () => void;
  onApprove: (id: string, note?: string) => Promise<void>;
  onReject: (id: string, reason: string) => Promise<void>;
  approveLoading?: boolean;
  rejectLoading?: boolean;
}

export function WithdrawalDetailDialog({
  open,
  onOpenChange,
  withdrawal,
  openApproveOnMount = false,
  onClearApproveOnMount,
  onApprove,
  onReject,
  approveLoading = false,
  rejectLoading = false,
}: WithdrawalDetailDialogProps) {
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [approveNote, setApproveNote] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  const id = withdrawal?.id ?? '';
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['admin', 'security', 'withdrawal', id],
    queryFn: () => securityApi.getWithdrawal(id),
    enabled: open && Boolean(id),
  });

  const safeToApprove = canApprove(detail);
  const showSecurityWarning = detail && (detail.whitelist_status !== 'allowed' || detail.cooldown?.active);

  // When opened from table "Approve", open the approve sub-dialog once detail is loaded.
  useEffect(() => {
    if (open && openApproveOnMount && detail && !detailLoading) {
      setApproveDialogOpen(true);
      onClearApproveOnMount?.();
    }
  }, [open, openApproveOnMount, detail, detailLoading, onClearApproveOnMount]);

  const handleCopyAddress = () => {
    if (detail?.to_address) {
      void navigator.clipboard.writeText(detail.to_address);
      toast({ title: 'Address copied', variant: 'success' });
    }
  };

  const handleApproveClick = () => {
    setApproveNote('');
    setApproveDialogOpen(true);
  };

  const handleApproveConfirm = async () => {
    if (!id) return;
    await onApprove(id, approveNote.trim() || undefined);
    setApproveDialogOpen(false);
    onOpenChange(false);
  };

  const handleRejectClick = () => {
    setRejectReason('');
    setRejectDialogOpen(true);
  };

  const handleRejectConfirm = async () => {
    const reason = rejectReason.trim();
    if (!reason) return;
    if (!id) return;
    await onReject(id, reason);
    setRejectDialogOpen(false);
    onOpenChange(false);
  };

  if (!withdrawal) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Withdrawal details</DialogTitle>
          </DialogHeader>
          {detailLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : detail ? (
            <>
              <Tabs defaultValue="overview" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="security">Security</TabsTrigger>
                  <TabsTrigger value="risk">Risk Engine</TabsTrigger>
                </TabsList>
                <TabsContent value="overview" className="space-y-3 pt-2">
                  <div>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">User ID</p>
                    <p className="font-mono text-sm text-slate-900 dark:text-white">{detail.user_id}</p>
                  </div>
                  <div className="flex gap-4">
                    <div>
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Asset</p>
                      <p className="text-sm font-medium">{detail.asset ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Amount</p>
                      <p className="text-sm font-medium">{detail.amount}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Destination address</p>
                    <div className="mt-1 flex items-center gap-2">
                      <p className="flex-1 break-all font-mono text-sm text-slate-900 dark:text-white">
                        {detail.to_address ?? '—'}
                      </p>
                      {detail.to_address && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={handleCopyAddress}
                          title="Copy address"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Created at</p>
                    <p className="text-sm text-slate-700 dark:text-slate-300">
                      {formatDateTime(detail.created_at)}
                    </p>
                  </div>
                </TabsContent>
                <TabsContent value="security" className="space-y-4 pt-2">
                  <div>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      Address whitelist status
                    </p>
                    <p className="mt-1">
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
                          detail.whitelist_status
                            ? WITHLIST_STYLES[detail.whitelist_status]
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                        )}
                      >
                        {detail.whitelist_status ?? '—'}
                      </span>
                      {detail.whitelist_status === 'timelocked' && (
                        <span className="ml-2 text-xs text-slate-500">(Unlock time not available)</span>
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      Cooldown status
                    </p>
                    {detail.cooldown?.active ? (
                      <div className="mt-1 space-y-1">
                        <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Active</p>
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                          Reason: {detail.cooldown.reason || '—'}
                        </p>
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                          Until: {formatDateTime(detail.cooldown.until)}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">None</p>
                    )}
                  </div>
                  {showSecurityWarning && (
                    <div
                      role="alert"
                      className="flex items-start gap-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-amber-800 dark:text-amber-200"
                    >
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <p className="text-sm">
                        Do not approve until whitelist is allowed and cooldown is cleared.
                      </p>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="risk" className="space-y-3 pt-2">
                  {detail.latest_risk_decision ? (
                    <>
                      <div>
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                          Latest risk decision
                        </p>
                        <p className="mt-1">
                          <span
                            className={cn(
                              'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
                              RISK_DECISION_STYLES[
                                detail.latest_risk_decision.decision as keyof typeof RISK_DECISION_STYLES
                              ] ?? 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                            )}
                          >
                            {detail.latest_risk_decision.decision}
                          </span>
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Risk score</p>
                        <p className="text-sm font-medium tabular-nums">
                          {detail.latest_risk_decision.score} / 100
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                          Evaluated at
                        </p>
                        <p className="text-sm text-slate-700 dark:text-slate-300">
                          {formatDateTime(detail.latest_risk_decision.created_at)}
                        </p>
                      </div>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        This withdrawal was flagged by the risk engine.
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      No risk decision data available.
                    </p>
                  )}
                </TabsContent>
              </Tabs>
              <DialogFooter className="mt-4 flex gap-2 border-t pt-4">
                <Button
                  variant="destructive"
                  onClick={handleApproveClick}
                  disabled={!safeToApprove || approveLoading}
                >
                  {approveLoading ? 'Approving…' : 'Approve'}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleRejectClick}
                  disabled={rejectLoading}
                >
                  {rejectLoading ? 'Rejecting…' : 'Reject'}
                </Button>
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          ) : (
            <p className="py-6 text-center text-sm text-slate-500">Failed to load details.</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Approve confirmation dialog with optional note */}
      <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm approval</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            You are approving a security-flagged withdrawal. This action cannot be undone.
          </p>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Note (optional)
            </label>
            <textarea
              className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm min-h-[80px]"
              placeholder="Add a note for the audit log"
              value={approveNote}
              onChange={(e) => setApproveNote(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveDialogOpen(false)} disabled={approveLoading}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleApproveConfirm}
              disabled={approveLoading}
            >
              {approveLoading ? 'Approving…' : 'Approve withdrawal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog with required reason */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject withdrawal</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Provide a reason for rejection. This will be recorded and may be shown to the user.
          </p>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm min-h-[100px]"
              placeholder="Enter rejection reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
              required
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)} disabled={rejectLoading}>
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={handleRejectConfirm}
              disabled={!rejectReason.trim() || rejectLoading}
            >
              {rejectLoading ? 'Rejecting…' : 'Reject withdrawal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
