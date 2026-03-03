'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader, Panel, MetricWidget } from '@/components/admin/control-plane';
import { Loader2, AlertCircle } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface AmlDashboard {
  alertsOpen?: number;
  alertsOpenHighSeverity?: number;
  strPending?: number;
  ctrPending?: number;
  totalInrToday?: string;
  largeInrTxnsToday?: number;
  largeInrThreshold?: number;
  kycViolationLast7Days?: number;
}

export default function CompliancePage() {
  const { accessToken } = useAdminAuthStore();
  const [dashboard, setDashboard] = useState<AmlDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/aml/dashboard`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (data?.success && data?.data) {
        setDashboard(data.data);
      } else {
        setError(data?.error?.message ?? 'Failed to load AML dashboard');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  if (loading && !dashboard) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="AML / Compliance"
        subtitle="FIU-IND transaction monitoring, alerts, and STR/CTR readiness"
      />
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {dashboard && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricWidget
              label="Open AML alerts"
              value={dashboard.alertsOpen ?? 0}
              variant={(dashboard.alertsOpen ?? 0) > 0 ? 'warning' : 'neutral'}
            />
            <MetricWidget
              label="High severity open"
              value={dashboard.alertsOpenHighSeverity ?? 0}
              variant={(dashboard.alertsOpenHighSeverity ?? 0) > 0 ? 'danger' : 'neutral'}
            />
            <MetricWidget
              label="Pending STR"
              value={dashboard.strPending ?? 0}
              variant={(dashboard.strPending ?? 0) > 0 ? 'warning' : 'neutral'}
            />
            <MetricWidget
              label="Pending CTR"
              value={dashboard.ctrPending ?? 0}
              variant={(dashboard.ctrPending ?? 0) > 0 ? 'warning' : 'neutral'}
            />
          </div>
          <Panel title="AML API" subtitle="Use backend AML endpoints for alerts list, report list, submit, and acknowledge.">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              GET /api/v1/admin/aml/alerts — list alerts. GET /api/v1/admin/aml/reports — list STR/CTR reports.
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}
