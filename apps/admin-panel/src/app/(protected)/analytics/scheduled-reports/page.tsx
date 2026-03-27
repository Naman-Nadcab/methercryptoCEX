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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ArrowLeft, Plus, Trash2, Loader2 } from 'lucide-react';

const REPORT_TYPES = ['trading', 'revenue', 'user-growth'] as const;
const FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
const FORMATS = ['csv', 'json', 'pdf'] as const;

export default function ScheduledReportsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
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
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteScheduledReport(token, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'analytics', 'scheduled-reports'] });
    },
  });

  const reports = (data?.data?.scheduled_reports ?? []) as ScheduledReportRow[];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Link href="/analytics" className="text-admin-muted hover:text-admin-primary">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Scheduled report exports</h1>
          <p className="mt-1 text-sm text-admin-muted">
            Schedule daily, weekly, or monthly analytics reports (CSV, JSON). PDF support coming later.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add scheduled report</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Report type</label>
              <select
                value={reportType}
                onChange={(e) => setReportType(e.target.value)}
                className="mt-1 rounded-lg border border-admin-border px-3 py-2 text-sm"
              >
                {REPORT_TYPES.map((r) => (
                  <option key={r} value={r}>{r.replace('-', ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Frequency</label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                className="mt-1 rounded-lg border border-admin-border px-3 py-2 text-sm"
              >
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Format</label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className="mt-1 rounded-lg border border-admin-border px-3 py-2 text-sm"
              >
                {FORMATS.map((f) => (
                  <option key={f} value={f} disabled={f === 'pdf'}>{f.toUpperCase()}{f === 'pdf' ? ' (future)' : ''}</option>
                ))}
              </select>
            </div>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || format === 'pdf'}
            >
              {createMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
              Add schedule
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active schedules</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border border-admin-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 font-medium text-admin-muted">Report</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Frequency</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Format</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Last run</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-admin-muted">Loading…</td>
                  </tr>
                ) : reports.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-admin-muted">No scheduled reports. Add one above.</td>
                  </tr>
                ) : (
                  reports.map((r) => (
                    <tr key={r.id} className="border-t border-admin-border hover:bg-gray-50/50">
                      <td className="px-4 py-3 font-medium capitalize">{r.report_type.replace('-', ' ')}</td>
                      <td className="px-4 py-3">{r.frequency}</td>
                      <td className="px-4 py-3">{r.format.toUpperCase()}</td>
                      <td className="px-4 py-3 text-admin-muted text-xs">
                        {r.last_run_at ? new Date(r.last_run_at).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteMutation.mutate(r.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4 text-admin-danger" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
