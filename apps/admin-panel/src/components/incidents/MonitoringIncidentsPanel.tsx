'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  getMonitoringIncidents,
  type IncidentRow,
} from '@/lib/monitoring-api';
import {
  createControlIncident,
  acknowledgeControlIncident,
  resolveControlIncident,
} from '@/lib/control-api';
import { TableSkeleton } from '@/components/ui/Skeleton';
import {
  Siren, Eye, CheckCircle2, Search, Plus, X,
  Clock, AlertTriangle, ChevronDown, ChevronRight,
  Shield, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/cn';

const STATUS_TABS = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'acknowledged', label: 'Acknowledged' },
  { id: 'resolved', label: 'Resolved' },
] as const;

const SEVERITY_STYLES: Record<string, { dot: string; badge: string; text: string }> = {
  critical: { dot: 'bg-red-500', badge: 'bg-red-500/10 text-red-400 border-red-500/30', text: 'text-red-400' },
  high: { dot: 'bg-orange-500', badge: 'bg-orange-500/10 text-orange-400 border-orange-500/30', text: 'text-orange-400' },
  warning: { dot: 'bg-amber-500', badge: 'bg-amber-500/10 text-amber-400 border-amber-500/30', text: 'text-amber-400' },
  medium: { dot: 'bg-amber-500', badge: 'bg-amber-500/10 text-amber-400 border-amber-500/30', text: 'text-amber-400' },
  info: { dot: 'bg-blue-500', badge: 'bg-blue-500/10 text-blue-400 border-blue-500/30', text: 'text-blue-400' },
  low: { dot: 'bg-blue-500', badge: 'bg-blue-500/10 text-blue-400 border-blue-500/30', text: 'text-blue-400' },
};

const STATUS_ICON: Record<string, typeof Siren> = {
  open: Siren,
  acknowledged: Eye,
  resolved: CheckCircle2,
};

const SERVICE_OPTIONS = [
  'matching_engine', 'settlement', 'wallets', 'api_gateway', 'websocket',
  'database', 'redis', 'rpc_provider', 'kyc', 'security', 'other',
];
const PAGE_SIZE = 20;

function getSeverity(s: string) {
  return SEVERITY_STYLES[s.toLowerCase()] ?? SEVERITY_STYLES.info;
}

