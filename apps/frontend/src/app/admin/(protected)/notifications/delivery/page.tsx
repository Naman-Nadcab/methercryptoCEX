'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader } from '@/components/admin/control-plane';
import { KPICard } from '@/components/admin/v2/dashboard';
import {
  Loader2,
  Send,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Filter,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface DeliverySummary {
  totalToday: number;
  verifiedToday: number;
  failedToday: number;
  successRate: number;
  avgVerifySeconds: number | null;
}

interface DeliveryRecord {
  id: string;
  identifier: string;
  type: string;
  attempts: number;
  max_attempts: number;
  verified_at: string | null;
  expires_at: string;
  created_at: string;
}

type StatusFilter = 'all' | 'verified' | 'failed' | 'pending';
type TypeFilter = 'all' | 'email' | 'phone';

export default function OTPDeliveryPage() {
  const { accessToken } = useAdminAuthStore();
  const [summary, setSummary] = useState<DeliverySummary | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const fetchData = useCallback(async (showRefresh = false) => {
    if (!accessToken) return;
    if (showRefresh) setRefreshing(true); else setLoading(true);

    try {
      const apiUrl = getApiBaseUrl();
      const params = new URLSearchParams();
      if (typeFilter !== 'all') params.set('type', typeFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);
      params.set('limit', String(pageSize));
      params.set('offset', String(page * pageSize));

      const res = await fetch(
        `${apiUrl}/api/v1/admin/notifications/delivery-stats?${params.toString()}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const json = await res.json();
      if (json.success && json.data) {
        setSummary(json.data.summary);
        setDeliveries(json.data.deliveries ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accessToken, typeFilter, statusFilter, dateFrom, dateTo, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function maskIdentifier(val: string): string {
    if (val.includes('@')) {
      const [local, domain] = val.split('@');
      return `${(local ?? '').slice(0, 2)}***@${domain}`;
    }
    if (val.length > 4) return `***${val.slice(-4)}`;
    return '****';
  }

  function getRowStatus(r: DeliveryRecord): 'verified' | 'failed' | 'pending' {
    if (r.verified_at) return 'verified';
    if (new Date(r.expires_at) < new Date()) return 'failed';
    return 'pending';
  }

  const statusBadge = (s: 'verified' | 'failed' | 'pending') => {
    const map = {
      verified: 'bg-emerald-100 text-emerald-700',
      failed: 'bg-red-100 text-red-700',
      pending: 'bg-amber-100 text-amber-700',
    };
    const labels = { verified: 'Verified', failed: 'Expired / Failed', pending: 'Pending' };
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${map[s]}`}>
        {s === 'verified' && <CheckCircle2 className="w-3 h-3" />}
        {s === 'failed' && <XCircle className="w-3 h-3" />}
        {s === 'pending' && <Clock className="w-3 h-3" />}
        {labels[s]}
      </span>
    );
  };

  function formatTime(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="OTP Delivery Dashboard"
        subtitle="Monitor OTP delivery performance, success rates and recent attempts"
      />

      {loading ? (
        <div className="flex items-center justify-center min-h-[200px]">
          <Loader2 className="w-8 h-8 text-[var(--admin-primary)] animate-spin" />
        </div>
      ) : (
        <>
          {/* Summary KPIs */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              title="Total OTPs today"
              value={summary?.totalToday ?? 0}
              changeLabel="All types combined"
              icon={<Send className="w-5 h-5" />}
              accent="primary"
            />
            <KPICard
              title="Success rate"
              value={`${summary?.successRate ?? 0}%`}
              changeLabel={`${summary?.verifiedToday ?? 0} verified`}
              icon={<CheckCircle2 className="w-5 h-5" />}
              accent={
                (summary?.successRate ?? 0) >= 90
                  ? 'success'
                  : (summary?.successRate ?? 0) >= 70
                    ? 'warning'
                    : 'danger'
              }
            />
            <KPICard
              title="Failed / expired"
              value={summary?.failedToday ?? 0}
              changeLabel="Unverified & expired"
              icon={<XCircle className="w-5 h-5" />}
              accent={(summary?.failedToday ?? 0) > 0 ? 'danger' : 'neutral'}
            />
            <KPICard
              title="Avg. verify time"
              value={summary?.avgVerifySeconds != null ? `${summary.avgVerifySeconds}s` : '—'}
              changeLabel="Time to enter OTP"
              icon={<Clock className="w-5 h-5" />}
              accent="neutral"
            />
          </div>

          {/* Filters */}
          <div className="admin-card rounded-xl border border-[var(--admin-card-border)] bg-white p-4 flex flex-wrap items-end gap-4">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--admin-text-muted)]">
              <Filter className="w-4 h-4" /> Filters
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--admin-text-muted)]">Type</label>
              <select
                value={typeFilter}
                onChange={(e) => { setTypeFilter(e.target.value as TypeFilter); setPage(0); }}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--admin-primary)]/30"
              >
                <option value="all">All</option>
                <option value="email">Email</option>
                <option value="phone">SMS / Phone</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--admin-text-muted)]">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setPage(0); }}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--admin-primary)]/30"
              >
                <option value="all">All</option>
                <option value="verified">Verified</option>
                <option value="failed">Failed / Expired</option>
                <option value="pending">Pending</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--admin-text-muted)]">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--admin-primary)]/30"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--admin-text-muted)]">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--admin-primary)]/30"
              />
            </div>
            <button
              onClick={() => fetchData(true)}
              disabled={refreshing}
              className="ml-auto flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-[var(--admin-primary)] text-white hover:opacity-90 transition disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {/* Delivery Table */}
          <div className="admin-card rounded-xl border border-[var(--admin-card-border)] bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="text-left py-3 px-4 font-semibold text-[var(--admin-text-muted)]">Identifier</th>
                    <th className="text-left py-3 px-4 font-semibold text-[var(--admin-text-muted)]">Type</th>
                    <th className="text-left py-3 px-4 font-semibold text-[var(--admin-text-muted)]">Status</th>
                    <th className="text-left py-3 px-4 font-semibold text-[var(--admin-text-muted)]">Attempts</th>
                    <th className="text-left py-3 px-4 font-semibold text-[var(--admin-text-muted)]">Sent at</th>
                    <th className="text-left py-3 px-4 font-semibold text-[var(--admin-text-muted)]">Verified at</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-[var(--admin-text-muted)]">
                        No OTP delivery records found
                      </td>
                    </tr>
                  ) : (
                    deliveries.map((r) => (
                      <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/30 transition-colors">
                        <td className="py-2.5 px-4 font-mono text-xs text-[var(--admin-text)]">
                          {maskIdentifier(r.identifier)}
                        </td>
                        <td className="py-2.5 px-4">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                            {r.type === 'email' ? 'Email' : r.type === 'phone' ? 'SMS' : r.type}
                          </span>
                        </td>
                        <td className="py-2.5 px-4">{statusBadge(getRowStatus(r))}</td>
                        <td className="py-2.5 px-4 text-[var(--admin-text-muted)]">
                          {r.attempts}/{r.max_attempts}
                        </td>
                        <td className="py-2.5 px-4 text-[var(--admin-text-muted)] text-xs">{formatTime(r.created_at)}</td>
                        <td className="py-2.5 px-4 text-[var(--admin-text-muted)] text-xs">
                          {r.verified_at ? formatTime(r.verified_at) : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <span className="text-xs text-[var(--admin-text-muted)]">
                Page {page + 1}{deliveries.length === pageSize ? '+' : ''}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="p-1.5 rounded-lg border border-gray-200 disabled:opacity-30 hover:bg-gray-50 transition"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={deliveries.length < pageSize}
                  className="p-1.5 rounded-lg border border-gray-200 disabled:opacity-30 hover:bg-gray-50 transition"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
