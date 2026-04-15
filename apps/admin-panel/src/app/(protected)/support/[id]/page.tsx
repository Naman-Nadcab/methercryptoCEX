'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { adminFetch } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import {
  ArrowLeft, Send, UserCircle, ShieldCheck,
  CheckCircle, Clock, AlertTriangle,
} from 'lucide-react';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';

interface Ticket {
  id: string;
  user_id: string;
  user_email: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  assigned_admin_id: string | null;
  assigned_admin_name: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
}

interface TicketMessage {
  id: string;
  sender_type: string;
  sender_id: string;
  sender_name: string | null;
  message: string;
  attachments: unknown;
  created_at: string;
}

const PRIORITY_BADGE: Record<string, BadgeVariant> = {
  urgent: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'default',
};

const STATUS_BADGE: Record<string, BadgeVariant> = {
  open: 'info',
  in_progress: 'primary',
  waiting_user: 'warning',
  resolved: 'success',
  closed: 'default',
};

const STATUS_OPTIONS = ['open', 'in_progress', 'waiting_user', 'resolved', 'closed'];
const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'urgent'];

function formatFull(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const ticketId = params.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const token = useAdminAuthStore((s) => s.accessToken);
  const admin = useAdminAuthStore((s) => s.admin);

  const [replyText,   setReplyText]   = useState('');
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveNote, setResolveNote] = useState('');
  const [replyError,  setReplyError]  = useState('');
  const [updateError, setUpdateError] = useState('');

  const queryKey = ['admin', 'support-ticket', ticketId, token];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      adminFetch<{ ticket: Ticket; messages: TicketMessage[] }>(`/support/tickets/${ticketId}`, { token }),
    enabled: !!token && !!ticketId,
    refetchInterval: 10_000,
  });
  const ticket = data?.data?.ticket;
  const messages = data?.data?.messages ?? [];

  const replyMutation = useMutation({
    mutationFn: (message: string) =>
      adminFetch('/support/tickets/' + ticketId + '/reply', {
        token,
        method: 'POST',
        body: { message },
      }),
    onSuccess: () => {
      setReplyText('');
      setReplyError('');
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (e: unknown) => setReplyError((e as { message?: string })?.message ?? 'Failed to send reply. Please try again.'),
  });

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      adminFetch('/support/tickets/' + ticketId, {
        token,
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      setUpdateError('');
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['admin', 'support-stats'] });
    },
    onError: (e: unknown) => setUpdateError((e as { message?: string })?.message ?? 'Update failed. Please try again.'),
  });

  function handleAssignToMe() {
    if (!admin) return;
    updateMutation.mutate({ assigned_admin_id: admin.id, status: 'in_progress' });
  }

  function handleStatusChange(status: string) {
    updateMutation.mutate({ status });
  }

  function handlePriorityChange(priority: string) {
    updateMutation.mutate({ priority });
  }

  function handleResolve() {
    updateMutation.mutate(
      { status: 'resolved', resolution_note: resolveNote || undefined },
      { onSuccess: () => setResolveOpen(false) }
    );
  }

  function handleSendReply() {
    if (!replyText.trim()) return;
    replyMutation.mutate(replyText.trim());
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-admin-muted">
        <div className="h-8 w-8 shrink-0 animate-spin rounded-full border-4 border-admin-primary border-t-transparent" />
        <span>Loading ticket…</span>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="space-y-4">
        <button onClick={() => router.push('/support')} className="flex items-center gap-1 text-sm text-admin-muted hover:text-admin-text">
          <ArrowLeft className="h-4 w-4" /> Back to tickets
        </button>
        <Card className="py-12 text-center text-admin-muted">Ticket not found</Card>
      </div>
    );
  }

  const isTerminal = ticket.status === 'resolved' || ticket.status === 'closed';

  return (
    <AdminPageFrame title={ticket.subject}>
    <div className="space-y-6">
      {/* Back link */}
      <button onClick={() => router.push('/support')} className="flex items-center gap-1 text-sm text-admin-muted hover:text-admin-text transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to tickets
      </button>

      {/* Ticket header */}
      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-admin-text">{ticket.subject}</h1>
            <p className="mt-1 text-xs text-admin-muted">
              Ticket {ticket.id.slice(0, 8)} &middot; {ticket.user_email} &middot; Created {formatFull(ticket.created_at)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={PRIORITY_BADGE[ticket.priority] ?? 'default'}>{ticket.priority}</Badge>
            <Badge variant={STATUS_BADGE[ticket.status] ?? 'default'} badgeStyle="dot">{ticket.status.replace(/_/g, ' ')}</Badge>
            <Badge variant="default" badgeStyle="outline">{ticket.category}</Badge>
          </div>
        </div>

        {/* Actions row */}
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-admin-border pt-4">
          {!ticket.assigned_admin_id && (
            <Button size="sm" variant="primary" onClick={handleAssignToMe} loading={updateMutation.isPending}>
              Assign to me
            </Button>
          )}
          {ticket.assigned_admin_id && (
            <span className="text-xs text-admin-muted">
              Assigned to <span className="font-medium text-admin-text">{ticket.assigned_admin_name ?? 'Admin'}</span>
            </span>
          )}

          <div className="flex items-center gap-1.5">
            <label className="text-xs text-admin-muted">Status:</label>
            <select
              value={ticket.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              disabled={updateMutation.isPending}
              className="h-8 rounded-ds-md border border-admin-border bg-admin-card px-2 text-xs text-admin-text focus:outline-none focus:ring-2 focus:ring-admin-primary"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <label className="text-xs text-admin-muted">Priority:</label>
            <select
              value={ticket.priority}
              onChange={(e) => handlePriorityChange(e.target.value)}
              disabled={updateMutation.isPending}
              className="h-8 rounded-ds-md border border-admin-border bg-admin-card px-2 text-xs text-admin-text focus:outline-none focus:ring-2 focus:ring-admin-primary"
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          {!isTerminal && (
            <Button size="sm" variant="success" icon={<CheckCircle className="h-3.5 w-3.5" />} onClick={() => setResolveOpen(true)}>
              Resolve
            </Button>
          )}
        </div>

        {ticket.resolution_note && (
          <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-950/10 px-4 py-3 text-sm text-emerald-300">
            <span className="font-semibold">Resolution note:</span> {ticket.resolution_note}
          </div>
        )}
        {updateError && (
          <div className="mt-3 rounded-lg border border-red-500/25 bg-red-950/10 px-4 py-2 text-xs text-red-400">{updateError}</div>
        )}
      </Card>

      {/* Message thread */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-admin-text">Conversation ({messages.length})</h2>

        {messages.length === 0 && (
          <Card className="py-8 text-center text-admin-muted text-sm">No messages yet</Card>
        )}

        {messages.map((msg) => {
          const isAdmin = msg.sender_type === 'admin';
          return (
            <div key={msg.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[70%] rounded-xl px-4 py-3 ${isAdmin ? 'bg-admin-primary/5 border border-admin-primary/20' : 'bg-white/[0.02] border border-admin-border'}`}>
                <div className="mb-1 flex items-center gap-1.5">
                  {isAdmin ? (
                    <ShieldCheck className="h-3.5 w-3.5 text-admin-primary" />
                  ) : (
                    <UserCircle className="h-3.5 w-3.5 text-admin-muted" />
                  )}
                  <span className="text-xs font-medium text-admin-text">{msg.sender_name ?? (isAdmin ? 'Admin' : 'User')}</span>
                  <span className="text-[10px] text-admin-muted">{formatFull(msg.created_at)}</span>
                </div>
                <p className="text-sm text-admin-text whitespace-pre-wrap">{msg.message}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Reply area */}
      {!isTerminal && (
        <Card>
          <Textarea
            placeholder="Type your reply…"
            value={replyText}
            onChange={(e) => { setReplyText(e.target.value); if (replyError) setReplyError(''); }}
            rows={3}
          />
          {replyError && (
            <p className="mt-2 rounded-lg border border-red-500/25 bg-red-950/10 px-3 py-2 text-xs text-red-400">{replyError}</p>
          )}
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              onClick={handleSendReply}
              loading={replyMutation.isPending}
              disabled={!replyText.trim()}
              icon={<Send className="h-3.5 w-3.5" />}
            >
              Send Reply
            </Button>
          </div>
        </Card>
      )}

      {/* Resolve modal */}
      <Modal open={resolveOpen} onClose={() => setResolveOpen(false)} title="Resolve Ticket" size="sm">
        <Textarea
          label="Resolution note (optional)"
          placeholder="Describe how the issue was resolved…"
          value={resolveNote}
          onChange={(e) => setResolveNote(e.target.value)}
          rows={3}
        />
        <ModalFooter>
          <Button variant="ghost" size="sm" onClick={() => setResolveOpen(false)}>Cancel</Button>
          <Button size="sm" variant="success" loading={updateMutation.isPending} onClick={handleResolve}>
            Mark Resolved
          </Button>
        </ModalFooter>
      </Modal>
    </div>
    </AdminPageFrame>
  );
}
