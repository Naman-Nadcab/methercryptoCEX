'use client';

import { useCallback, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Loader2, Pin, PinOff, Eye, EyeOff, Calendar, Clock, Pencil, X, AlertTriangle, Plus, RefreshCw } from 'lucide-react';
import { useAdminAuthStore } from '@/store/auth';
import { adminFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ProtectedAction } from '@/components/rbac/ProtectedAction';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { ActionAuthModal, type ActionAuthPayload } from '@/components/ops/ActionAuthModal';

/* ── types ──────────────────────────────────────────────────────────── */
const TYPE_OPTIONS = [
  { value: 'info',        label: 'Info' },
  { value: 'warning',     label: 'Warning' },
  { value: 'maintenance', label: 'Maintenance' },
];

type Announcement = {
  id: string;
  title: string;
  body?: string;
  summary?: string;
  type: string;
  is_pinned: boolean;
  is_published: boolean;
  published_at?: string;
  expires_at?: string;
  created_at: string;
  created_by?: string;
};

/* ── helpers ────────────────────────────────────────────────────────── */
function fmtDate(v: string | undefined | null) {
  if (!v) return '—';
  try { return new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', year: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return '—'; }
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold',
      type === 'warning'     ? 'border-amber-500/30 bg-amber-950/15 text-amber-400' :
      type === 'maintenance' ? 'border-blue-500/30 bg-blue-950/15 text-blue-400' :
      'border-slate-500/30 bg-slate-950/15 text-slate-400')}>
      {type}
    </span>
  );
}

/* ── form state ─────────────────────────────────────────────────────── */
type FormState = {
  title: string;
  body: string;
  type: string;
  is_pinned: boolean;
  is_published: boolean;
  scheduled_at: string;
  expires_at: string;
};

const BLANK_FORM: FormState = {
  title: '', body: '', type: 'info',
  is_pinned: false, is_published: false,
  scheduled_at: '', expires_at: '',
};

/* ── sub-components ─────────────────────────────────────────────────── */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs font-semibold text-admin-muted">{children}</label>;
}
function FieldInput({ ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn('w-full rounded-xl border border-admin-border/50 bg-white/[0.03] px-3 py-2 text-sm text-admin-text placeholder:text-admin-muted focus:outline-none focus:border-blue-500/40', props.className)} />;
}
function FieldTextarea({ value, onChange, placeholder, rows = 4 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} placeholder={placeholder}
      className="w-full resize-none rounded-xl border border-admin-border/50 bg-white/[0.03] px-3 py-2 text-sm text-admin-text placeholder:text-admin-muted focus:outline-none focus:border-blue-500/40" />
  );
}

