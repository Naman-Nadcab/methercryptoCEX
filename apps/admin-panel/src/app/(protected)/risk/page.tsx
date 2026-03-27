'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  getRiskDashboard,
  getRiskAlerts,
  getRiskSuspicious,
  getRiskHighRiskUsers,
  getRiskSanctions,
  downloadRiskExport,
  updateAmlAlertStatus,
  escalateAmlAlertToStr,
  freezeAccountFromAlert,
  type AmlAlertRow,
  type HighRiskUserRow,
  type SanctionRow,
} from '@/lib/risk-api';
import { StatCard } from '@/components/dashboard/StatCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { exportStandardCsv, exportStandardJson, type StandardExportRow } from '@/lib/export-utils';
import { AmlAlertsTable } from '@/components/risk/AmlAlertsTable';
import { AlertActionModal, type AlertActionType } from '@/components/risk/AlertActionModal';
import { HighRiskUsersTable } from '@/components/risk/HighRiskUsersTable';
import { RiskDistributionCards } from '@/components/risk/RiskDistributionCards';
import { SanctionsTable } from '@/components/risk/SanctionsTable';
import { useAdminWs } from '@/hooks/useAdminWs';
import { AlertTriangle, Users, Activity, FileText, Settings, Download, ChevronDown, Zap, Sliders } from 'lucide-react';

