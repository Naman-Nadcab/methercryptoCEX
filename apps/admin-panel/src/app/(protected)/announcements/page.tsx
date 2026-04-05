'use client';

import { useCallback, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Trash2, Loader2 } from 'lucide-react';
import { useAdminAuthStore } from '@/store/auth';
import { adminFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import {
  Card, CardHeader, CardTitle, CardContent,
  Button, Badge, Input, Textarea, Select,
} from '@/components/ui';
import { ProtectedAction } from '@/components/rbac/ProtectedAction';

const TYPE_OPTIONS = [
  { value: 'info', label: 'Info' },
  { value: 'warning', label: 'Warning' },
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

function badgeVariantForType(t: string): 'default' | 'warning' | 'info' | 'primary' {
  if (t === 'warning') return 'warning';
  if (t === 'maintenance') return 'info';
  return 'default';
}

export default function AnnouncementsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [type, setType] = useState('info');
  const [isPinned, setIsPinned] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'announcements', token],
    staleTime: 30_000,
    queryFn: () => adminFetch('/notifications/announcements', { token }),
    enabled: !!token,
    refetchInterval: 30000,
  });

  const items: Announcement[] = (data?.data as Record<string, unknown>)?.announcements as Announcement[] ?? [];
  const liveCount = items.filter((a) => a.is_published).length;

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      adminFetch('/notifications/announcements', { method: 'POST', body, token }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'announcements'] });
      setTitle('');
      setContent('');
      setType('info');
      setIsPinned(false);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) =>
      adminFetch(`/notifications/announcements/${id}`, { method: 'DELETE', token }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'announcements'] });
    },
  });

  const handleSubmit = useCallback(() => {
    if (!title.trim()) return;
    createMut.mutate({
      title: title.trim(),
      body: content.trim() || undefined,
      type,
      is_pinned: isPinned,
      is_published: true,
    });
  }, [title, content, type, isPinned, createMut]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-admin-text">Announcements</h1>
        <p className="text-xs text-admin-muted mt-0.5">Create and manage user-facing system announcements.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create announcement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Scheduled maintenance" />
          <Textarea
            label="Content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Message shown to users…"
            rows={5}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <Select label="Type" options={TYPE_OPTIONS} value={type} onChange={setType} />
            <div className="flex items-end gap-2 pb-1">
              <label className="flex items-center gap-2 text-sm text-admin-text cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPinned}
                  onChange={(e) => setIsPinned(e.target.checked)}
                  className="rounded border-admin-border"
                />
                Pin to top
              </label>
            </div>
          </div>
          <div className="flex justify-end">
            <ProtectedAction permission="settings:edit" fallback="disabled">
              <Button type="button" onClick={handleSubmit} loading={createMut.isPending}>
                Publish announcement
              </Button>
            </ProtectedAction>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Active announcements
            <Badge variant="default" className="text-[10px]">{liveCount} live</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-admin-muted">
              <Loader2 className="h-6 w-6 shrink-0 animate-spin text-admin-primary" />
              <span>Loading announcements…</span>
            </div>
          ) : items.length === 0 ? (
            <div className={cn('rounded-lg border border-dashed border-admin-border bg-white/[0.02] px-6 py-12 text-center text-sm text-admin-muted')}>
              No announcements yet. Create one above.
            </div>
          ) : (
            <ul className="space-y-3">
              {items.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-col gap-2 rounded-lg border border-admin-border bg-admin-card p-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-admin-text">{a.title}</p>
                      <Badge variant={badgeVariantForType(a.type)} size="sm">{a.type}</Badge>
                      <Badge variant={a.is_published ? 'success' : 'warning'} size="sm">
                        {a.is_published ? 'published' : 'draft'}
                      </Badge>
                      {a.is_pinned && <Badge variant="primary" size="sm">pinned</Badge>}
                    </div>
                    {a.body && <p className="text-sm text-admin-muted line-clamp-3">{a.body}</p>}
                    <p className="text-xs text-admin-muted">
                      {new Date(a.created_at).toLocaleString()}
                    </p>
                  </div>
                  <ProtectedAction permission="settings:edit" fallback="disabled">
                    <Button
                      type="button"
                      variant="secondary"
                      className="shrink-0"
                      icon={<Trash2 className="h-4 w-4" />}
                      loading={deleteMut.isPending}
                      onClick={() => deleteMut.mutate(a.id)}
                    >
                      Delete
                    </Button>
                  </ProtectedAction>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
