'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  getScheduledReports,
  createScheduledReport,
  deleteScheduledReport,
  type ScheduledReportRow,
} from '@/lib/analytics-api';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ArrowLeft, Plus, Trash2, Loader2, Info } from 'lucide-react';
import { TableSkeleton } from '@/components/ui';

const REPORT_TYPES = ['trading', 'revenue', 'user-growth'] as const;
const FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
const FORMATS = ['csv', 'json', 'pdf'] as const;

export default function ScheduledReportsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [reportType, setReportType] = useState<string>('trading');
  const [frequency, setFrequency] = useState<string>('daily');
  const [format, setFormat] = useState<string>('csv');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'analytics', 'scheduled-reports', token],
    queryFn: () => getScheduledReports(token),
    enabled: !!token,
  });

  const createMutation = useMutation({
    mutationFn: () => createScheduledReport(token, { report_type: reportType, frequency, format }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'analytics', 'scheduled-reports'] });
    },
    onError: () => setToastMsg('Failed to create schedule.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteScheduledReport(token, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'analytics', 'scheduled-reports'] });
    },
    onError: () => setToastMsg('Failed to delete schedule.'),
  });

  const reports = (data?.data?.scheduled_reports ?? []) as ScheduledReportRow[];

  return (
    <div className="space-y-5">
      {toastMsg && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
          {toastMsg}
          <button type="button" className="ml-2 font-medium underline" onClick={() => setToastMsg(null)}>
            Dismiss
          </button>
        </p>
      )}
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/analytics" className="flex h-8 w-8 items-center justify-center rounded-lg border border-admin-border text-admin-muted hover:text-admin-text hover:bg-white/5 transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-admin-text">Scheduled Reports</h1>
            <p className="text-xs text-admin-muted mt-0.5">Schedules stored in the database — only the table below reflects what is active.</p>
          </div>
        </div>
      </div>

      {/* Active Schedules Table */}
      <div className="rounded-xl border border-admin-border bg-admin-card">
        <div className="px-5 py-3 border-b border-admin-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-admin-text">Active Schedules</h3>
          <Badge variant="default" size="sm">{reports.length} active</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-admin-border bg-white/[0.02]">
                <th className="px-5 py-2.5 font-medium text-admin-muted">Report</th>
                <th className="px-3 py-2.5 font-medium text-admin-muted">Frequency</th>
                <th className="px-3 py-2.5 font-medium text-admin-muted">Format</th>
                <th className="px-3 py-2.5 font-medium text-admin-muted">Last Run</th>
                <th className="px-3 py-2.5 font-medium text-admin-muted"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="p-0"><TableSkeleton rows={3} cols={5} /></td></tr>
              ) : reports.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-admin-muted">No scheduled reports yet</td></tr>
              ) : reports.map((r) => (
                <tr key={r.id} className="border-b border-admin-border/50 last:border-0 hover:bg-white/5">
                  <td className="px-5 py-2.5 font-medium capitalize text-admin-text">{r.report_type.replace('-', ' ')}</td>
                  <td className="px-3 py-2.5 text-admin-muted capitalize">{r.frequency}</td>
                  <td className="px-3 py-2.5"><Badge variant="default" size="sm">{r.format.toUpperCase()}</Badge></td>
                  <td className="px-3 py-2.5 text-admin-muted">{r.last_run_at ? new Date(r.last_run_at).toLocaleString() : '—'}</td>
                  <td className="px-3 py-2.5">
                    <button onClick={() => deleteMutation.mutate(r.id)} disabled={deleteMutation.isPending}
                      className="text-admin-muted hover:text-red-500 transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add New Schedule */}
      <div className="rounded-xl border border-admin-border bg-admin-card">
        <div className="px-5 py-3 border-b border-admin-border">
          <h3 className="text-sm font-semibold text-admin-text">Add schedule</h3>
        </div>
        <div className="px-5 py-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[10px] font-medium text-admin-muted uppercase tracking-wider mb-1">Report Type</label>
              <select value={reportType} onChange={(e) => setReportType(e.target.value)}
                className="rounded-lg border border-admin-border px-3 py-1.5 text-xs text-admin-text bg-admin-card">
                {REPORT_TYPES.map((r) => (<option key={r} value={r}>{r.replace('-', ' ')}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-medium text-admin-muted uppercase tracking-wider mb-1">Frequency</label>
              <select value={frequency} onChange={(e) => setFrequency(e.target.value)}
                className="rounded-lg border border-admin-border px-3 py-1.5 text-xs text-admin-text bg-admin-card">
                {FREQUENCIES.map((f) => (<option key={f} value={f}>{f}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-medium text-admin-muted uppercase tracking-wider mb-1">Format</label>
              <select value={format} onChange={(e) => setFormat(e.target.value)}
                className="rounded-lg border border-admin-border px-3 py-1.5 text-xs text-admin-text bg-admin-card">
                {FORMATS.map((f) => (<option key={f} value={f} disabled={f === 'pdf'}>{f.toUpperCase()}{f === 'pdf' ? ' (soon)' : ''}</option>))}
              </select>
            </div>
            <Button size="sm" onClick={() => createMutation.mutate()} disabled={createMutation.isPending || format === 'pdf'}
              icon={createMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}>
              Add
            </Button>
          </div>
        </div>
      </div>

      <div className="flex gap-2 rounded-lg border border-admin-border/80 bg-white/[0.02] px-3 py-2.5 text-[11px] text-admin-muted">
        <Info className="h-4 w-4 shrink-0 text-admin-primary mt-0.5" />
        <p>
          <span className="font-medium text-admin-text">Cron-style examples (documentation only):</span> daily 06:00 UTC{' '}
          <code className="rounded bg-white/5 px-1 font-mono text-[10px]">0 6 * * *</code>, weekly Mon 07:00{' '}
          <code className="rounded bg-white/5 px-1 font-mono text-[10px]">0 7 * * 1</code>, monthly 1st 08:00{' '}
          <code className="rounded bg-white/5 px-1 font-mono text-[10px]">0 8 1 * *</code>. Delivery runs depend on your backend job worker configuration.
        </p>
      </div>
    </div>
  );
}
