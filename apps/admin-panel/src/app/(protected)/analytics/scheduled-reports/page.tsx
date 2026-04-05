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
import { ArrowLeft, Plus, Trash2, Loader2, CalendarClock, Mail, Webhook, Clock } from 'lucide-react';
import { cn } from '@/lib/cn';
import { TableSkeleton } from '@/components/ui';

const REPORT_TYPES = ['trading', 'revenue', 'user-growth'] as const;
const FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
const FORMATS = ['csv', 'json', 'pdf'] as const;

const PRESET_SCHEDULES = [
  {
    title: 'Daily Trading Summary',
    description: 'Volumes, fills, and spread analytics for the prior UTC day.',
    cron: '0 6 * * *',
    frequencyLabel: 'Daily at 06:00 UTC',
    lastRun: 'Apr 5, 2026, 6:00 AM',
    nextRun: 'Apr 6, 2026, 6:00 AM',
    format: 'CSV' as const,
    delivery: 'email' as const,
  },
  {
    title: 'Weekly Revenue Report',
    description: 'Fee revenue, maker/taker breakdown, and asset-level totals.',
    cron: '0 7 * * 1',
    frequencyLabel: 'Weekly · Mon 07:00 UTC',
    lastRun: 'Mar 31, 2026, 7:00 AM',
    nextRun: 'Apr 7, 2026, 7:00 AM',
    format: 'JSON' as const,
    delivery: 'webhook' as const,
  },
  {
    title: 'Monthly Compliance Report',
    description: 'KYC status, AML alerts, and SAR-related metrics for regulators.',
    cron: '0 8 1 * *',
    frequencyLabel: 'Monthly · 1st 08:00 UTC',
    lastRun: 'Apr 1, 2026, 8:00 AM',
    nextRun: 'May 1, 2026, 8:00 AM',
    format: 'CSV' as const,
    delivery: 'email' as const,
  },
] as const;

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
            <p className="text-xs text-admin-muted mt-0.5">Automate daily, weekly, or monthly report delivery</p>
          </div>
        </div>
      </div>

      {/* Preset Schedules */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <CalendarClock className="h-3.5 w-3.5 text-admin-muted" />
          <p className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">Configured Schedules</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {PRESET_SCHEDULES.map((preset) => (
            <div key={preset.title} className="rounded-xl border border-admin-border bg-admin-card p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="text-xs font-semibold text-admin-text leading-snug">{preset.title}</h3>
                <Badge variant="primary" size="sm" className="font-mono text-[9px] shrink-0">{preset.cron}</Badge>
              </div>
              <p className="text-[10px] text-admin-muted mb-3">{preset.description}</p>

              <div className="flex flex-wrap gap-1.5 mb-3">
                <Badge variant="default" size="sm">{preset.frequencyLabel}</Badge>
                <Badge variant={preset.format === 'CSV' ? 'success' : 'info'} size="sm">{preset.format}</Badge>
                <Badge variant="default" badgeStyle="outline" size="sm" className="inline-flex items-center gap-1">
                  {preset.delivery === 'email' ? <Mail className="h-2.5 w-2.5" /> : <Webhook className="h-2.5 w-2.5" />}
                  {preset.delivery === 'email' ? 'Email' : 'Webhook'}
                </Badge>
              </div>

              <div className="rounded-lg border border-admin-border/60 bg-white/[0.02] px-3 py-2 text-[10px] space-y-1">
                <div className="flex justify-between text-admin-muted">
                  <span>Last run</span>
                  <span className="font-medium tabular-nums text-admin-text">{preset.lastRun}</span>
                </div>
                <div className="flex justify-between text-admin-muted">
                  <span>Next run</span>
                  <span className="font-medium tabular-nums text-admin-text">{preset.nextRun}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Add New Schedule */}
      <div className="rounded-xl border border-admin-border bg-admin-card">
        <div className="px-5 py-3 border-b border-admin-border">
          <h3 className="text-sm font-semibold text-admin-text">Add Schedule</h3>
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
    </div>
  );
}
