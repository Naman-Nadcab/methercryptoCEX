'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useAdminAuthStore } from '@/store/auth';
import { adminFetch } from '@/lib/api';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { Card } from '@/components/ui/Card';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import {
  Headphones, Clock, AlertTriangle, UserX, Search,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';

interface SupportTicket {
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
}

interface TicketStats {
  open: number;
  inProgress: number;
  unassigned: number;
  avgResolutionHours: number | null;
}

const STATUS_TABS: TabItem[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'waiting_user', label: 'Waiting' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'closed', label: 'Closed' },
];

const PRIORITY_OPTIONS = [
  { value: '', label: 'All Priorities' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const CATEGORY_OPTIONS = [
  { value: '', label: 'All Categories' },
  { value: 'general', label: 'General' },
  { value: 'deposit', label: 'Deposit' },
  { value: 'withdrawal', label: 'Withdrawal' },
  { value: 'trading', label: 'Trading' },
  { value: 'kyc', label: 'KYC' },
  { value: 'security', label: 'Security' },
  { value: 'p2p', label: 'P2P' },
  { value: 'account', label: 'Account' },
  { value: 'other', label: 'Other' },
];

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

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function SupportPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const router = useRouter();

  const [statusTab, setStatusTab] = useState('all');
  const [priority, setPriority] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const limit = 20;

  const { data: statsData } = useQuery({
    queryKey: ['admin', 'support-stats', token],
    staleTime: 30_000,
    queryFn: () => adminFetch<TicketStats>('/support/stats', { token }),
    enabled: !!token,
    refetchInterval: 30_000,
  });
  const stats = statsData?.data;

  const { data: ticketsData, isLoading, isError: ticketsError } = useQuery({
    queryKey: ['admin', 'support-tickets', token, statusTab, priority, category, search, page],
    staleTime: 30_000,
    queryFn: () =>
      adminFetch<{ tickets: SupportTicket[]; total: number }>('/support/tickets', {
        token,
        params: {
          ...(statusTab !== 'all' && { status: statusTab }),
          ...(priority && { priority }),
          ...(category && { category }),
          ...(search.trim() && { search: search.trim() }),
          limit,
          offset: page * limit,
        },
      }),
    enabled: !!token,
    refetchInterval: 15_000,
  });
  const tickets = ticketsData?.data?.tickets ?? [];
  const total = ticketsData?.data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  const kpis = [
    { label: 'Open Tickets',   value: stats?.open      ?? '—', icon: Headphones,   accent: 'blue' },
    { label: 'In Progress',    value: stats?.inProgress ?? '—', icon: Clock,        accent: 'indigo' },
    { label: 'Avg Resolution', value: stats?.avgResolutionHours != null ? `${stats.avgResolutionHours}h` : '—', icon: AlertTriangle, accent: 'amber' },
    { label: 'Unassigned',     value: stats?.unassigned ?? '—', icon: UserX,        accent: 'red' },
  ];

  return (
    <AdminPageFrame title="Support Tickets" description="Manage customer support requests and conversations">

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="relative overflow-hidden rounded-2xl border border-admin-border/50 bg-admin-card p-5">
            <div className={`absolute inset-x-0 top-0 h-0.5 rounded-t-2xl ${kpi.accent === 'blue' ? 'bg-blue-500' : kpi.accent === 'indigo' ? 'bg-indigo-500' : kpi.accent === 'amber' ? 'bg-amber-500' : 'bg-red-500'}`} />
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">{kpi.label}</p>
                <p className="mt-2 text-3xl font-bold tabular-nums text-admin-text">{kpi.value}</p>
              </div>
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${kpi.accent === 'blue' ? 'border-blue-500/25 bg-blue-950/20 text-blue-400' : kpi.accent === 'indigo' ? 'border-indigo-500/25 bg-indigo-950/20 text-indigo-400' : kpi.accent === 'amber' ? 'border-amber-500/25 bg-amber-950/20 text-amber-400' : 'border-red-500/25 bg-red-950/20 text-red-400'}`}>
                <kpi.icon className="h-5 w-5" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <Tabs items={STATUS_TABS} active={statusTab} onChange={(id) => { setStatusTab(id); setPage(0); }} />

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-72">
            <Input
              placeholder="Search by ticket ID, subject, or email…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              iconLeft={<Search className="h-4 w-4" />}
            />
          </div>
          <select
            value={priority}
            onChange={(e) => { setPriority(e.target.value); setPage(0); }}
            className="h-10 rounded-ds-md border border-admin-border bg-admin-card px-3 text-sm text-admin-text focus:outline-none focus:ring-2 focus:ring-admin-primary"
          >
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value); setPage(0); }}
            className="h-10 rounded-ds-md border border-admin-border bg-admin-card px-3 text-sm text-admin-text focus:outline-none focus:ring-2 focus:ring-admin-primary"
          >
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <Card noPadding>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-admin-border bg-white/[0.02]/60 text-left text-xs font-medium uppercase tracking-wider text-admin-muted">
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Assigned To</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {isLoading ? (
                <tr><td colSpan={9} className="p-0"><TableSkeleton rows={6} cols={7} /></td></tr>
              ) : ticketsError ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center">
                  <p className="text-sm text-red-400">Failed to load tickets. Check your connection and try again.</p>
                </td></tr>
              ) : tickets.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-admin-muted">No tickets found</td></tr>
              ) : (
                tickets.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => router.push(`/support/${t.id}`)}
                    className="cursor-pointer hover:bg-white/5 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-admin-muted">{t.id.slice(0, 8)}</td>
                    <td className="px-4 py-3 font-medium text-admin-text max-w-[260px] truncate">{t.subject}</td>
                    <td className="px-4 py-3 text-admin-muted max-w-[180px] truncate">{t.user_email}</td>
                    <td className="px-4 py-3">
                      <Badge variant="default" badgeStyle="outline">{t.category}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={PRIORITY_BADGE[t.priority] ?? 'default'}>{t.priority}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_BADGE[t.status] ?? 'default'} badgeStyle="dot">{t.status.replace('_', ' ')}</Badge>
                    </td>
                    <td className="px-4 py-3 text-admin-muted">{t.assigned_admin_name ?? <span className="text-admin-muted/40">—</span>}</td>
                    <td className="px-4 py-3 text-admin-muted text-xs whitespace-nowrap">{formatDate(t.created_at)}</td>
                    <td className="px-4 py-3 text-admin-muted text-xs whitespace-nowrap">{formatDate(t.updated_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-admin-border px-4 py-3">
            <p className="text-xs text-admin-muted">
              Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="xs"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                icon={<ChevronLeft className="h-4 w-4" />}
              >
                Prev
              </Button>
              <Button
                variant="ghost"
                size="xs"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
                iconRight={<ChevronRight className="h-4 w-4" />}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </AdminPageFrame>
  );
}
