'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  getIntegrations,
  getIntegrationsHealth,
  getIntegrationsRateLimits,
  getWebhookDeliveries,
  getIntegrationEventLogs,
  createIntegration,
  updateIntegration,
  testIntegrationConnection,
  retryWebhookDelivery,
  switchIntegrationProvider,
  INTEGRATION_CATEGORIES,
  type IntegrationRow,
  type IntegrationCategory,
  type IntegrationRateLimitRow,
  type WebhookDeliveryRow,
  type IntegrationEventLogRow,
} from '@/lib/integrations-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/dashboard/StatCard';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { Plus, Pencil, Power, PowerOff, Wifi, Cable, Activity, Zap, ListOrdered, RefreshCw, ArrowRightLeft } from 'lucide-react';
import { cn } from '@/lib/cn';
import { TableSkeleton } from '@/components/ui';

function relativeTime(iso: string) {
  const d = new Date(iso);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec} seconds ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)} minutes ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} hours ago`;
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

const CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  blockchain_nodes: 'Blockchain Nodes',
  price_oracles: 'Price Oracles',
  compliance_providers: 'Compliance Providers',
  kyc_providers: 'KYC Providers',
  email_sms_gateways: 'Email / SMS Gateways',
  webhook_endpoints: 'Webhook Endpoints',
};

const WEBHOOK_EVENTS = [
  'deposit_confirmed',
  'withdrawal_completed',
  'trade_executed',
  'aml_alert_triggered',
];

export default function IntegrationsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<IntegrationCategory>('blockchain_nodes');
  const [modal, setModal] = useState<{ type: 'add' | 'edit'; row?: IntegrationRow | null } | null>(null);
  const [priorityModal, setPriorityModal] = useState<IntegrationRow | null>(null);
  const [priorityValue, setPriorityValue] = useState(1);
  const [switchModal, setSwitchModal] = useState<{ category: IntegrationCategory; integrations: IntegrationRow[] } | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'webhooks' | 'logs'>('overview');
  const [testResult, setTestResult] = useState<{ id: string; latency_ms: number; status: string; error?: string } | null>(null);
  const [form, setForm] = useState({
    provider_name: '',
    category: 'blockchain_nodes' as string,
    endpoint_url: '',
    api_key: '',
    secret_key: '',
    webhook_secret: '',
    status: 'inactive' as string,
    event_type: '',
    assets_covered: '',
    update_interval_sec: '' as string | number,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'integrations', token, category],
    staleTime: 30_000,
    queryFn: () => getIntegrations(token, category),
    enabled: !!token,
    refetchInterval: 15_000,
  });

  const { data: healthData } = useQuery({
    queryKey: ['admin', 'integrations', 'health', token],
    staleTime: 30_000,
    queryFn: () => getIntegrationsHealth(token),
    enabled: !!token,
    refetchInterval: 15_000,
  });

  const { data: rateLimitData } = useQuery({
    queryKey: ['admin', 'integrations', 'rate-limits', token],
    queryFn: () => getIntegrationsRateLimits(token),
    enabled: !!token,
    refetchInterval: 20_000,
  });

  const {
    data: deliveriesData,
    isLoading: deliveriesLoading,
    isError: deliveriesIsError,
    error: deliveriesQueryError,
  } = useQuery({
    queryKey: ['admin', 'integrations', 'webhook-deliveries', token],
    staleTime: 30_000,
    queryFn: () => getWebhookDeliveries(token, { limit: 50, offset: 0 }),
    enabled: !!token && activeTab === 'webhooks',
    refetchInterval: 15_000,
  });

  const {
    data: logsData,
    isLoading: logsLoading,
    isError: logsIsError,
    error: logsQueryError,
  } = useQuery({
    queryKey: ['admin', 'integrations', 'event-logs', token],
    staleTime: 30_000,
    queryFn: () => getIntegrationEventLogs(token, { limit: 50, offset: 0 }),
    enabled: !!token && activeTab === 'logs',
    refetchInterval: 15_000,
  });

  const createMutation = useMutation({
    mutationFn: (body: Parameters<typeof createIntegration>[1]) => createIntegration(token, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] });
      setModal(null);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof updateIntegration>[2] }) =>
      updateIntegration(token, id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] });
      setModal(null);
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => testIntegrationConnection(token, { id }),
    onSuccess: (res, id) => {
      if (res.data) setTestResult({ id, ...res.data });
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations', 'health'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations', 'event-logs'] });
    },
  });

  const priorityMutation = useMutation({
    mutationFn: ({ id, priority }: { id: string; priority: number }) => updateIntegration(token, id, { failover_priority: priority }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] });
      setPriorityModal(null);
    },
  });

  const switchMutation = useMutation({
    mutationFn: ({ category, providerId }: { category: string; providerId: string }) => switchIntegrationProvider(token, category, providerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] });
      setSwitchModal(null);
    },
  });

  const retryMutation = useMutation({
    mutationFn: (deliveryId: string) => retryWebhookDelivery(token, deliveryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations', 'webhook-deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'integrations', 'health'] });
    },
  });

  const health = healthData?.data;
  const rateLimits = (rateLimitData?.data?.rate_limits ?? []) as IntegrationRateLimitRow[];
  const deliveries = (deliveriesData?.data?.deliveries ?? []) as WebhookDeliveryRow[];
  const eventLogs = (logsData?.data?.logs ?? []) as IntegrationEventLogRow[];
  const deliveriesFetchFailed = deliveriesIsError || deliveriesData?.success === false;
  const logsFetchFailed = logsIsError || logsData?.success === false;
  const integrations = (data?.data?.integrations ?? []) as IntegrationRow[];
  const resetForm = () =>
    setForm({
      provider_name: '',
      category: 'blockchain_nodes',
      endpoint_url: '',
      api_key: '',
      secret_key: '',
      webhook_secret: '',
      status: 'inactive',
      event_type: '',
      assets_covered: '',
      update_interval_sec: '',
    });

  const openAdd = () => {
    resetForm();
    setForm((f) => ({ ...f, category }));
    setModal({ type: 'add' });
    setTestResult(null);
  };
  const openEdit = (row: IntegrationRow) => {
    setForm({
      provider_name: row.provider_name,
      category: row.category,
      endpoint_url: row.endpoint_url ?? '',
      api_key: '',
      secret_key: '',
      webhook_secret: '',
      status: row.status ?? 'inactive',
      event_type: row.event_type ?? '',
      assets_covered: row.assets_covered ?? '',
      update_interval_sec: row.update_interval_sec ?? '',
    });
    setModal({ type: 'edit', row });
    setTestResult(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      provider_name: form.provider_name.trim(),
      category: form.category,
      endpoint_url: form.endpoint_url || undefined,
      api_key: form.api_key.trim() || undefined,
      secret_key: form.secret_key.trim() || undefined,
      webhook_secret: form.webhook_secret.trim() || undefined,
      status: form.status,
      event_type: form.event_type || undefined,
      assets_covered: form.assets_covered || undefined,
      update_interval_sec: form.update_interval_sec === '' ? undefined : Number(form.update_interval_sec),
    };
    if (modal?.type === 'add') {
      createMutation.mutate(body);
    } else if (modal?.type === 'edit' && modal.row) {
      updateMutation.mutate({ id: modal.row.id, body });
    }
  };

  const handleToggleStatus = (row: IntegrationRow) => {
    const next = row.status === 'active' ? 'inactive' : 'active';
    updateMutation.mutate({ id: row.id, body: { status: next } });
  };

  const openPriorityModal = (row: IntegrationRow) => {
    setPriorityValue(row.failover_priority ?? 1);
    setPriorityModal(row);
  };

  const openSwitchModal = () => {
    setSwitchModal({ category, integrations });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-admin-text">Integrations</h1>
          <p className="text-xs text-admin-muted mt-0.5">Manage external services, API keys, test connections, and webhooks.</p>
        </div>
        <Button size="sm" onClick={openAdd}>
          <Plus className="mr-1 h-4 w-4" />
          Add integration
        </Button>
      </div>

      {health && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Active Integrations" value={health.active_integrations} icon={Cable} />
          <StatCard title="Failed Integrations" value={health.failed_integrations} icon={Activity} />
          <StatCard title="Average API Latency" value={`${health.average_latency_ms} ms`} icon={Zap} />
          <StatCard title="Webhook Delivery Rate" value={`${health.webhook_delivery_rate_percent}%`} icon={RefreshCw} />
        </div>
      )}

      <div className="flex gap-2 border-b border-admin-border pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={cn('rounded-lg px-3 py-1.5 text-sm font-medium', activeTab === 'overview' ? 'bg-admin-primary/10 text-admin-primary' : 'text-admin-muted hover:bg-white/5')}
        >
          Overview
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('webhooks')}
          className={cn('rounded-lg px-3 py-1.5 text-sm font-medium', activeTab === 'webhooks' ? 'bg-admin-primary/10 text-admin-primary' : 'text-admin-muted hover:bg-white/5')}
        >
          Webhook deliveries
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('logs')}
          className={cn('rounded-lg px-3 py-1.5 text-sm font-medium', activeTab === 'logs' ? 'bg-admin-primary/10 text-admin-primary' : 'text-admin-muted hover:bg-white/5')}
        >
          Event logs
        </button>
      </div>

      {activeTab === 'overview' && (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Categories</CardTitle>
          {integrations.length > 0 && (
            <Button variant="secondary" size="sm" onClick={openSwitchModal} title="Switch active provider for this category">
              <ArrowRightLeft className="mr-1 h-4 w-4" />
              Switch provider
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 border-b border-admin-border pb-4">
            {INTEGRATION_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={cn(
                  'rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                  category === cat
                    ? 'border-admin-primary bg-admin-primary/10 text-admin-primary'
                    : 'border-admin-border bg-admin-card text-admin-muted hover:bg-white/5'
                )}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-admin-border bg-admin-card">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="bg-white/[0.02]">
                <tr>
                  <th className="px-4 py-3 font-medium text-admin-muted">Provider</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Category</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Endpoint</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Latency</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Last success</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Errors</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Priority</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Status</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Last Updated</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-admin-muted">
                      Loading…
                    </td>
                  </tr>
                ) : integrations.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-admin-muted">
                      No integrations in this category.
                    </td>
                  </tr>
                ) : (
                  integrations.map((row) => (
                    <tr key={row.id} className="border-t border-admin-border hover:bg-white/5">
                      <td className="px-4 py-3 font-medium">{row.provider_name}</td>
                      <td className="px-4 py-3 text-admin-text">
                        {CATEGORY_LABELS[row.category as IntegrationCategory] ?? row.category}
                      </td>
                      <td className="max-w-[180px] truncate font-mono text-xs text-admin-muted" title={row.endpoint_url}>
                        {row.endpoint_url || '—'}
                      </td>
                      <td className="px-4 py-3 text-admin-muted">
                        {row.latency_ms != null ? `${row.latency_ms} ms` : '—'}
                      </td>
                      <td className="px-4 py-3 text-admin-muted text-xs">
                        {row.last_successful_request ? relativeTime(row.last_successful_request) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {(row.error_count ?? 0) > 0 ? (
                          <span className="text-admin-danger font-medium">{row.error_count} errors</span>
                        ) : (
                          '0'
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="mr-1">{row.failover_priority ?? 1}</span>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openPriorityModal(row)} title="Set failover priority">
                          <ListOrdered className="h-4 w-4" />
                        </Button>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={row.status} variant={row.status === 'active' ? 'success' : 'default'} />
                      </td>
                      <td className="px-4 py-3 text-admin-muted text-xs">
                        {row.updated_at ? new Date(row.updated_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(row)} title="Edit">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggleStatus(row)}
                            title={row.status === 'active' ? 'Disable' : 'Enable'}
                          >
                            {row.status === 'active' ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => testMutation.mutate(row.id)}
                            disabled={testMutation.isPending}
                            title="Test connection"
                          >
                            <Wifi className="h-4 w-4" />
                          </Button>
                        </div>
                        {testResult?.id === row.id && (
                          <div className="mt-1 rounded bg-white/5 px-2 py-1 text-xs">
                            Latency: {testResult.latency_ms} ms · Status: {testResult.status}
                            {testResult.error && ` · ${testResult.error}`}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {category === 'webhook_endpoints' && integrations.some((r) => r.event_type) && (
            <div className="mt-4">
              <h4 className="mb-2 text-sm font-medium text-admin-text">Webhooks</h4>
              <div className="overflow-x-auto rounded-lg border border-admin-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-white/[0.02]">
                    <tr>
                      <th className="px-4 py-2 font-medium text-admin-muted">Webhook URL</th>
                      <th className="px-4 py-2 font-medium text-admin-muted">Event Type</th>
                      <th className="px-4 py-2 font-medium text-admin-muted">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {integrations
                      .filter((r) => r.event_type)
                      .map((r) => (
                        <tr key={r.id} className="border-t border-admin-border">
                          <td className="max-w-[240px] truncate px-4 py-2 font-mono text-xs">{r.endpoint_url || '—'}</td>
                          <td className="px-4 py-2">{r.event_type}</td>
                          <td className="px-4 py-2">
                            <StatusBadge status={r.status} />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {category === 'price_oracles' && integrations.length > 0 && (
            <div className="mt-4">
              <h4 className="mb-2 text-sm font-medium text-admin-text">Oracle providers</h4>
              <div className="overflow-x-auto rounded-lg border border-admin-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-white/[0.02]">
                    <tr>
                      <th className="px-4 py-2 font-medium text-admin-muted">Provider</th>
                      <th className="px-4 py-2 font-medium text-admin-muted">Assets covered</th>
                      <th className="px-4 py-2 font-medium text-admin-muted">Update interval</th>
                      <th className="px-4 py-2 font-medium text-admin-muted">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {integrations.map((r) => (
                      <tr key={r.id} className="border-t border-admin-border">
                        <td className="px-4 py-2 font-medium">{r.provider_name}</td>
                        <td className="px-4 py-2">{r.assets_covered || '—'}</td>
                        <td className="px-4 py-2">{r.update_interval_sec != null ? `${r.update_interval_sec}s` : '—'}</td>
                        <td className="px-4 py-2">
                          <StatusBadge status={r.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {rateLimits.length > 0 && (
            <div className="mt-6">
              <h4 className="mb-2 text-sm font-medium text-admin-text">API rate limits</h4>
              <div className="overflow-x-auto rounded-lg border border-admin-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-white/[0.02]">
                    <tr>
                      <th className="px-4 py-2 font-medium text-admin-muted">Provider</th>
                      <th className="px-4 py-2 font-medium text-admin-muted">Category</th>
                      <th className="px-4 py-2 font-medium text-admin-muted">Requests/min</th>
                      <th className="px-4 py-2 font-medium text-admin-muted">Remaining</th>
                      <th className="px-4 py-2 font-medium text-admin-muted">Resets at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rateLimits.map((r) => (
                      <tr key={r.integration_id} className="border-t border-admin-border">
                        <td className="px-4 py-2 font-medium">{r.provider_name}</td>
                        <td className="px-4 py-2">{CATEGORY_LABELS[r.category as IntegrationCategory] ?? r.category}</td>
                        <td className="px-4 py-2">{r.requests_per_min}</td>
                        <td className="px-4 py-2">{r.remaining_quota ?? '—'}</td>
                        <td className="px-4 py-2 text-admin-muted text-xs">{r.resets_at ? new Date(r.resets_at).toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {activeTab === 'webhooks' && (
        <Card>
          <CardHeader>
            <CardTitle>Webhook delivery history</CardTitle>
          </CardHeader>
          <CardContent>
            {deliveriesLoading ? (
              <TableSkeleton rows={5} cols={7} />
            ) : deliveriesFetchFailed ? (
              <p className="px-4 py-8 text-center text-sm text-admin-danger" role="alert">
                {(deliveriesQueryError as Error)?.message ??
                  deliveriesData?.error?.message ??
                  'Failed to load webhook deliveries.'}
              </p>
            ) : (
            <div className="overflow-x-auto rounded-xl border border-admin-border">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-white/[0.02]">
                  <tr>
                    <th className="px-4 py-3 font-medium text-admin-muted">Webhook URL</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Event type</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Status</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Response</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Retries</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Time</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-admin-muted">
                        No webhook deliveries yet.
                      </td>
                    </tr>
                  ) : (
                    deliveries.map((d) => (
                      <tr key={d.id} className="border-t border-admin-border hover:bg-white/5">
                        <td className="max-w-[200px] truncate px-4 py-3 font-mono text-xs" title={d.webhook_url}>{d.webhook_url || '—'}</td>
                        <td className="px-4 py-3">{d.event_type || '—'}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={d.delivery_status} variant={d.delivery_status === 'success' ? 'success' : d.delivery_status === 'failed' ? 'danger' : 'default'} />
                        </td>
                        <td className="px-4 py-3">{d.response_code ?? '—'}</td>
                        <td className="px-4 py-3">{d.retry_count}</td>
                        <td className="px-4 py-3 text-admin-muted text-xs">{relativeTime(d.time)}</td>
                        <td className="px-4 py-3">
                          {d.delivery_status !== 'success' && (
                            <Button variant="secondary" size="sm" onClick={() => retryMutation.mutate(d.id)} disabled={retryMutation.isPending}>
                              Retry delivery
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'logs' && (
        <Card>
          <CardHeader>
            <CardTitle>Integration event logs</CardTitle>
          </CardHeader>
          <CardContent>
            {logsLoading ? (
              <TableSkeleton rows={5} cols={5} />
            ) : logsFetchFailed ? (
              <p className="px-4 py-8 text-center text-sm text-admin-danger" role="alert">
                {(logsQueryError as Error)?.message ??
                  logsData?.error?.message ??
                  'Failed to load integration event logs.'}
              </p>
            ) : (
            <div className="overflow-x-auto rounded-xl border border-admin-border">
              <table className="w-full min-w-[500px] text-left text-sm">
                <thead className="bg-white/[0.02]">
                  <tr>
                    <th className="px-4 py-3 font-medium text-admin-muted">Integration</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Event</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Status</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Latency</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {eventLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-admin-muted">
                        No event logs yet.
                      </td>
                    </tr>
                  ) : (
                    eventLogs.map((log, i) => (
                      <tr key={i} className="border-t border-admin-border hover:bg-white/5">
                        <td className="px-4 py-3 font-medium">{log.integration}</td>
                        <td className="px-4 py-3">{log.event}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={log.status} variant={log.status === 'success' ? 'success' : 'danger'} />
                        </td>
                        <td className="px-4 py-3">{log.latency_ms != null ? `${log.latency_ms} ms` : '—'}</td>
                        <td className="px-4 py-3 text-admin-muted text-xs">{relativeTime(log.timestamp)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            )}
          </CardContent>
        </Card>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setModal(null)}>
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-admin-card p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-admin-text">
              {modal.type === 'add' ? 'Add integration' : 'Edit integration'}
            </h3>
            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-admin-text">Provider name *</label>
                <input
                  type="text"
                  value={form.provider_name}
                  onChange={(e) => setForm((f) => ({ ...f, provider_name: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-admin-text">Category *</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                  disabled={modal.type === 'edit'}
                >
                  {INTEGRATION_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-admin-text">Endpoint URL</label>
                <input
                  type="url"
                  value={form.endpoint_url}
                  onChange={(e) => setForm((f) => ({ ...f, endpoint_url: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-admin-text">API Key (leave blank to keep current)</label>
                <input
                  type="password"
                  value={form.api_key}
                  onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-admin-text">Secret Key (leave blank to keep current)</label>
                <input
                  type="password"
                  value={form.secret_key}
                  onChange={(e) => setForm((f) => ({ ...f, secret_key: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-admin-text">Webhook Secret (leave blank to keep current)</label>
                <input
                  type="password"
                  value={form.webhook_secret}
                  onChange={(e) => setForm((f) => ({ ...f, webhook_secret: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                  placeholder="••••••••"
                />
              </div>
              {(form.category === 'webhook_endpoints') && (
                <div>
                  <label className="block text-sm font-medium text-admin-text">Event type</label>
                  <select
                    value={form.event_type}
                    onChange={(e) => setForm((f) => ({ ...f, event_type: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                  >
                    <option value="">—</option>
                    {WEBHOOK_EVENTS.map((ev) => (
                      <option key={ev} value={ev}>
                        {ev}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {(form.category === 'price_oracles') && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-admin-text">Assets covered</label>
                    <input
                      type="text"
                      value={form.assets_covered}
                      onChange={(e) => setForm((f) => ({ ...f, assets_covered: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                      placeholder="BTC, ETH"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-admin-text">Update interval (seconds)</label>
                    <input
                      type="number"
                      min={1}
                      value={form.update_interval_sec}
                      onChange={(e) => setForm((f) => ({ ...f, update_interval_sec: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                    />
                  </div>
                </>
              )}
              <div>
                <label className="block text-sm font-medium text-admin-text">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setModal(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {modal.type === 'add' ? 'Add' : 'Save'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {priorityModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setPriorityModal(null)}>
          <div className="w-full max-w-sm rounded-xl bg-admin-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-admin-text">Failover priority</h3>
            <p className="mt-1 text-sm text-admin-muted">{priorityModal.provider_name} — set priority (lower = used first)</p>
            <div className="mt-4 flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={priorityValue}
                onChange={(e) => setPriorityValue(Number(e.target.value) || 1)}
                className="w-24 rounded-lg border border-admin-border px-3 py-2 text-sm"
              />
              <Button
                onClick={() => priorityMutation.mutate({ id: priorityModal.id, priority: priorityValue })}
                disabled={priorityMutation.isPending}
              >
                Save
              </Button>
            </div>
            <Button variant="secondary" className="mt-4 w-full" onClick={() => setPriorityModal(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {switchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setSwitchModal(null)}>
          <div className="w-full max-w-md rounded-xl bg-admin-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-admin-text">Switch provider</h3>
            <p className="mt-1 text-sm text-admin-muted">
              Set active provider for {CATEGORY_LABELS[switchModal.category]}.
            </p>
            <ul className="mt-4 space-y-2">
              {switchModal.integrations.map((row) => (
                <li key={row.id} className="flex items-center justify-between rounded-lg border border-admin-border px-3 py-2">
                  <span className="font-medium">{row.provider_name}</span>
                  <Button
                    size="sm"
                    onClick={() => switchMutation.mutate({ category: switchModal.category, providerId: row.id })}
                    disabled={switchMutation.isPending}
                  >
                    Use this provider
                  </Button>
                </li>
              ))}
            </ul>
            <Button variant="secondary" className="mt-4 w-full" onClick={() => setSwitchModal(null)}>
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