function timeSince(dateStr: string | null): string {
  if (!dateStr) return '—';
  const diff = Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function durationBetween(start: string | null, end: string | null): string {
  if (!start) return '—';
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const diff = Math.max(0, Math.floor((e - s) / 1000));
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    const s2 = diff % 60;
    return s2 > 0 ? `${m}m ${s2}s` : `${m}m`;
  }
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function MonitoringIncidentsPanel() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'monitoring-incidents', token, status, page],
    queryFn: () =>
      getMonitoringIncidents(token, {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        status: status === 'all' ? undefined : status,
      }),
    enabled: !!token,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const incidents = (data?.data?.incidents ?? []) as IncidentRow[];
  const total = data?.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const inc of incidents) {
      c[inc.status] = (c[inc.status] ?? 0) + 1;
    }
    return c;
  }, [incidents]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ predicate: (q) => {
      const k = q.queryKey as string[];
      return k[0] === 'admin' && (k[1] === 'monitoring-incidents' || k[1] === 'control-incidents');
    }});
  }, [queryClient]);

  const ackMutation = useMutation({
    mutationFn: (id: string) => acknowledgeControlIncident(token, id),
    onSuccess: () => { invalidate(); showToast('success', 'Incident acknowledged'); },
    onError: () => showToast('error', 'Failed to acknowledge'),
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => resolveControlIncident(token, id),
    onSuccess: () => { invalidate(); showToast('success', 'Incident resolved'); },
    onError: () => showToast('error', 'Failed to resolve'),
  });

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <section className="space-y-4">
      {/* Toast */}
      {toast && (
        <div className={cn(
          'fixed top-4 right-4 z-50 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-medium shadow-lg animate-in slide-in-from-top-2',
          toast.type === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-red-500/30 bg-red-500/10 text-red-400'
        )}>
          {toast.type === 'success' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          {toast.msg}
        </div>
      )}

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {STATUS_TABS.map((tab) => {
          const count = tab.id === 'all' ? total : (counts[tab.id] ?? 0);
          const isActive = status === tab.id;
          const colors = tab.id === 'open'
            ? 'border-red-500/40 bg-red-500/5 ring-red-500/20'
            : tab.id === 'acknowledged'
              ? 'border-amber-500/40 bg-amber-500/5 ring-amber-500/20'
              : tab.id === 'resolved'
                ? 'border-emerald-500/40 bg-emerald-500/5 ring-emerald-500/20'
                : 'border-admin-primary/40 bg-admin-primary/5 ring-admin-primary/20';
          return (
            <button key={tab.id} onClick={() => { setStatus(tab.id); setPage(1); }}
              className={cn(
                'flex items-center gap-3 rounded-xl border p-3.5 transition-all',
                isActive ? `${colors} ring-1` : 'border-admin-border bg-admin-card hover:border-admin-border/80'
              )}>
              <div className="text-left">
                <p className="text-2xl font-bold tabular-nums text-admin-text">{count}</p>
                <p className="text-[10px] font-medium uppercase tracking-wider text-admin-muted">{tab.label}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-admin-border bg-admin-card px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-admin-primary" />
          <span className="text-xs font-semibold text-admin-text">Database Incidents</span>
          <span className="text-[10px] text-admin-muted tabular-nums">({total} total)</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()}
            className="flex items-center gap-1.5 rounded-lg border border-admin-border px-2.5 py-1.5 text-[11px] font-medium text-admin-muted hover:bg-white/5 hover:text-admin-text transition-colors">
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-lg bg-admin-primary/15 px-3 py-1.5 text-[11px] font-semibold text-admin-primary hover:bg-admin-primary/25 transition-colors">
            <Plus className="h-3 w-3" /> Create Incident
          </button>
        </div>
      </div>

      {/* Incident List */}
      <div className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
        {isLoading ? (
          <div className="p-4"><TableSkeleton rows={5} cols={5} /></div>
        ) : isError ? (
          <div className="px-4 py-12 text-center">
            <AlertTriangle className="h-6 w-6 mx-auto mb-2 text-red-400" />
            <p className="text-xs text-red-400 font-medium">Failed to load incidents</p>
            <button onClick={() => refetch()} className="mt-2 text-[11px] text-admin-primary hover:underline">
              Retry
            </button>
          </div>
        ) : incidents.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <Shield className="h-8 w-8 mx-auto mb-3 text-admin-muted/50" />
            <p className="text-sm font-medium text-admin-muted">No incidents found</p>
            <p className="text-[11px] text-admin-muted/70 mt-1 max-w-sm mx-auto">
              {status === 'all'
                ? 'All clear. Incidents will appear here when created manually or triggered by alert rules.'
                : `No ${status} incidents at the moment.`}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-admin-border/60">
            {incidents.map((row) => (
              <IncidentRow
                key={row.id}
                row={row}
                isExpanded={expandedId === row.id}
                onToggle={() => setExpandedId(expandedId === row.id ? null : row.id)}
                onAcknowledge={() => ackMutation.mutate(row.id)}
                onResolve={() => resolveMutation.mutate(row.id)}
                isPending={ackMutation.isPending || resolveMutation.isPending}
              />
            ))}
          </div>
        )}
        {!isLoading && !isError && total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-admin-border/60 px-4 py-3 text-[11px] text-admin-muted">
            <span>
              {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded border border-admin-border px-2 py-1 disabled:opacity-40 hover:text-admin-text"
              >
                Prev
              </button>
              <span>Page {page}/{totalPages}</span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded border border-admin-border px-2 py-1 disabled:opacity-40 hover:text-admin-text"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <CreateIncidentModal
          token={token}
          onClose={() => setShowCreate(false)}
          onCreated={() => { invalidate(); showToast('success', 'Incident created'); setShowCreate(false); }}
          onError={() => showToast('error', 'Failed to create incident')}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Incident Row                                                       */
/* ------------------------------------------------------------------ */

function IncidentRow({
  row, isExpanded, onToggle, onAcknowledge, onResolve, isPending,
}: {
  row: IncidentRow;
  isExpanded: boolean;
  onToggle: () => void;
  onAcknowledge: () => void;
  onResolve: () => void;
  isPending: boolean;
}) {
  const sev = getSeverity(row.severity);
  const StatusIcon = STATUS_ICON[row.status] ?? Search;
  const isOpen = row.status === 'open';
  const isAcked = row.status === 'acknowledged';

  return (
    <div className={cn(isOpen && 'bg-red-500/[0.03]')}>
      <button onClick={onToggle} className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-white/[0.015] transition-colors">
        {isExpanded
          ? <ChevronDown className="h-3.5 w-3.5 text-admin-muted shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-admin-muted shrink-0" />}

        <div className={cn('h-2 w-2 rounded-full shrink-0', sev.dot, isOpen && 'animate-pulse')} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-admin-text">{row.service}</span>
            <span className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider', sev.badge)}>
              {row.severity}
            </span>
            <span className={cn(
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
              isOpen ? 'bg-red-500/10 text-red-400' : isAcked ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'
            )}>
              <StatusIcon className="h-2.5 w-2.5" />
              {row.status}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-[10px] text-admin-muted">
            <span>{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</span>
            <span>&middot;</span>
            <span className="flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              {durationBetween(row.created_at, row.resolved_at)}
            </span>
            {row.resolved_at && (
              <>
                <span>&middot;</span>
                <span className="text-emerald-400">Resolved {timeSince(row.resolved_at)}</span>
              </>
            )}
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 pt-1 border-t border-admin-border/40 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <p className="text-[10px] text-admin-muted uppercase tracking-wider">Incident ID</p>
              <p className="mt-0.5 text-xs font-mono text-admin-text">{row.id.slice(0, 12)}…</p>
            </div>
            <div>
              <p className="text-[10px] text-admin-muted uppercase tracking-wider">Service</p>
              <p className="mt-0.5 text-xs font-medium text-admin-text">{row.service}</p>
            </div>
            <div>
              <p className="text-[10px] text-admin-muted uppercase tracking-wider">Created</p>
              <p className="mt-0.5 text-xs text-admin-text tabular-nums">{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</p>
            </div>
            <div>
              <p className="text-[10px] text-admin-muted uppercase tracking-wider">Duration</p>
              <p className="mt-0.5 text-xs font-bold text-admin-text tabular-nums">{durationBetween(row.created_at, row.resolved_at)}</p>
            </div>
          </div>

          {/* Actions */}
          {row.status !== 'resolved' && (
            <div className="flex items-center gap-2 pt-1">
              {isOpen && (
                <button
                  onClick={onAcknowledge}
                  disabled={isPending}
                  className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-semibold text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                >
                  <Eye className="h-3 w-3" /> Acknowledge
                </button>
              )}
              <button
                onClick={onResolve}
                disabled={isPending}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
              >
                <CheckCircle2 className="h-3 w-3" /> Resolve
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Create Incident Modal                                              */
/* ------------------------------------------------------------------ */

function CreateIncidentModal({
  token, onClose, onCreated, onError,
}: {
  token: string | null;
  onClose: () => void;
  onCreated: () => void;
  onError: () => void;
}) {
  const [type, setType] = useState('');
  const [severity, setSeverity] = useState('warning');
  const [description, setDescription] = useState('');

  const mutation = useMutation({
    mutationFn: () => createControlIncident(token, { type, severity, description: description || undefined }),
    onSuccess: onCreated,
    onError: onError,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-lg rounded-2xl border border-admin-border bg-[#0B0E14] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-admin-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Siren className="h-4 w-4 text-red-400" />
            <h3 className="text-sm font-semibold text-admin-text">Create Incident</h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-admin-muted hover:bg-white/5 hover:text-admin-text transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-admin-muted block mb-1.5">Service / Type *</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-lg border border-admin-border bg-white/5 px-3 py-2 text-xs text-admin-text focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary/30"
            >
              <option value="" className="bg-[#0B0E14]">Select a service...</option>
              {SERVICE_OPTIONS.map((s) => (
                <option key={s} value={s} className="bg-[#0B0E14]">{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-admin-muted block mb-1.5">Severity</label>
            <div className="flex gap-2">
              {['info', 'warning', 'critical'].map((s) => {
                const sv = getSeverity(s);
                return (
                  <button key={s} onClick={() => setSeverity(s)}
                    className={cn(
                      'flex-1 rounded-lg border px-3 py-2 text-xs font-semibold capitalize transition-all',
                      severity === s ? `${sv.badge} ring-1 ring-current/20` : 'border-admin-border text-admin-muted hover:bg-white/5'
                    )}>
                    {s}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-admin-muted block mb-1.5">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What happened? Any context for the on-call team..."
              className="w-full rounded-lg border border-admin-border bg-white/5 px-3 py-2 text-xs text-admin-text placeholder:text-admin-muted/50 focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary/30 resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-admin-border px-5 py-3">
          <button onClick={onClose}
            className="rounded-lg border border-admin-border px-4 py-2 text-xs font-medium text-admin-muted hover:bg-white/5 hover:text-admin-text transition-colors">
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!type || mutation.isPending}
            className="rounded-lg bg-red-500/15 border border-red-500/30 px-4 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? 'Creating...' : 'Create Incident'}
          </button>
        </div>
      </div>
    </div>
  );
}
