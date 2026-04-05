'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { FileText, ExternalLink, Download, Calendar } from 'lucide-react';
import { adminFetch } from '@/lib/api';
import { downloadAnalyticsExport } from '@/lib/analytics-api';
import { useAdminAuthStore } from '@/store/auth';
import { cn } from '@/lib/cn';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, TableSkeleton } from '@/components/ui';

type AmlDashboard = Record<string, unknown>;

type RiskAlertRow = {
  id: string;
  user_id?: string;
  user_email?: string | null;
  alert_type?: string;
  type?: string;
  status?: string;
  details?: unknown;
  created_at?: string;
  amount?: number;
};

function num(v: unknown): string {
  return typeof v === 'number' && !Number.isNaN(v) ? String(v) : '—';
}

function StatCard({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <div className="rounded-xl border border-admin-border bg-admin-card p-4">
      <p className="text-[10px] font-medium uppercase tracking-wider text-admin-muted">{label}</p>
      <p className="mt-2 text-xl font-bold tabular-nums text-admin-text">
        {loading ? (
          <span className="inline-block h-5 w-16 animate-pulse rounded bg-white/5 align-middle" />
        ) : (
          value
        )}
      </p>
    </div>
  );
}

export default function CompliancePage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const [exporting, setExporting] = useState<string | null>(null);

  const amlQ = useQuery({
    queryKey: ['admin', 'aml', 'dashboard', token],
    staleTime: 30_000,
    queryFn: () => adminFetch<AmlDashboard>('/aml/dashboard', { token }),
    enabled: !!token,
    retry: false,
    refetchInterval: 60000,
  });

  const strQ = useQuery({
    queryKey: ['admin', 'compliance', 'str', token],
    staleTime: 30_000,
    queryFn: () =>
      adminFetch<{ alerts: RiskAlertRow[]; total?: number }>('/risk/alerts', {
        token,
        params: { status: 'escalated', limit: 20 },
      }),
    enabled: !!token,
    retry: false,
    refetchInterval: 60000,
  });

  const aml = amlQ.data?.success ? amlQ.data.data : undefined;
  const amlFailed = amlQ.isError || amlQ.data?.success === false;
  const strFailed = strQ.isError || strQ.data?.success === false;
  const amlLoading = amlQ.isLoading || amlQ.isFetching;

  const strPending = aml ? num(aml.str_pending ?? aml.strPending ?? aml.pending_str) : '—';
  const strSubmitted = aml ? num(aml.str_submitted ?? aml.strSubmitted ?? aml.str_filed) : '—';
  const kycRate = aml ? num(aml.kyc_completion_rate ?? aml.kycCompletionRate ?? aml.kyc_completion_percent) : '—';
  const amlOpen = aml ? num(aml.aml_alerts_open ?? aml.open_alerts ?? aml.alerts_open) : '—';
  const sanctions = aml ? num(aml.sanctions_checks_24h ?? aml.sanctions_checks ?? aml.sanctions_hits) : '—';

  const strReports: RiskAlertRow[] =
    strQ.data?.success && strQ.data.data?.alerts ? strQ.data.data.alerts : [];
  const strCount = strReports.filter((r) => {
    const s = (r.status ?? 'pending').toLowerCase();
    return s !== 'filed' && s !== 'reported' && s !== 'closed';
  }).length;

  function alertAmount(r: RiskAlertRow): number {
    const d = r.details;
    if (d && typeof d === 'object' && 'amount' in d) {
      const v = (d as { amount?: unknown }).amount;
      return typeof v === 'number' ? v : Number(v) || 0;
    }
    return Number(r.amount ?? 0) || 0;
  }

  const runExport = async (key: string, fn: () => Promise<void>) => {
    setExporting(key);
    try {
      await fn();
    } catch {
      /* download failed */
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className={cn('space-y-6 p-6')}>
      <div className="flex items-center gap-2">
        <FileText className="h-5 w-5 text-admin-primary" />
        <h1 className="text-xl font-semibold text-admin-text">Compliance & Reporting</h1>
      </div>

      {amlFailed && (
        <p className="text-sm text-red-600" role="alert">
          AML dashboard could not be loaded (
          {amlQ.isError
            ? amlQ.error instanceof Error
              ? amlQ.error.message
              : 'request failed'
            : (amlQ.data?.error?.message ?? 'request failed')}
          ). Stats below may show placeholders.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            STR (Suspicious Transaction Reports)
            <Badge variant="warning" className="text-[10px]">
              Regulatory
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="STR pending review" value={strPending} loading={amlLoading && !amlFailed} />
            <StatCard label="STR submitted (period)" value={strSubmitted} loading={amlLoading && !amlFailed} />
            <StatCard label="Open AML cases" value={amlOpen} loading={amlLoading && !amlFailed} />
            <StatCard label="Sanctions / screening" value={sanctions} loading={amlLoading && !amlFailed} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Suspicious Transaction Reports</CardTitle>
          <Badge variant="warning">{strCount} pending</Badge>
        </CardHeader>
        <CardContent>
          {strFailed && (
            <p className="mb-3 text-sm text-red-600" role="alert">
              Suspicious transaction list could not be loaded (
              {strQ.isError
                ? strQ.error instanceof Error
                  ? strQ.error.message
                  : 'request failed'
                : (strQ.data?.error?.message ?? 'request failed')}
              ).
            </p>
          )}
          {strQ.isLoading ? (
            <TableSkeleton rows={5} cols={6} />
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-admin-border text-left text-admin-muted">
                  <th className="pb-2 pr-4 font-medium">Report ID</th>
                  <th className="pb-2 pr-4 font-medium">User</th>
                  <th className="pb-2 pr-4 font-medium">Type</th>
                  <th className="pb-2 pr-4 font-medium">Amount</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 font-medium">Filed</th>
                </tr>
              </thead>
              <tbody>
                {strReports.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-admin-muted text-sm">
                      No STR reports found. Reports will appear here when suspicious activity is flagged.
                    </td>
                  </tr>
                ) : (
                  strReports.map((r: RiskAlertRow) => {
                    const st = (r.status ?? 'pending').toLowerCase();
                    const filed = st === 'filed' || st === 'reported';
                    return (
                      <tr key={r.id} className="border-b border-admin-border/50 last:border-0">
                        <td className="py-2.5 pr-4 text-xs font-mono">{r.id?.slice(0, 8)}...</td>
                        <td className="py-2.5 pr-4 text-xs">{r.user_email ?? r.user_id ?? '—'}</td>
                        <td className="py-2.5 pr-4 text-xs">{r.type ?? r.alert_type ?? '—'}</td>
                        <td className="py-2.5 pr-4 text-xs tabular-nums">${alertAmount(r).toLocaleString()}</td>
                        <td className="py-2.5 pr-4">
                          <Badge variant={filed ? 'success' : 'warning'} size="sm">
                            {r.status ?? 'pending'}
                          </Badge>
                        </td>
                        <td className="py-2.5 text-xs text-admin-muted">
                          {r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-admin-text">Compliance status</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="KYC completion rate" value={kycRate === '—' ? kycRate : `${kycRate}%`} loading={amlLoading && !aml} />
          <StatCard label="AML alerts open" value={amlOpen} loading={amlLoading && !aml} />
          <StatCard label="STR pending" value={strPending} loading={amlLoading && !aml} />
          <StatCard label="Sanctions checks" value={sanctions} loading={amlLoading && !aml} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Report generation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={!token || exporting === 'compliance'}
              loading={exporting === 'compliance'}
              icon={<Download className="h-4 w-4" />}
              onClick={() => runExport('compliance', () => downloadAnalyticsExport(token, 'aml-alerts', 'csv'))}
            >
              Compliance report
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!token || exporting === 'trading'}
              loading={exporting === 'trading'}
              icon={<Download className="h-4 w-4" />}
              onClick={() => runExport('trading', () => downloadAnalyticsExport(token, 'trading', 'csv'))}
            >
              Transaction report
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!token || exporting === 'audit'}
              loading={exporting === 'audit'}
              icon={<Download className="h-4 w-4" />}
              onClick={() => runExport('audit', () => downloadAnalyticsExport(token, 'users', 'json'))}
            >
              User audit
            </Button>
          </div>
          <p className="text-xs text-admin-muted">
            Compliance and user audit use analytics export (AML alerts and registered users). Transaction report exports spot trades.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Regulatory deadlines (reference)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-admin-muted">
          <p>Typical filing windows vary by jurisdiction. Use internal policy alongside these common anchors:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>STR / SAR: often required within 24–72 hours of suspicion confirmation.</li>
            <li>Large transaction reports: calendar-month or rolling thresholds per local AML rules.</li>
            <li>Sanctions list updates: screen within one business day of major list publications.</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Related consoles</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Link
            href="/risk"
            className="inline-flex items-center gap-1.5 rounded-ds-md border border-admin-border px-3 py-2 text-sm font-medium text-admin-text hover:bg-white/5"
          >
            Risk & AML <ExternalLink className="h-3.5 w-3.5 text-admin-muted" />
          </Link>
          <Link
            href="/kyc"
            className="inline-flex items-center gap-1.5 rounded-ds-md border border-admin-border px-3 py-2 text-sm font-medium text-admin-text hover:bg-white/5"
          >
            KYC queue <ExternalLink className="h-3.5 w-3.5 text-admin-muted" />
          </Link>
          <Link
            href="/audit/config"
            className="inline-flex items-center gap-1.5 rounded-ds-md border border-admin-border px-3 py-2 text-sm font-medium text-admin-text hover:bg-white/5"
          >
            Audit logs <ExternalLink className="h-3.5 w-3.5 text-admin-muted" />
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-4 w-4" /> Regulatory Calendar
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { date: 'Monthly', task: 'STR Filing Deadline', desc: 'Submit all pending STRs to regulatory authority' },
              { date: 'Quarterly', task: 'Compliance Report', desc: 'Generate and submit quarterly AML compliance report' },
              { date: 'Annually', task: 'Risk Assessment', desc: 'Complete annual money laundering risk assessment' },
              { date: 'Ongoing', task: 'Sanctions Screening', desc: 'Continuous screening against OFAC/EU/UN sanctions lists' },
            ].map((item, i) => (
              <div key={i} className="flex gap-4 items-start rounded-lg border border-admin-border p-3">
                <Badge variant="default" size="sm" className="shrink-0 mt-0.5">
                  {item.date}
                </Badge>
                <div>
                  <p className="text-sm font-medium text-admin-text">{item.task}</p>
                  <p className="text-xs text-admin-muted">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