/* ── page ───────────────────────────────────────────────────────────── */
export default function AnnouncementsPage() {
  const token       = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();

  const [form,       setForm]       = useState<FormState>(BLANK_FORM);
  const [editId,     setEditId]     = useState<string | null>(null);
  const [formOpen,   setFormOpen]   = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);
  const [formError,  setFormError]  = useState('');
  const [previewMode, setPreviewMode] = useState(false);
  const [publishAuthOpen, setPublishAuthOpen] = useState(false);
  const [toggleAuthTarget, setToggleAuthTarget] = useState<{ id: string; is_published: boolean } | null>(null);
  const [deleteAuthOpen, setDeleteAuthOpen] = useState(false);

  const patchForm = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  /* ── query ── */
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['admin', 'announcements', token],
    staleTime: 30_000,
    queryFn: () => adminFetch('/notifications/announcements', { token }),
    enabled: !!token,
    refetchInterval: 30_000,
  });
  const items: Announcement[] = (data?.data as Record<string, unknown>)?.announcements as Announcement[] ?? [];
  const liveCount  = items.filter((a) => a.is_published).length;
  const draftCount = items.filter((a) => !a.is_published).length;

  /* ── mutations ── */
  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      adminFetch('/notifications/announcements', { method: 'POST', body, token }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'announcements'] });
      setForm(BLANK_FORM); setFormOpen(false); setFormError('');
    },
    onError: (e: unknown) => setFormError((e as { message?: string })?.message ?? 'Failed to create announcement.'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      adminFetch(`/notifications/announcements/${id}`, { method: 'PATCH', body, token }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'announcements'] });
      setEditId(null); setForm(BLANK_FORM); setFormOpen(false); setFormError('');
    },
    onError: (e: unknown) => setFormError((e as { message?: string })?.message ?? 'Failed to update.'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) =>
      adminFetch(`/notifications/announcements/${id}`, { method: 'DELETE', token, body: {} }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'announcements'] });
      setDeleteTarget(null);
    },
  });

  const togglePublishMut = useMutation({
    mutationFn: ({ id, is_published }: { id: string; is_published: boolean }) =>
      adminFetch(`/notifications/announcements/${id}`, { method: 'PATCH', body: { is_published }, token }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin', 'announcements'] }); },
  });

  const handleSubmit = useCallback((publish: boolean) => {
    if (!form.title.trim()) { setFormError('Title is required.'); return; }
    setFormError('');
    const body: Record<string, unknown> = {
      title:        form.title.trim(),
      body:         form.body.trim() || undefined,
      type:         form.type,
      is_pinned:    form.is_pinned,
      is_published: publish,
    };
    if (form.scheduled_at) body.published_at = new Date(form.scheduled_at).toISOString();
    if (form.expires_at)   body.expires_at   = new Date(form.expires_at).toISOString();

    if (editId) updateMut.mutate({ id: editId, body });
    else        createMut.mutate(body);
  }, [form, editId, createMut, updateMut]);

  const openEdit = (a: Announcement) => {
    setEditId(a.id);
    setForm({
      title:        a.title,
      body:         a.body ?? a.summary ?? '',
      type:         a.type,
      is_pinned:    a.is_pinned,
      is_published: a.is_published,
      scheduled_at: a.published_at ? new Date(a.published_at).toISOString().slice(0, 16) : '',
      expires_at:   a.expires_at   ? new Date(a.expires_at).toISOString().slice(0, 16)   : '',
    });
    setFormOpen(true);
    setFormError('');
  };

  const openNew = () => {
    setEditId(null); setForm(BLANK_FORM); setFormError(''); setFormOpen(true);
  };

  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <AdminPageFrame
      title="Announcements"
      description="Create, schedule, and manage user-facing system announcements."
      quickActions={
        <>
          <button type="button" onClick={() => refetch()} disabled={isFetching}
            className="flex items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5 text-xs text-admin-muted hover:text-admin-text disabled:opacity-40 transition-colors">
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
          </button>
          <ProtectedAction permission="settings:edit" fallback="disabled">
            <button type="button" onClick={openNew}
              className="flex items-center gap-1.5 rounded-xl border border-blue-500/30 bg-blue-950/15 px-3 py-1.5 text-xs font-semibold text-blue-300 hover:bg-blue-950/25 transition-colors">
              <Plus className="h-3.5 w-3.5" /> New Announcement
            </button>
          </ProtectedAction>
        </>
      }
    >
      {/* KPI strip */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Live',   value: liveCount,         accent: 'bg-emerald-500' },
          { label: 'Draft',  value: draftCount,         accent: 'bg-amber-500' },
          { label: 'Total',  value: items.length,       accent: 'bg-blue-500' },
        ].map((k) => (
          <div key={k.label} className="relative overflow-hidden rounded-2xl border border-admin-border/50 bg-admin-card p-5">
            <div className={cn('absolute inset-x-0 top-0 h-0.5 rounded-t-2xl', k.accent)} />
            <p className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">{k.label}</p>
            <p className="mt-2 text-3xl font-bold tabular-nums text-admin-text">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Announcement list */}
      <div className="rounded-2xl border border-admin-border/50 bg-admin-card">
        <div className="flex items-center justify-between border-b border-admin-border/30 px-5 py-3">
          <p className="text-sm font-semibold text-admin-text">All Announcements</p>
          {isFetching && <RefreshCw className="h-3.5 w-3.5 animate-spin text-admin-muted" />}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-admin-muted">
            <Loader2 className="h-6 w-6 animate-spin text-admin-primary" />
            <span>Loading…</span>
          </div>
        ) : items.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-admin-muted">
            No announcements yet. Create one to get started.
          </div>
        ) : (
          <ul className="divide-y divide-admin-border/25">
            {items.map((a) => (
              <li key={a.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1 space-y-1.5">
                  {/* Title + badges */}
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-admin-text">{a.title}</p>
                    <TypeBadge type={a.type} />
                    <span className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold',
                      a.is_published ? 'border-emerald-500/30 bg-emerald-950/15 text-emerald-400' : 'border-amber-500/30 bg-amber-950/15 text-amber-400')}>
                      <span className={cn('h-1.5 w-1.5 rounded-full', a.is_published ? 'bg-emerald-400' : 'bg-amber-400')} />
                      {a.is_published ? 'Published' : 'Draft'}
                    </span>
                    {a.is_pinned && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-950/15 px-2 py-0.5 text-[10px] font-semibold text-indigo-400">
                        <Pin className="h-2.5 w-2.5" /> Pinned
                      </span>
                    )}
                  </div>
                  {/* Body */}
                  {(a.body ?? a.summary) && (
                    <p className="text-xs text-admin-muted line-clamp-2">{a.body ?? a.summary}</p>
                  )}
                  {/* Timestamps */}
                  <div className="flex flex-wrap items-center gap-3 text-[10px] text-admin-muted">
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Created {fmtDate(a.created_at)}</span>
                    {a.published_at && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Published {fmtDate(a.published_at)}</span>}
                    {a.expires_at   && <span className="flex items-center gap-1 text-amber-400"><Clock className="h-3 w-3" />Expires {fmtDate(a.expires_at)}</span>}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <ProtectedAction permission="settings:edit" fallback="disabled">
                    <button type="button" onClick={() => openEdit(a)} title="Edit"
                      className="p-1.5 rounded-lg text-admin-muted hover:text-blue-400 hover:bg-blue-950/15 transition-colors">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button type="button"
                      onClick={() => setToggleAuthTarget({ id: a.id, is_published: !a.is_published })}
                      disabled={togglePublishMut.isPending}
                      title={a.is_published ? 'Unpublish' : 'Publish'}
                      className={cn('p-1.5 rounded-lg transition-colors',
                        a.is_published ? 'text-admin-muted hover:text-amber-400 hover:bg-amber-950/15' : 'text-admin-muted hover:text-emerald-400 hover:bg-emerald-950/15')}>
                      {a.is_published ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    <button type="button" onClick={() => setDeleteTarget(a)} title="Delete"
                      className="p-1.5 rounded-lg text-admin-muted hover:text-red-400 hover:bg-red-950/15 transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </ProtectedAction>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Create / Edit Form Modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !isPending && setFormOpen(false)} />
          <div className="relative z-10 w-full max-w-lg rounded-2xl border border-admin-border/60 bg-admin-card p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-admin-text">{editId ? 'Edit Announcement' : 'New Announcement'}</h3>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setPreviewMode(!previewMode)}
                  className={cn('flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[10px] font-semibold transition-colors',
                    previewMode ? 'border-blue-500/30 bg-blue-950/15 text-blue-300' : 'border-admin-border/40 text-admin-muted hover:text-admin-text')}>
                  <Eye className="h-3 w-3" /> Preview
                </button>
                <button type="button" onClick={() => { setFormOpen(false); setEditId(null); setForm(BLANK_FORM); }}
                  className="text-admin-muted hover:text-admin-text"><X className="h-4 w-4" /></button>
              </div>
            </div>

            {previewMode ? (
              /* Preview */
              <div className="rounded-xl border border-admin-border/50 bg-white/[0.02] p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <TypeBadge type={form.type} />
                  {form.is_pinned && <span className="text-[10px] text-indigo-400">📌 Pinned</span>}
                </div>
                <p className="text-sm font-semibold text-admin-text">{form.title || '(No title)'}</p>
                {form.body && <p className="text-xs text-admin-muted whitespace-pre-wrap">{form.body}</p>}
                {form.expires_at && <p className="text-[10px] text-amber-400">Expires: {fmtDate(form.expires_at)}</p>}
                <p className="text-[10px] text-admin-muted">This is how users will see this announcement.</p>
              </div>
            ) : (
              /* Form */
              <div className="space-y-4">
                <div>
                  <FieldLabel>Title *</FieldLabel>
                  <FieldInput value={form.title} onChange={(e) => patchForm({ title: e.target.value })} placeholder="e.g. Scheduled maintenance — March 15" />
                </div>
                <div>
                  <FieldLabel>Content</FieldLabel>
                  <FieldTextarea value={form.body} onChange={(v) => patchForm({ body: v })} placeholder="Full announcement message visible to users…" rows={4} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <FieldLabel>Type</FieldLabel>
                    <select value={form.type} onChange={(e) => patchForm({ type: e.target.value })}
                      className="w-full rounded-xl border border-admin-border/50 bg-white/[0.03] px-3 py-2 text-sm text-admin-text focus:outline-none focus:border-blue-500/40">
                      {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-2 justify-end pb-1">
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-admin-text">
                      <input type="checkbox" checked={form.is_pinned} onChange={(e) => patchForm({ is_pinned: e.target.checked })} className="accent-indigo-500" />
                      <Pin className="h-3 w-3 text-indigo-400" /> Pin to top
                    </label>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <FieldLabel>Scheduled Publish At (optional)</FieldLabel>
                    <FieldInput type="datetime-local" value={form.scheduled_at} onChange={(e) => patchForm({ scheduled_at: e.target.value })} />
                    <p className="mt-1 text-[10px] text-admin-muted">Leave blank to publish immediately.</p>
                  </div>
                  <div>
                    <FieldLabel>Expires At (optional)</FieldLabel>
                    <FieldInput type="datetime-local" value={form.expires_at} onChange={(e) => patchForm({ expires_at: e.target.value })} />
                    <p className="mt-1 text-[10px] text-admin-muted">Auto-unpublish after this time.</p>
                  </div>
                </div>
              </div>
            )}

            {formError && <p className="mt-3 rounded-lg border border-red-500/25 bg-red-950/10 px-3 py-2 text-xs text-red-400">{formError}</p>}

            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => { setFormOpen(false); setEditId(null); setForm(BLANK_FORM); }} disabled={isPending}
                className="flex-1 rounded-xl border border-admin-border/50 py-2 text-xs font-medium text-admin-muted hover:text-admin-text transition-colors disabled:opacity-40">
                Cancel
              </button>
              <button type="button" disabled={isPending} onClick={() => handleSubmit(false)}
                className="rounded-xl border border-amber-500/30 bg-amber-950/15 px-4 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-950/25 disabled:opacity-40 transition-colors">
                {isPending ? '…' : 'Save Draft'}
              </button>
              <ProtectedAction permission="settings:edit" fallback="disabled">
                <button type="button" disabled={isPending} onClick={() => setPublishAuthOpen(true)}
                  className="flex-1 rounded-xl bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-40 transition-all">
                  {isPending ? 'Publishing…' : form.scheduled_at ? 'Schedule' : 'Publish Now'}
                </button>
              </ProtectedAction>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !deleteMut.isPending && setDeleteTarget(null)} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl border border-admin-border/60 bg-admin-card p-6 shadow-2xl">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-red-500/30 bg-red-950/20">
              <Trash2 className="h-6 w-6 text-red-400" />
            </div>
            <h3 className="mb-1 text-center text-sm font-semibold text-admin-text">Delete Announcement</h3>
            <p className="mb-2 text-center text-xs text-admin-muted">
              Delete <span className="font-semibold text-admin-text">"{deleteTarget.title}"</span>?
            </p>
            {deleteTarget.is_published && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-950/10 px-3 py-2 text-xs text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                This announcement is currently live and visible to users.
              </div>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={deleteMut.isPending}
                className="flex-1 rounded-xl border border-admin-border/50 py-2 text-xs font-medium text-admin-muted hover:text-admin-text transition-colors disabled:opacity-40">
                Cancel
              </button>
              <button type="button" onClick={() => setDeleteAuthOpen(true)} disabled={deleteMut.isPending}
                className="flex-1 rounded-xl bg-red-600 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-40 transition-all">
                {deleteMut.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
      <ActionAuthModal
        open={publishAuthOpen}
        onClose={() => setPublishAuthOpen(false)}
        onConfirm={(payload: ActionAuthPayload) => {
          void payload;
          handleSubmit(true);
          setPublishAuthOpen(false);
        }}
        title={form.scheduled_at ? 'Authorize announcement schedule' : 'Authorize announcement publish'}
        actionLabel={form.scheduled_at ? 'Schedule user-facing announcement' : 'Publish user-facing announcement'}
        description="This message becomes visible to exchange users and must be audited."
        requireReason
        twofaRequired
        confirmationPhrase="CONFIRM ANNOUNCEMENT_PUBLISH"
        externalError={formError || (createMut.error instanceof Error ? createMut.error.message : updateMut.error instanceof Error ? updateMut.error.message : null)}
        isPending={isPending}
        confirmLabel={isPending ? 'Processing…' : form.scheduled_at ? 'Schedule announcement' : 'Publish announcement'}
        confirmVariant="primary"
      />
      <ActionAuthModal
        open={toggleAuthTarget !== null}
        onClose={() => setToggleAuthTarget(null)}
        onConfirm={(payload: ActionAuthPayload) => {
          void payload;
          if (toggleAuthTarget) {
            togglePublishMut.mutate(toggleAuthTarget);
          }
          setToggleAuthTarget(null);
        }}
        title="Authorize visibility change"
        actionLabel={toggleAuthTarget?.is_published ? 'Publish announcement' : 'Unpublish announcement'}
        description="Visibility changes immediately affect what users can see."
        requireReason
        twofaRequired
        confirmationPhrase="CONFIRM ANNOUNCEMENT_VISIBILITY"
        externalError={togglePublishMut.error instanceof Error ? togglePublishMut.error.message : null}
        isPending={togglePublishMut.isPending}
        confirmLabel={togglePublishMut.isPending ? 'Updating…' : 'Apply visibility change'}
        confirmVariant={toggleAuthTarget?.is_published ? 'primary' : 'danger'}
      />
      <ActionAuthModal
        open={deleteAuthOpen}
        onClose={() => setDeleteAuthOpen(false)}
        onConfirm={(payload: ActionAuthPayload) => {
          void payload;
          if (deleteTarget) {
            deleteMut.mutate(deleteTarget.id);
          }
          setDeleteAuthOpen(false);
        }}
        title="Authorize announcement deletion"
        actionLabel={deleteTarget ? `Delete announcement: ${deleteTarget.title}` : 'Delete announcement'}
        description="Deleting removes this announcement permanently from the admin and user surfaces."
        requireReason
        twofaRequired
        confirmationPhrase="CONFIRM ANNOUNCEMENT_DELETE"
        externalError={deleteMut.error instanceof Error ? deleteMut.error.message : null}
        isPending={deleteMut.isPending}
        confirmLabel={deleteMut.isPending ? 'Deleting…' : 'Delete announcement'}
        confirmVariant="danger"
      />
    </AdminPageFrame>
  );
}