export default function RiskPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [alertsPage, setAlertsPage] = useState(1);
  const [alertsStatus, setAlertsStatus] = useState<string>('all');
  const [alertModal, setAlertModal] = useState<{ action: AlertActionType; alert: AmlAlertRow | null } | null>(null);
  const [exportDropdown, setExportDropdown] = useState(false);
  const [exporting, setExporting] = useState(false);

  const { data: dashboardData } = useQuery({
    queryKey: ['admin', 'risk', token],
    queryFn: () => getRiskDashboard(token),
    enabled: !!token,
  });

  const { data: suspiciousData } = useQuery({
    queryKey: ['admin', 'risk', 'suspicious', token],
    queryFn: () => getRiskSuspicious(token),
    enabled: !!token,
  });

  const { data: alertsData, isLoading: alertsLoading } = useQuery({
    queryKey: ['admin', 'risk', 'alerts', token, alertsPage, alertsStatus],
    queryFn: () =>
      getRiskAlerts(token, {
        limit: 20,
        offset: (alertsPage - 1) * 20,
        status: alertsStatus === 'all' ? undefined : alertsStatus,
      }),
    enabled: !!token,
  });

  const { data: highRiskData, isLoading: highRiskLoading } = useQuery({
    queryKey: ['admin', 'risk', 'high-risk-users', token],
    queryFn: () => getRiskHighRiskUsers(token, { limit: 50 }),
    enabled: !!token,
  });

  const { data: sanctionsData, isLoading: sanctionsLoading } = useQuery({
    queryKey: ['admin', 'risk', 'sanctions', token],
    queryFn: () => getRiskSanctions(token, { limit: 50 }),
    enabled: !!token,
  });

  useAdminWs({
    onEvent: (ev) => {
      const t = (ev?.type as string) ?? '';
      if (
        t === 'aml_alert_triggered' ||
        t === 'suspicious_trade' ||
        t === 'large_withdrawal' ||
        t === 'sanction_detected'
      ) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'risk'] });
      }
    },
  });

  const dashboard = dashboardData?.data;
  const suspicious = suspiciousData?.data;
  const alertsPayload = alertsData?.data;
  const alerts = (alertsPayload?.alerts ?? []) as AmlAlertRow[];
  const alertsTotal = alertsPayload?.total ?? 0;
  const alertsTotalPages = Math.ceil(alertsTotal / 20) || 1;
  const highRiskUsers = (highRiskData?.data?.users ?? []) as HighRiskUserRow[];
  const sanctions = (sanctionsData?.data?.items ?? []) as SanctionRow[];

  const handleExport = async (type: 'aml-alerts' | 'str-reports' | 'suspicious-trades', format: 'csv' | 'json') => {
    setExporting(true);
    setExportDropdown(false);
    await downloadRiskExport(token, type, format);
    setExporting(false);
  };

  const updateStatusMutation = useMutation({
    mutationFn: ({ alertId, status, note }: { alertId: string; status: string; note?: string }) =>
      updateAmlAlertStatus(token, alertId, { status, note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'risk'] });
      setAlertModal(null);
    },
  });

  const escalateMutation = useMutation({
    mutationFn: (alertId: string) => escalateAmlAlertToStr(token, alertId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'risk'] });
      setAlertModal(null);
    },
  });

  const freezeMutation = useMutation({
    mutationFn: ({ alertId, reason }: { alertId: string; reason?: string }) =>
      freezeAccountFromAlert(token, alertId, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'risk'] });
      setAlertModal(null);
    },
  });

  const handleAlertActionConfirm = (payload: { note?: string; reason?: string }) => {
    const { action, alert } = alertModal ?? {};
    if (!alert) return;
    if (action === 'review') {
      updateStatusMutation.mutate({ alertId: alert.id, status: 'reviewing', note: payload.note });
    } else if (action === 'close') {
      updateStatusMutation.mutate({ alertId: alert.id, status: 'closed', note: payload.note });
    } else if (action === 'escalate') {
      escalateMutation.mutate(alert.id);
    } else if (action === 'freeze') {
      freezeMutation.mutate({ alertId: alert.id, reason: payload.reason });
    }
  };

  const isActionLoading =
    updateStatusMutation.isPending || escalateMutation.isPending || freezeMutation.isPending;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Risk & AML</h1>
          <p className="mt-1 text-sm text-admin-muted">
            Monitor AML alerts, suspicious trading, and high-risk users. Review and escalate alerts.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/risk/settings">
            <Button variant="secondary" size="sm">
              <Settings className="mr-1 h-4 w-4" />
              Risk rules
            </Button>
          </Link>
          <Link href="/risk/automation">
            <Button variant="secondary" size="sm">
              <Zap className="mr-1 h-4 w-4" />
              Automation
            </Button>
          </Link>
          <Link href="/risk/severity-settings">
            <Button variant="secondary" size="sm">
              <Sliders className="mr-1 h-4 w-4" />
              Severity
            </Button>
          </Link>
          <div className="relative">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setExportDropdown((v) => !v)}
              disabled={exporting}
            >
              <Download className="mr-1 h-4 w-4" />
              Export {exporting ? '…' : ''}
              <ChevronDown className="ml-1 h-4 w-4" />
            </Button>
            {exportDropdown && (
              <div className="absolute right-0 top-full z-10 mt-1 w-56 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                <p className="px-3 py-1 text-xs font-medium text-admin-muted">AML Alerts</p>
                <button type="button" onClick={() => handleExport('aml-alerts', 'csv')} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50">CSV</button>
                <button type="button" onClick={() => handleExport('aml-alerts', 'json')} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50">JSON</button>
                <p className="mt-2 px-3 py-1 text-xs font-medium text-admin-muted">STR Reports</p>
                <button type="button" onClick={() => handleExport('str-reports', 'csv')} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50">CSV</button>
                <button type="button" onClick={() => handleExport('str-reports', 'json')} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50">JSON</button>
                <p className="mt-2 px-3 py-1 text-xs font-medium text-admin-muted">Suspicious Trades</p>
                <button type="button" onClick={() => handleExport('suspicious-trades', 'csv')} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50">CSV</button>
                <button type="button" onClick={() => handleExport('suspicious-trades', 'json')} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50">JSON</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Open AML Alerts"
          value={dashboard?.open_aml_alerts ?? '—'}
          icon={AlertTriangle}
          iconBg="bg-amber-100 text-amber-700"
        />
        <StatCard
          title="High Risk Users"
          value={dashboard?.high_risk_users ?? '—'}
          icon={Users}
          iconBg="bg-red-100 text-red-700"
        />
        <StatCard
          title="Suspicious Trades"
          value={dashboard?.suspicious_trades ?? '—'}
          icon={Activity}
          iconBg="bg-orange-100 text-orange-700"
        />
        <StatCard
          title="STR Reports"
          value={dashboard?.str_reports ?? '—'}
          icon={FileText}
          iconBg="bg-slate-100 text-slate-700"
        />
      </div>

      <RiskDistributionCards distribution={dashboard?.risk_distribution} />

      <Card>
        <CardHeader>
          <CardTitle>Sanction Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {sanctionsLoading ? (
            <div className="py-8 text-center text-admin-muted">Loading…</div>
          ) : (
            <SanctionsTable rows={sanctions} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Suspicious Trading Detection</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-4">
              <p className="text-sm font-medium text-gray-700">Whale Trades (24h)</p>
              <p className="text-2xl font-semibold text-gray-900">{suspicious?.whale_trades ?? '—'}</p>
            </div>
            <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-4">
              <p className="text-sm font-medium text-gray-700">Rapid Orders (5m)</p>
              <p className="text-2xl font-semibold text-gray-900">{suspicious?.rapid_orders ?? '—'}</p>
            </div>
            <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-4">
              <p className="text-sm font-medium text-gray-700">Order Cancel Rate %</p>
              <p className="text-2xl font-semibold text-gray-900">{suspicious?.order_cancel_rate ?? '—'}%</p>
            </div>
            <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-4">
              <p className="text-sm font-medium text-gray-700">Price Manipulation Alerts</p>
              <p className="text-2xl font-semibold text-gray-900">{suspicious?.price_manipulation_alerts ?? '—'}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
          <CardTitle>AML Alerts</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={alertsStatus}
              onChange={(e) => { setAlertsStatus(e.target.value); setAlertsPage(1); }}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-sm"
            >
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="reviewing">Reviewing</option>
              <option value="closed">Closed</option>
              <option value="reported">Reported</option>
            </select>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const rows: StandardExportRow[] = alerts.map((a) => ({
                  timestamp: a.created_at ?? '',
                  type: a.alert_type,
                  service: 'risk',
                  admin: '',
                  details: [a.severity, a.status, typeof a.details === 'string' ? a.details : a.details != null ? JSON.stringify(a.details) : ''].filter(Boolean).join(' '),
                }));
                exportStandardCsv(rows, 'risk_alerts');
              }}
            >
              Export CSV
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const rows: StandardExportRow[] = alerts.map((a) => ({
                  timestamp: a.created_at ?? '',
                  type: a.alert_type,
                  service: 'risk',
                  admin: '',
                  details: [a.severity, a.status, typeof a.details === 'string' ? a.details : a.details != null ? JSON.stringify(a.details) : ''].filter(Boolean).join(' '),
                }));
                exportStandardJson(rows, 'risk_alerts');
              }}
            >
              Export JSON
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {alertsLoading ? (
            <div className="py-8 text-center text-admin-muted">Loading…</div>
          ) : (
            <>
              <AmlAlertsTable
                rows={alerts}
                onReview={(row) => setAlertModal({ action: 'review', alert: row })}
                onClose={(row) => setAlertModal({ action: 'close', alert: row })}
                onEscalate={(row) => setAlertModal({ action: 'escalate', alert: row })}
                onFreeze={(row) => setAlertModal({ action: 'freeze', alert: row })}
              />
              {alertsTotalPages > 1 && (
                <div className="mt-4 flex items-center justify-between text-sm text-admin-muted">
                  <span>
                    Page {alertsPage} of {alertsTotalPages} ({alertsTotal} alerts)
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={alertsPage <= 1}
                      onClick={() => setAlertsPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={alertsPage >= alertsTotalPages}
                      onClick={() => setAlertsPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>High Risk Users</CardTitle>
        </CardHeader>
        <CardContent>
          {highRiskLoading ? (
            <div className="py-8 text-center text-admin-muted">Loading…</div>
          ) : (
            <HighRiskUsersTable rows={highRiskUsers} />
          )}
        </CardContent>
      </Card>

      <AlertActionModal
        open={!!alertModal}
        action={alertModal?.action ?? 'review'}
        alert={alertModal?.alert ?? null}
        onClose={() => setAlertModal(null)}
        onConfirm={handleAlertActionConfirm}
        isLoading={isActionLoading}
      />
    </div>
  );
}
