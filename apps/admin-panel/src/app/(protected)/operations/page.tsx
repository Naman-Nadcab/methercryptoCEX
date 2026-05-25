'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  Activity, Sliders, Siren, Cable, Server, CheckSquare,
  SlidersHorizontal, LayoutGrid, Zap, ShieldCheck, AlertTriangle,
  ArrowRight, Clock, Database, Wifi, Cpu, HardDrive, BarChart3,
  TrendingUp, Wallet, BookOpen, ChevronRight, Radio,
  RefreshCw, Flame, ListOrdered,
} from 'lucide-react';
import { adminFetch, formatAdminError } from '@/lib/api';
import { useAdminAuthStore } from '@/store/auth';
import { cn } from '@/lib/cn';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { ActionAuthModal, type ActionAuthPayload } from '@/components/ops/ActionAuthModal';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SmartAlert {
  type: string;
  severity: string;
  message: string;
  count?: number;
}

interface OpsIncident {
  type: string;
  count: number;
  severity: string;
}

interface ActionCenterItem {
  key: string;
  severity: 'critical' | 'high' | 'medium';
  title: string;
  detail: string;
  count?: number;
  action_path: string;
}

interface Playbooks {
  [key: string]: string;
}

interface JobHealthRow {
  job_id: string;
  status: 'healthy' | 'lagging' | 'degraded';
  lag_seconds: number | null;
  fail_count: number;
  queue_depth: number;
  last_error: string | null;
  recovery_actions: string[];
}

interface OpsIntelligenceData {
  period: string;
  action_latency_ms: { avg: number; p95: number };
  incident_frequency: number;
  provider_failovers: number;
  failed_action_classes: Array<{ action: string; count: number }>;
}

interface ConfigSnapshotRow {
  id: string;
  scope: string;
  reason: string;
  actor_admin_id: string | null;
  created_at: string;
}

interface ApprovalPolicyRow {
  key: string;
  label: string;
  mode: 'always_dual' | 'single_allowed';
  required_approvals: number;
  require_distinct_role: boolean;
  allowed_checker_roles: string[];
}

interface ApprovalPolicyHistoryRow {
  id: string;
  actor_id: string | null;
  created_at: string;
  details: Record<string, unknown> | null;
}

/* ------------------------------------------------------------------ */
/*  Hub links                                                          */
/* ------------------------------------------------------------------ */

const HUB_SECTIONS: {
  title: string;
  items: { href: string; title: string; desc: string; icon: typeof Activity; accent: string }[];
}[] = [
  {
    title: 'Command & Control',
    items: [
      { href: '/control-center', title: 'Control Center', desc: 'Fee settings, risk thresholds, geo-blocking, feature flags, and system toggles.', icon: LayoutGrid, accent: 'from-blue-500/20 to-blue-600/5 border-blue-500/20 text-blue-400' },
      { href: '/admin-control', title: 'Exchange Controls', desc: 'Circuit breakers, trading halts, emergency mode, and asset freeze controls.', icon: Sliders, accent: 'from-red-500/20 to-red-600/5 border-red-500/20 text-red-400' },
      { href: '/approvals', title: 'Dual Approvals', desc: 'Pending maker-checker requests for withdrawals, credits, and sensitive actions.', icon: CheckSquare, accent: 'from-purple-500/20 to-purple-600/5 border-purple-500/20 text-purple-400' },
    ],
  },
  {
    title: 'Observability',
    items: [
      { href: '/monitoring', title: 'Monitoring', desc: 'Health, queues, RPC providers, latency history, and infrastructure signals.', icon: Activity, accent: 'from-emerald-500/20 to-emerald-600/5 border-emerald-500/20 text-emerald-400' },
      { href: '/incidents', title: 'Incidents', desc: 'Create, acknowledge, resolve incidents. SLA tracking and playbooks.', icon: Siren, accent: 'from-orange-500/20 to-orange-600/5 border-orange-500/20 text-orange-400' },
      { href: '/monitoring/alert-rules', title: 'Alert Rules', desc: 'Configure thresholds that trigger infrastructure alerts. Live metric comparison.', icon: Zap, accent: 'from-amber-500/20 to-amber-600/5 border-amber-500/20 text-amber-400' },
    ],
  },
  {
    title: 'Infrastructure',
    items: [
      { href: '/admin/mm-control', title: 'MM Desk', desc: 'Market-making runtime, per-pair controls, inventory and execution visibility.', icon: SlidersHorizontal, accent: 'from-cyan-500/20 to-cyan-600/5 border-cyan-500/20 text-cyan-400' },
      { href: '/integrations', title: 'Integrations', desc: 'Third-party connectors, webhooks, credential rotation, failure budgets.', icon: Cable, accent: 'from-pink-500/20 to-pink-600/5 border-pink-500/20 text-pink-400' },
      { href: '/settings/infrastructure', title: 'Infrastructure', desc: 'Nodes, deployment targets, providers, and platform configuration.', icon: Server, accent: 'from-indigo-500/20 to-indigo-600/5 border-indigo-500/20 text-indigo-400' },
    ],
  },
];


/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function OperationsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [recoveryReason, setRecoveryReason] = useState('');
  const [configReason, setConfigReason] = useState('');
  const [rollbackReason, setRollbackReason] = useState('');
  const [rollbackSnapshotId, setRollbackSnapshotId] = useState('');
  const [simAction, setSimAction] = useState<'trading_halt' | 'provider_failover' | 'fee_update'>('trading_halt');
  const [simTargetProvider, setSimTargetProvider] = useState('');
  const [simMakerBps, setSimMakerBps] = useState('10');
  const [simTakerBps, setSimTakerBps] = useState('10');
  const [policyReason, setPolicyReason] = useState('');
  const [policyDraft, setPolicyDraft] = useState<ApprovalPolicyRow[]>([]);

  // System health
  const { data: healthData, isLoading: healthLoading } = useQuery({
    queryKey: ['admin', 'system-health', token],
    queryFn: () => adminFetch('/system-health', { token }),
    enabled: !!token,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  // Smart alerts
  const { data: alertsData } = useQuery({
    queryKey: ['admin', 'operations-smart-alerts', token],
    queryFn: () => adminFetch<{ alerts: SmartAlert[]; summary: { amlOpen: number; pendingWithdrawals: number; circuitOpen: boolean } }>('/operations/smart-alerts', { token }),
    enabled: !!token,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // System reliability
  const { data: reliabilityData } = useQuery({
    queryKey: ['admin', 'operations-reliability', token],
    queryFn: () => adminFetch<{
      sloStatus: string;
      settlementPending: number;
      settlementProcessed1h: number;
      settlementSuccessRate: number;
      circuitOpen: boolean;
      tradingHalted: boolean;
      orderLatencyP99: number | null;
    }>('/operations/system-reliability', { token }),
    enabled: !!token,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // Operational incidents (counters)
  const { data: incidentsData } = useQuery({
    queryKey: ['admin', 'operations-incidents', token],
    queryFn: () => adminFetch<{ incidents: OpsIncident[]; counters: Record<string, number> }>('/operations/incidents', { token }),
    enabled: !!token,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // Unified action center queue
  const { data: actionCenterData } = useQuery({
    queryKey: ['admin', 'operations-action-center', token],
    queryFn: () =>
      adminFetch<{
        items: ActionCenterItem[];
      }>('/operations/action-center', { token }),
    enabled: !!token,
    refetchInterval: 20_000,
    staleTime: 10_000,
  });

  // Proof of reserves
  const { data: porData } = useQuery({
    queryKey: ['admin', 'operations-por', token],
    queryFn: () => adminFetch<{ totalLiabilities: number; totalHotReserves: number; reserveRatio: number }>('/operations/proof-of-reserves', { token }),
    enabled: !!token,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // Playbooks
  const { data: playbooksData } = useQuery({
    queryKey: ['admin', 'operations-playbooks', token],
    queryFn: () => adminFetch<{ playbooks: Playbooks }>('/operations/playbooks', { token }),
    enabled: !!token,
    staleTime: 120_000,
  });

  const { data: jobsHealthData } = useQuery({
    queryKey: ['admin', 'operations-jobs-health', token],
    queryFn: () => adminFetch<{ generated_at: string; jobs: JobHealthRow[] }>('/operations/jobs/health', { token }),
    enabled: !!token,
    refetchInterval: 20_000,
    staleTime: 10_000,
  });

  const { data: opsIntelData } = useQuery({
    queryKey: ['admin', 'operations-intelligence', token],
    queryFn: () => adminFetch<OpsIntelligenceData>('/operations/intelligence', { token }),
    enabled: !!token,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const { data: snapshotsData } = useQuery({
    queryKey: ['admin', 'operations-config-snapshots', token],
    queryFn: () => adminFetch<ConfigSnapshotRow[]>('/operations/config/snapshots?limit=20', { token }),
    enabled: !!token,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: providersData } = useQuery({
    queryKey: ['admin', 'external-liquidity-providers-sim', token],
    queryFn: () => adminFetch<Array<{ id: string; provider_name: string; priority: number }>>('/external-liquidity/providers', { token }),
    enabled: !!token,
    staleTime: 20_000,
  });

  const { data: approvalPoliciesData } = useQuery({
    queryKey: ['admin', 'operations-approval-policies', token],
    queryFn: () => adminFetch<ApprovalPolicyRow[]>('/operations/approvals/policies', { token }),
    enabled: !!token,
    staleTime: 10_000,
  });

  const { data: approvalPolicyHistoryData } = useQuery({
    queryKey: ['admin', 'operations-approval-policies-history', token],
    queryFn: () => adminFetch<ApprovalPolicyHistoryRow[]>('/operations/approvals/policies/history?limit=10', { token }),
    enabled: !!token,
    staleTime: 10_000,
  });

  useEffect(() => {
    const rows = approvalPoliciesData?.data ?? [];
    setPolicyDraft(rows);
  }, [approvalPoliciesData?.data]);

  const recoverJobMutation = useMutation({
    mutationFn: async (input: { job_id: string; action: string }) => {
      const reason = recoveryReason.trim();
      if (reason.length < 8) throw new Error('Recovery reason must be at least 8 characters.');
      return adminFetch('/operations/jobs/recovery', {
        method: 'POST',
        token,
        body: {
          ...input,
          reason,
          limit: 200,
        },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'operations-jobs-health'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'operations-action-center'] });
    },
  });

  const createSnapshotMutation = useMutation({
    mutationFn: async () => {
      const reason = configReason.trim();
      if (reason.length < 8) throw new Error('Snapshot reason must be at least 8 characters.');
      return adminFetch('/operations/config/snapshot', {
        method: 'POST',
        token,
        body: { scope: 'global', reason },
      });
    },
    onSuccess: () => {
      setConfigReason('');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'operations-config-snapshots'] });
    },
  });

  const rollbackSnapshotMutation = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const reason = rollbackReason.trim();
      if (!rollbackSnapshotId) throw new Error('Select snapshot to rollback.');
      if (reason.length < 8) throw new Error('Rollback reason must be at least 8 characters.');
      return adminFetch(`/operations/config/snapshots/${encodeURIComponent(rollbackSnapshotId)}/rollback`, {
        method: 'POST',
        token,
        body: { reason, dry_run: dryRun },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'operations-config-snapshots'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'operations-action-center'] });
    },
  });

  const simulateMutation = useMutation({
    mutationFn: async () => {
      if (simAction === 'provider_failover' && !simTargetProvider) {
        throw new Error('Select provider for failover simulation.');
      }
      return adminFetch('/operations/simulate', {
        method: 'POST',
        token,
        body:
          simAction === 'provider_failover'
            ? { action: 'provider_failover', params: { to_provider_id: simTargetProvider } }
            : simAction === 'fee_update'
              ? { action: 'fee_update', params: { maker_bps: Number(simMakerBps) || 0, taker_bps: Number(simTakerBps) || 0 } }
              : { action: 'trading_halt' },
      });
    },
  });

  const saveApprovalPoliciesMutation = useMutation({
    mutationFn: async () => {
      const reason = policyReason.trim();
      if (reason.length < 8) throw new Error('Policy update reason must be at least 8 characters.');
      return adminFetch('/operations/approvals/policies', {
        method: 'POST',
        token,
        body: { reason, policies: policyDraft },
      });
    },
    onSuccess: () => {
      setPolicyReason('');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'operations-approval-policies'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'approval-requests'] });
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const health = healthData?.success ? (healthData.data as Record<string, any> | undefined) : undefined;
  const dbUp = health?.database?.status === 'up';
  const redisUp = health?.redis?.status === 'up';
  const nodeUp = health?.node?.status === 'up';
  const systemOk = health && dbUp && redisUp && nodeUp;
  const apiLatencyMs = health?.api_latency_ms;
  const wsConnections = health?.websocket?.connections;
  const memoryMb = health?.node?.memory_heap_mb;

  const alerts = alertsData?.data?.alerts ?? [];
  const alertSummary = alertsData?.data?.summary;
  const reliability = reliabilityData?.data;
  const opsIncidents = incidentsData?.data?.incidents ?? [];
  const actionCenterItems = actionCenterData?.data?.items ?? [];
  const activeOpsIncidents = opsIncidents.filter((i) => i.count > 0);
  const por = porData?.data;
  const playbooks = playbooksData?.data?.playbooks ?? {};
  const jobs = jobsHealthData?.data?.jobs ?? [];
  const opsIntel = opsIntelData?.data;
  const snapshots = snapshotsData?.data ?? [];
  const providers = providersData?.data ?? [];
  const approvalPolicies = policyDraft;
  const approvalPolicyHistory = approvalPolicyHistoryData?.data ?? [];
  const simulationResult = simulateMutation.data?.data as Record<string, unknown> | undefined;

  const pageStatus = (reliability?.circuitOpen || reliability?.tradingHalted || alerts.some((a) => a.severity === 'critical'))
    ? 'risk' as const
    : alerts.length > 0 || activeOpsIncidents.length > 0
      ? 'warning' as const
      : 'active' as const;

  return (
    <AdminPageFrame
      title="Operations Hub"
      description="Unified operational command center. Live telemetry, alerts, reliability metrics, and quick-access tools."
      status={pageStatus}
    >
      {/* ── Health strip ── */}
      <HealthStrip
        loading={healthLoading}
        systemOk={systemOk ?? false}
        dbUp={dbUp}
        redisUp={redisUp}
        apiLatencyMs={apiLatencyMs}
        wsConnections={wsConnections}
        memoryMb={memoryMb}
        circuitOpen={reliability?.circuitOpen}
        tradingHalted={reliability?.tradingHalted}
      />

      {/* ── Smart alerts banner ── */}
      {alerts.length > 0 && <AlertsBanner alerts={alerts} />}

      {/* ── KPI row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiTile label="System" value={systemOk ? 'Healthy' : health ? 'Degraded' : '—'}
          icon={<ShieldCheck className="h-3.5 w-3.5" />}
          color={systemOk ? 'text-emerald-400' : health ? 'text-amber-400' : 'text-admin-muted'} />
        <KpiTile label="API Latency" value={apiLatencyMs != null ? `${apiLatencyMs}ms` : '—'}
          icon={<Clock className="h-3.5 w-3.5" />}
          color={apiLatencyMs != null && apiLatencyMs < 300 ? 'text-emerald-400' : apiLatencyMs != null && apiLatencyMs < 800 ? 'text-amber-400' : 'text-admin-muted'} />
        <KpiTile label="Settlement" value={reliability ? `${reliability.settlementSuccessRate.toFixed(1)}%` : '—'}
          icon={<BarChart3 className="h-3.5 w-3.5" />}
          color={reliability && reliability.settlementSuccessRate >= 99 ? 'text-emerald-400' : reliability && reliability.settlementSuccessRate >= 90 ? 'text-amber-400' : 'text-admin-muted'} />
        <KpiTile label="Pending Settlement" value={reliability?.settlementPending?.toString() ?? '—'}
          icon={<RefreshCw className="h-3.5 w-3.5" />}
          color={reliability && reliability.settlementPending === 0 ? 'text-emerald-400' : reliability && reliability.settlementPending < 10 ? 'text-amber-400' : 'text-red-400'} />
        <KpiTile label="Reserve Ratio" value={por ? `${(por.reserveRatio * 100).toFixed(1)}%` : '—'}
          icon={<Wallet className="h-3.5 w-3.5" />}
          color={por && por.reserveRatio >= 1 ? 'text-emerald-400' : por && por.reserveRatio >= 0.9 ? 'text-amber-400' : 'text-red-400'} />
        <KpiTile label="Active Alerts" value={String(alerts.length)}
          icon={<Zap className="h-3.5 w-3.5" />}
          color={alerts.length === 0 ? 'text-emerald-400' : 'text-red-400'} pulse={alerts.length > 0} />
      </div>

      {/* ── Reliability + Incidents side by side ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ReliabilityPanel reliability={reliability} />
        <OpsIncidentsPanel incidents={opsIncidents} />
      </div>

      {/* ── Unified Action Center ── */}
      <ActionCenterPanel items={actionCenterItems} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <JobHealthPanel
          jobs={jobs}
          onRecover={(jobId, action) => recoverJobMutation.mutate({ job_id: jobId, action })}
          recovering={recoverJobMutation.isPending}
          recoveryReason={recoveryReason}
          setRecoveryReason={setRecoveryReason}
          recoveryError={recoverJobMutation.isError ? formatAdminError(recoverJobMutation.error, 'Recovery failed') : null}
        />
        <OpsIntelligencePanel data={opsIntel} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ConfigControlPanel
          snapshots={snapshots}
          configReason={configReason}
          setConfigReason={setConfigReason}
          rollbackReason={rollbackReason}
          setRollbackReason={setRollbackReason}
          rollbackSnapshotId={rollbackSnapshotId}
          setRollbackSnapshotId={setRollbackSnapshotId}
          createSnapshotMutation={createSnapshotMutation}
          rollbackSnapshotMutation={rollbackSnapshotMutation}
        />
        <SimulationPanel
          simAction={simAction}
          setSimAction={setSimAction}
          simTargetProvider={simTargetProvider}
          setSimTargetProvider={setSimTargetProvider}
          simMakerBps={simMakerBps}
          setSimMakerBps={setSimMakerBps}
          simTakerBps={simTakerBps}
          setSimTakerBps={setSimTakerBps}
          providers={providers}
          simulateMutation={simulateMutation}
          simulationResult={simulationResult}
        />
      </div>

      <ApprovalPolicyPanel
        policies={approvalPolicies}
        history={approvalPolicyHistory}
        setPolicies={setPolicyDraft}
        reason={policyReason}
        setReason={setPolicyReason}
        saveMutation={saveApprovalPoliciesMutation}
      />

      {/* ── Hub navigation grid ── */}
      {HUB_SECTIONS.map((section) => (
        <div key={section.title} className="space-y-3">
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">{section.title}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {section.items.map(({ href, title, desc, icon: Icon, accent }) => (
              <Link key={href} href={href} className="group block">
                <div className={cn(
                  'relative flex h-full flex-col gap-3 rounded-xl border bg-gradient-to-br p-4 transition-all duration-200',
                  'hover:shadow-lg hover:shadow-black/20 hover:-translate-y-0.5',
                  accent
                )}>
                  <div className="flex items-center justify-between">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.06]">
                      <Icon className="h-4.5 w-4.5" />
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-admin-muted opacity-0 transition-all group-hover:opacity-100 group-hover:translate-x-0.5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-admin-text group-hover:text-white transition-colors">{title}</h3>
                    <p className="mt-1 text-[11px] leading-relaxed text-admin-muted">{desc}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}

      {/* ── Runbook playbooks ── */}
      <PlaybooksPanel playbooks={playbooks} />

      {/* ── Proof of reserves summary ── */}
      {por && <ReservesBar por={por} />}

      {/* ── Footer tips ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TipCard title="Operational Cadence" items={[
          'Confirm monitoring green after every production deploy.',
          'Review incidents weekly — even resolved ones — for missing runbook steps.',
          'Rotate integration credentials on the same schedule as API wallets.',
          'Reconcile infrastructure capacity ahead of major market listings.',
        ]} ordered />
        <TipCard title="When to Escalate" items={[
          'User balances diverge from chain state or internal ledger projections.',
          'Matching latency crosses your internal SLO for more than two poll intervals.',
          'Any automated circuit triggers without a human acknowledgement record.',
          'Third-party custody or banking integrations return repeated 5xx responses.',
          'Regulatory inbox receives repeated fraud or sanctions hits within a single hour.',
        ]} />
      </div>
    </AdminPageFrame>
  );
}

/* ------------------------------------------------------------------ */
/*  Health Strip                                                       */
/* ------------------------------------------------------------------ */

function HealthStrip({ loading, systemOk, dbUp, redisUp, apiLatencyMs, wsConnections, memoryMb, circuitOpen, tradingHalted }: {
  loading: boolean;
  systemOk: boolean;
  dbUp?: boolean;
  redisUp?: boolean;
  apiLatencyMs?: number;
  wsConnections?: number;
  memoryMb?: number;
  circuitOpen?: boolean;
  tradingHalted?: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-admin-border bg-admin-card px-4 py-3 animate-pulse">
        <div className="h-2 w-2 rounded-full bg-admin-border" />
        <span className="text-[10px] text-admin-muted">Loading health data...</span>
      </div>
    );
  }

  const items: { label: string; ok: boolean; value?: string; icon: typeof Database }[] = [
    { label: 'Database', ok: !!dbUp, icon: Database },
    { label: 'Redis', ok: !!redisUp, icon: HardDrive },
    { label: 'API', ok: apiLatencyMs != null && apiLatencyMs < 500, value: apiLatencyMs != null ? `${apiLatencyMs}ms` : undefined, icon: Wifi },
    { label: 'WebSocket', ok: true, value: wsConnections != null ? String(wsConnections) : undefined, icon: Radio },
    { label: 'Memory', ok: memoryMb != null && memoryMb < 512, value: memoryMb != null ? `${memoryMb}MB` : undefined, icon: Cpu },
  ];

  const flags: { label: string; active: boolean }[] = [];
  if (circuitOpen) flags.push({ label: 'Circuit Open', active: true });
  if (tradingHalted) flags.push({ label: 'Trading Halted', active: true });

  return (
    <div className={cn(
      'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3',
      systemOk && !circuitOpen && !tradingHalted
        ? 'border-emerald-500/20 bg-emerald-500/[0.03]'
        : 'border-red-500/20 bg-red-500/[0.03]'
    )}>
      <div className={cn(
        'flex items-center gap-2',
        systemOk && !circuitOpen && !tradingHalted ? 'text-emerald-400' : 'text-red-400'
      )}>
        <div className={cn('h-2 w-2 rounded-full', systemOk && !circuitOpen && !tradingHalted ? 'bg-emerald-400' : 'bg-red-400 animate-pulse')} />
        <span className="text-[10px] font-semibold uppercase tracking-wider">
          {systemOk && !circuitOpen && !tradingHalted ? 'All Systems Operational' : 'Issues Detected'}
        </span>
      </div>

      <div className="h-4 w-px bg-admin-border hidden sm:block" />

      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5">
          <item.icon className={cn('h-3 w-3', item.ok ? 'text-admin-muted' : 'text-red-400')} />
          <span className="text-[10px] text-admin-muted">{item.label}</span>
          {item.value && (
            <span className={cn('text-[10px] font-bold tabular-nums', item.ok ? 'text-admin-text' : 'text-red-400')}>{item.value}</span>
          )}
          <div className={cn('h-1.5 w-1.5 rounded-full', item.ok ? 'bg-emerald-400' : 'bg-red-400')} />
        </div>
      ))}

      {flags.map((f) => (
        <span key={f.label} className="flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-400 animate-pulse">
          <Flame className="h-2.5 w-2.5" />
          {f.label}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Alerts Banner                                                      */
/* ------------------------------------------------------------------ */

function AlertsBanner({ alerts }: { alerts: SmartAlert[] }) {
  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...alerts].sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4 space-y-2">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-400" />
        <span className="text-xs font-semibold text-amber-400">{alerts.length} Active Alert{alerts.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="space-y-1.5">
        {sorted.map((a, i) => {
          const sevColor = a.severity === 'critical' ? 'text-red-400 bg-red-500/10 border-red-500/30'
            : a.severity === 'high' ? 'text-orange-400 bg-orange-500/10 border-orange-500/30'
              : 'text-amber-400 bg-amber-500/10 border-amber-500/30';
          return (
            <div key={i} className="flex items-center gap-3 text-xs">
              <span className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider', sevColor)}>
                {a.severity}
              </span>
              <span className="text-admin-text">{a.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  KPI Tile                                                           */
/* ------------------------------------------------------------------ */

function KpiTile({ label, value, icon, color, pulse }: {
  label: string; value: string; icon: React.ReactNode; color: string; pulse?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-admin-border bg-admin-card p-3">
      <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04] shrink-0', color)}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className={cn('text-lg font-bold tabular-nums text-admin-text truncate', pulse && 'animate-pulse')}>{value}</p>
        <p className="text-[9px] font-medium uppercase tracking-wider text-admin-muted">{label}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Reliability Panel                                                  */
/* ------------------------------------------------------------------ */

function ReliabilityPanel({ reliability }: {
  reliability?: {
    sloStatus: string;
    settlementPending: number;
    settlementProcessed1h: number;
    settlementSuccessRate: number;
    circuitOpen: boolean;
    tradingHalted: boolean;
    orderLatencyP99: number | null;
  } | null;
}) {
  const items = [
    {
      label: 'SLO Status',
      value: reliability?.sloStatus ?? '—',
      ok: reliability?.sloStatus === 'ok' || reliability?.sloStatus === 'healthy',
    },
    {
      label: 'Settlement Rate',
      value: reliability ? `${reliability.settlementSuccessRate.toFixed(1)}%` : '—',
      ok: reliability ? reliability.settlementSuccessRate >= 99 : true,
    },
    {
      label: 'Processed (1h)',
      value: reliability?.settlementProcessed1h?.toString() ?? '—',
      ok: true,
    },
    {
      label: 'Pending',
      value: reliability?.settlementPending?.toString() ?? '—',
      ok: reliability ? reliability.settlementPending < 10 : true,
    },
    {
      label: 'Order P99',
      value: reliability?.orderLatencyP99 != null ? `${reliability.orderLatencyP99}ms` : '—',
      ok: reliability?.orderLatencyP99 != null ? reliability.orderLatencyP99 < 500 : true,
    },
    {
      label: 'Circuit Breaker',
      value: reliability?.circuitOpen ? 'OPEN' : 'Closed',
      ok: !reliability?.circuitOpen,
    },
  ];

  return (
    <div className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-admin-border px-4 py-3">
        <TrendingUp className="h-4 w-4 text-blue-400" />
        <span className="text-xs font-semibold text-admin-text">System Reliability</span>
        <Link href="/monitoring" className="ml-auto text-[10px] text-admin-primary hover:underline flex items-center gap-1">
          Monitoring <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-admin-border/30">
        {items.map((item) => (
          <div key={item.label} className="bg-admin-card px-3 py-3">
            <p className="text-[10px] text-admin-muted uppercase tracking-wider">{item.label}</p>
            <div className="flex items-center gap-1.5 mt-1">
              <div className={cn('h-1.5 w-1.5 rounded-full', item.ok ? 'bg-emerald-400' : 'bg-red-400 animate-pulse')} />
              <p className={cn('text-sm font-bold tabular-nums', item.ok ? 'text-admin-text' : 'text-red-400')}>{item.value}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Ops Incidents Panel                                                */
/* ------------------------------------------------------------------ */

function OpsIncidentsPanel({ incidents }: { incidents: OpsIncident[] }) {
  const active = incidents.filter((i) => i.count > 0);

  return (
    <div className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-admin-border px-4 py-3">
        <Siren className="h-4 w-4 text-orange-400" />
        <span className="text-xs font-semibold text-admin-text">Operational Counters</span>
        {active.length > 0 && (
          <span className="ml-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-400 tabular-nums animate-pulse">
            {active.length} active
          </span>
        )}
        <Link href="/incidents" className="ml-auto text-[10px] text-admin-primary hover:underline flex items-center gap-1">
          Incidents <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
      {incidents.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-admin-muted">No operational counters available.</div>
      ) : (
        <div className="divide-y divide-admin-border/50">
          {incidents.map((inc) => {
            const sevColor = inc.severity === 'critical'
              ? 'bg-red-500/10 text-red-400 border-red-500/30'
              : inc.severity === 'high'
                ? 'bg-orange-500/10 text-orange-400 border-orange-500/30'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/30';
            const isActive = inc.count > 0;
            return (
              <div key={inc.type} className={cn('flex items-center gap-3 px-4 py-2.5', isActive && 'bg-red-500/[0.02]')}>
                <div className={cn('h-1.5 w-1.5 rounded-full shrink-0', isActive ? 'bg-red-400 animate-pulse' : 'bg-emerald-400')} />
                <span className="text-xs text-admin-text flex-1">{inc.type.replace(/_/g, ' ')}</span>
                <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider', sevColor)}>
                  {inc.severity}
                </span>
                <span className={cn('text-sm font-bold tabular-nums', isActive ? 'text-red-400' : 'text-admin-muted')}>
                  {inc.count}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Unified Action Center                                              */
/* ------------------------------------------------------------------ */

function ActionCenterPanel({ items }: { items: ActionCenterItem[] }) {
  return (
    <div className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-admin-border px-4 py-3">
        <ListOrdered className="h-4 w-4 text-indigo-400" />
        <span className="text-xs font-semibold text-admin-text">Unified Action Center</span>
        <span className="text-[10px] text-admin-muted ml-1">Critical queue sorted by severity</span>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-admin-muted">
          No urgent actions. Critical operational queue is clear.
        </div>
      ) : (
        <div className="divide-y divide-admin-border/50">
          {items.map((item) => {
            const sevTone = item.severity === 'critical'
              ? 'border-red-500/35 bg-red-500/[0.05] text-red-400'
              : item.severity === 'high'
                ? 'border-orange-500/35 bg-orange-500/[0.05] text-orange-400'
                : 'border-amber-500/35 bg-amber-500/[0.05] text-amber-400';
            return (
              <div key={item.key} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
                <div className="flex items-start gap-2 flex-1">
                  <AlertTriangle className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', item.severity === 'critical' ? 'text-red-400' : item.severity === 'high' ? 'text-orange-400' : 'text-amber-400')} />
                  <div className="space-y-0.5">
                    <p className="text-xs font-semibold text-admin-text">{item.title}</p>
                    <p className="text-[11px] text-admin-muted leading-relaxed">{item.detail}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 sm:ml-3">
                  <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider', sevTone)}>
                    {item.severity}
                  </span>
                  {item.count != null ? (
                    <span className="text-[11px] font-bold tabular-nums text-admin-text">{item.count}</span>
                  ) : null}
                  <Link
                    href={item.action_path}
                    className="inline-flex items-center gap-1 rounded-md border border-admin-border px-2 py-1 text-[10px] text-admin-primary hover:bg-admin-muted/10"
                  >
                    Open
                    <ArrowRight className="h-2.5 w-2.5" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Jobs Health Panel                                                  */
/* ------------------------------------------------------------------ */

function JobHealthPanel({
  jobs,
  onRecover,
  recovering,
  recoveryReason,
  setRecoveryReason,
  recoveryError,
}: {
  jobs: JobHealthRow[];
  onRecover: (jobId: string, action: string) => void;
  recovering: boolean;
  recoveryReason: string;
  setRecoveryReason: (value: string) => void;
  recoveryError: string | null;
}) {
  const [pendingRecovery, setPendingRecovery] = useState<{ jobId: string; action: string } | null>(null);
  const tone = (status: JobHealthRow['status']) =>
    status === 'healthy' ? 'text-emerald-400' : status === 'lagging' ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-admin-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-cyan-400" />
          <span className="text-xs font-semibold text-admin-text">Queue / Cron Health</span>
        </div>
        <span className="text-[10px] text-admin-muted">{jobs.length} critical jobs</span>
      </div>
      <div className="border-b border-admin-border px-4 py-2.5">
        <label className="block text-[10px] font-semibold uppercase tracking-wide text-admin-muted">Recovery reason (mandatory)</label>
        <input
          value={recoveryReason}
          onChange={(e) => setRecoveryReason(e.target.value)}
          placeholder="Incident reference + why this recovery is safe"
          className="mt-1 w-full rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 text-xs text-admin-text"
        />
        {recoveryError ? <p className="mt-1 text-[11px] text-red-400">{recoveryError}</p> : null}
      </div>
      {jobs.length === 0 ? (
        <p className="px-4 py-4 text-[11px] text-admin-muted">No job telemetry yet.</p>
      ) : (
        <div className="divide-y divide-admin-border/50">
          {jobs.map((j) => (
            <div key={j.job_id} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-admin-text">{j.job_id.replace(/_/g, ' ')}</p>
                <span className={cn('text-[10px] font-semibold uppercase', tone(j.status))}>{j.status}</span>
              </div>
              <p className="mt-1 text-[11px] text-admin-muted">
                Queue {j.queue_depth} • Failures {j.fail_count} • Lag {j.lag_seconds ?? 0}s
              </p>
              {j.last_error ? <p className="mt-1 text-[11px] text-amber-400">{j.last_error}</p> : null}
              {j.recovery_actions.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {j.recovery_actions.slice(0, 2).map((action) => (
                    <button
                      key={action}
                      type="button"
                      disabled={recovering || action === 'investigate'}
                      onClick={() => setPendingRecovery({ jobId: j.job_id, action })}
                      className="rounded-md border border-admin-border px-2 py-1 text-[10px] text-admin-primary hover:bg-admin-muted/10 disabled:opacity-40"
                    >
                      {action}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
      <ActionAuthModal
        open={pendingRecovery !== null}
        onClose={() => setPendingRecovery(null)}
        onConfirm={(payload: ActionAuthPayload) => {
          if (!pendingRecovery) return;
          onRecover(pendingRecovery.jobId, pendingRecovery.action);
          void payload;
          setPendingRecovery(null);
        }}
        title="Confirm job recovery action"
        actionLabel={pendingRecovery ? `${pendingRecovery.action} on ${pendingRecovery.jobId}` : 'Recovery action'}
        description="Recovery operations can affect queues and workers."
        requireReason
        twofaRequired
        confirmationPhrase="CONFIRM JOB_RECOVERY"
        externalError={recoveryError}
        isPending={recovering}
        confirmLabel={recovering ? 'Executing…' : 'Execute recovery'}
        confirmVariant="danger"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Ops Intelligence Panel                                             */
/* ------------------------------------------------------------------ */

function OpsIntelligencePanel({ data }: { data?: OpsIntelligenceData }) {
  return (
    <div className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-admin-border px-4 py-3">
        <TrendingUp className="h-4 w-4 text-indigo-400" />
        <span className="text-xs font-semibold text-admin-text">Operational Intelligence</span>
      </div>
      {!data ? (
        <p className="px-4 py-4 text-[11px] text-admin-muted">Collecting operational trends...</p>
      ) : (
        <div className="space-y-3 px-4 py-3">
          <div className="grid grid-cols-3 gap-2">
            <KpiTile label="Avg Action Latency" value={`${Math.round(data.action_latency_ms.avg)}ms`} icon={<Clock className="h-3.5 w-3.5" />} color="text-indigo-300" />
            <KpiTile label="Incidents (7d)" value={String(data.incident_frequency)} icon={<Flame className="h-3.5 w-3.5" />} color="text-orange-300" />
            <KpiTile label="Failovers (7d)" value={String(data.provider_failovers)} icon={<RefreshCw className="h-3.5 w-3.5" />} color="text-cyan-300" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-admin-muted">Top failing admin actions</p>
            {data.failed_action_classes.length === 0 ? (
              <p className="mt-1 text-[11px] text-admin-muted">No failing action class in last 7 days.</p>
            ) : (
              <div className="mt-1 space-y-1">
                {data.failed_action_classes.map((f) => (
                  <div key={f.action} className="flex items-center justify-between rounded border border-admin-border/60 px-2 py-1 text-[11px]">
                    <span className="text-admin-muted">{f.action}</span>
                    <span className="font-semibold tabular-nums text-admin-text">{f.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Config + Simulation Panels                                         */
/* ------------------------------------------------------------------ */

function ConfigControlPanel({
  snapshots,
  configReason,
  setConfigReason,
  rollbackReason,
  setRollbackReason,
  rollbackSnapshotId,
  setRollbackSnapshotId,
  createSnapshotMutation,
  rollbackSnapshotMutation,
}: {
  snapshots: ConfigSnapshotRow[];
  configReason: string;
  setConfigReason: (value: string) => void;
  rollbackReason: string;
  setRollbackReason: (value: string) => void;
  rollbackSnapshotId: string;
  setRollbackSnapshotId: (value: string) => void;
  createSnapshotMutation: { isPending: boolean; isError: boolean; error: unknown; mutate: () => void };
  rollbackSnapshotMutation: { isPending: boolean; isError: boolean; error: unknown; mutate: (dryRun: boolean) => void };
}) {
  const [pendingConfigAction, setPendingConfigAction] = useState<'snapshot' | 'rollback_dry' | 'rollback_exec' | null>(null);
  const createErr = createSnapshotMutation.isError ? formatAdminError(createSnapshotMutation.error, 'Snapshot creation failed') : null;
  const rollbackErr = rollbackSnapshotMutation.isError ? formatAdminError(rollbackSnapshotMutation.error, 'Rollback failed') : null;
  return (
    <div className="rounded-xl border border-admin-border bg-admin-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-purple-400" />
        <span className="text-xs font-semibold text-admin-text">Config Snapshots & Rollback</span>
      </div>
      <div className="space-y-2">
        <label className="block text-[10px] font-semibold uppercase tracking-wide text-admin-muted">Create snapshot reason</label>
        <input
          value={configReason}
          onChange={(e) => setConfigReason(e.target.value)}
          placeholder="Why capturing this config state now"
          className="w-full rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 text-xs text-admin-text"
        />
        <button
          type="button"
          onClick={() => setPendingConfigAction('snapshot')}
          disabled={createSnapshotMutation.isPending}
          className="rounded-md border border-admin-border px-2 py-1 text-[11px] text-admin-primary hover:bg-admin-muted/10 disabled:opacity-40"
        >
          Create Snapshot
        </button>
        {createErr ? <p className="text-[11px] text-red-400">{createErr}</p> : null}
      </div>
      <div className="space-y-2">
        <label className="block text-[10px] font-semibold uppercase tracking-wide text-admin-muted">Rollback target snapshot</label>
        <select
          value={rollbackSnapshotId}
          onChange={(e) => setRollbackSnapshotId(e.target.value)}
          className="w-full rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 text-xs text-admin-text"
        >
          <option value="">Select snapshot</option>
          {snapshots.map((s) => (
            <option key={s.id} value={s.id}>
              {new Date(s.created_at).toLocaleString()} - {s.reason.slice(0, 40)}
            </option>
          ))}
        </select>
        <input
          value={rollbackReason}
          onChange={(e) => setRollbackReason(e.target.value)}
          placeholder="Why rollback is required"
          className="w-full rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 text-xs text-admin-text"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPendingConfigAction('rollback_dry')}
            disabled={rollbackSnapshotMutation.isPending}
            className="rounded-md border border-admin-border px-2 py-1 text-[11px] text-admin-primary hover:bg-admin-muted/10 disabled:opacity-40"
          >
            Dry Run
          </button>
          <button
            type="button"
            onClick={() => setPendingConfigAction('rollback_exec')}
            disabled={rollbackSnapshotMutation.isPending}
            className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-500/20 disabled:opacity-40"
          >
            Execute Rollback
          </button>
        </div>
        {rollbackErr ? <p className="text-[11px] text-red-400">{rollbackErr}</p> : null}
      </div>
      <ActionAuthModal
        open={pendingConfigAction !== null}
        onClose={() => setPendingConfigAction(null)}
        onConfirm={(payload: ActionAuthPayload) => {
          if (pendingConfigAction === 'snapshot') {
            createSnapshotMutation.mutate();
          } else if (pendingConfigAction === 'rollback_dry') {
            rollbackSnapshotMutation.mutate(true);
          } else if (pendingConfigAction === 'rollback_exec') {
            rollbackSnapshotMutation.mutate(false);
          }
          void payload;
          setPendingConfigAction(null);
        }}
        title="Confirm configuration control action"
        actionLabel={
          pendingConfigAction === 'snapshot'
            ? 'Create config snapshot'
            : pendingConfigAction === 'rollback_dry'
              ? 'Run rollback dry-run'
              : 'Execute config rollback'
        }
        description="Configuration controls impact live runtime behavior."
        requireReason
        twofaRequired
        confirmationPhrase={pendingConfigAction === 'rollback_exec' ? 'CONFIRM CONFIG_ROLLBACK' : 'CONFIRM CONFIG_ACTION'}
        externalError={createErr ?? rollbackErr}
        isPending={createSnapshotMutation.isPending || rollbackSnapshotMutation.isPending}
        confirmLabel={(createSnapshotMutation.isPending || rollbackSnapshotMutation.isPending) ? 'Executing…' : 'Confirm'}
        confirmVariant={pendingConfigAction === 'rollback_exec' ? 'danger' : 'primary'}
      />
    </div>
  );
}

function SimulationPanel({
  simAction,
  setSimAction,
  simTargetProvider,
  setSimTargetProvider,
  simMakerBps,
  setSimMakerBps,
  simTakerBps,
  setSimTakerBps,
  providers,
  simulateMutation,
  simulationResult,
}: {
  simAction: 'trading_halt' | 'provider_failover' | 'fee_update';
  setSimAction: (value: 'trading_halt' | 'provider_failover' | 'fee_update') => void;
  simTargetProvider: string;
  setSimTargetProvider: (value: string) => void;
  simMakerBps: string;
  setSimMakerBps: (value: string) => void;
  simTakerBps: string;
  setSimTakerBps: (value: string) => void;
  providers: Array<{ id: string; provider_name: string; priority: number }>;
  simulateMutation: { isPending: boolean; isError: boolean; error: unknown; mutate: () => void; data?: { data?: unknown } };
  simulationResult?: Record<string, unknown>;
}) {
  const [pendingSimulation, setPendingSimulation] = useState(false);
  const simErr = simulateMutation.isError ? formatAdminError(simulateMutation.error, 'Simulation failed') : null;
  return (
    <div className="rounded-xl border border-admin-border bg-admin-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 text-indigo-300" />
        <span className="text-xs font-semibold text-admin-text">Simulation Mode</span>
      </div>
      <select
        value={simAction}
        onChange={(e) => setSimAction(e.target.value as 'trading_halt' | 'provider_failover' | 'fee_update')}
        className="w-full rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 text-xs text-admin-text"
      >
        <option value="trading_halt">Trading halt impact</option>
        <option value="provider_failover">Provider failover impact</option>
        <option value="fee_update">Fee update impact</option>
      </select>
      {simAction === 'provider_failover' ? (
        <select
          value={simTargetProvider}
          onChange={(e) => setSimTargetProvider(e.target.value)}
          className="w-full rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 text-xs text-admin-text"
        >
          <option value="">Select provider</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.provider_name} - p{p.priority}
            </option>
          ))}
        </select>
      ) : null}
      {simAction === 'fee_update' ? (
        <div className="grid grid-cols-2 gap-2">
          <input
            value={simMakerBps}
            onChange={(e) => setSimMakerBps(e.target.value)}
            placeholder="maker bps"
            className="rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 text-xs text-admin-text"
          />
          <input
            value={simTakerBps}
            onChange={(e) => setSimTakerBps(e.target.value)}
            placeholder="taker bps"
            className="rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 text-xs text-admin-text"
          />
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setPendingSimulation(true)}
        disabled={simulateMutation.isPending}
        className="rounded-md border border-indigo-500/40 bg-indigo-500/10 px-2 py-1 text-[11px] text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-40"
      >
        Run Simulation
      </button>
      {simErr ? <p className="text-[11px] text-red-400">{simErr}</p> : null}
      {simulationResult ? (
        <pre className="max-h-52 overflow-auto rounded border border-admin-border bg-admin-surface p-2 text-[10px] text-admin-muted">
          {JSON.stringify(simulationResult, null, 2)}
        </pre>
      ) : null}
      <ActionAuthModal
        open={pendingSimulation}
        onClose={() => setPendingSimulation(false)}
        onConfirm={(payload: ActionAuthPayload) => {
          simulateMutation.mutate();
          void payload;
          setPendingSimulation(false);
        }}
        title="Confirm operational simulation"
        actionLabel={`Run ${simAction.replace(/_/g, ' ')} simulation`}
        description="Simulation actions are audited and require explicit authorization."
        requireReason
        twofaRequired
        confirmationPhrase="CONFIRM SIMULATION"
        externalError={simErr}
        isPending={simulateMutation.isPending}
        confirmLabel={simulateMutation.isPending ? 'Running…' : 'Run simulation'}
        confirmVariant="primary"
      />
    </div>
  );
}

function ApprovalPolicyPanel({
  policies,
  history,
  setPolicies,
  reason,
  setReason,
  saveMutation,
}: {
  policies: ApprovalPolicyRow[];
  history: ApprovalPolicyHistoryRow[];
  setPolicies: (rows: ApprovalPolicyRow[]) => void;
  reason: string;
  setReason: (value: string) => void;
  saveMutation: { isPending: boolean; isError: boolean; error: unknown; mutate: () => void };
}) {
  const saveErr = saveMutation.isError ? formatAdminError(saveMutation.error, 'Policy update failed') : null;

  return (
    <div className="rounded-xl border border-admin-border bg-admin-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-purple-300" />
        <span className="text-xs font-semibold text-admin-text">Approval Policies</span>
        <span className="text-[10px] text-admin-muted">maker-checker enforcement per high-risk action</span>
      </div>

      {policies.length === 0 ? (
        <p className="text-[11px] text-admin-muted">No policy rows available.</p>
      ) : (
        <div className="space-y-2">
          {policies.map((p) => (
            <div key={p.key} className="grid grid-cols-1 md:grid-cols-4 gap-2 rounded border border-admin-border/60 p-2">
              <div className="md:col-span-2">
                <p className="text-xs font-semibold text-admin-text">{p.label}</p>
                <p className="text-[10px] text-admin-muted">{p.key}</p>
              </div>
              <select
                value={p.mode}
                onChange={(e) =>
                  setPolicies(
                    policies.map((row) => (row.key === p.key ? { ...row, mode: e.target.value as ApprovalPolicyRow['mode'] } : row))
                  )
                }
                className="rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 text-xs text-admin-text"
              >
                <option value="always_dual">Always dual approval</option>
                <option value="single_allowed">Single approval allowed</option>
              </select>
              <input
                type="number"
                min={1}
                max={5}
                value={p.required_approvals}
                onChange={(e) => {
                  const n = Math.min(5, Math.max(1, parseInt(e.target.value || '2', 10) || 2));
                  setPolicies(policies.map((row) => (row.key === p.key ? { ...row, required_approvals: n } : row)));
                }}
                className="rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 text-xs text-admin-text"
              />
              <label className="flex items-center gap-2 text-[11px] text-admin-muted md:col-span-4">
                <input
                  type="checkbox"
                  checked={p.require_distinct_role}
                  onChange={(e) =>
                    setPolicies(
                      policies.map((row) =>
                        row.key === p.key ? { ...row, require_distinct_role: e.target.checked } : row
                      )
                    )
                  }
                />
                Require checker role distinct from maker role
              </label>
              <input
                value={(p.allowed_checker_roles ?? []).join(',')}
                onChange={(e) => {
                  const roles = e.target.value
                    .split(',')
                    .map((r) => r.trim().toLowerCase().replace(/\s+/g, '_'))
                    .filter((r) => r.length > 0);
                  setPolicies(
                    policies.map((row) =>
                      row.key === p.key ? { ...row, allowed_checker_roles: roles } : row
                    )
                  );
                }}
                placeholder="Allowed checker roles (comma separated, optional)"
                className="rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 text-xs text-admin-text md:col-span-4"
              />
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Change reason (required for audit)"
          className="w-full rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 text-xs text-admin-text"
        />
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="rounded-md border border-purple-500/40 bg-purple-500/10 px-2 py-1 text-[11px] text-purple-300 hover:bg-purple-500/20 disabled:opacity-40"
        >
          Save Approval Policies
        </button>
        {saveErr ? <p className="text-[11px] text-red-400">{saveErr}</p> : null}
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-admin-muted">Recent policy changes</p>
        {history.length === 0 ? (
          <p className="text-[11px] text-admin-muted">No policy update history found.</p>
        ) : (
          <div className="space-y-1 max-h-44 overflow-auto">
            {history.map((h) => {
              const details = (h.details ?? {}) as { reason?: string };
              return (
                <div key={h.id} className="rounded border border-admin-border/60 px-2 py-1.5 text-[11px]">
                  <p className="text-admin-text">{new Date(h.created_at).toLocaleString()}</p>
                  <p className="text-admin-muted">actor: {h.actor_id ?? 'unknown'}</p>
                  <p className="text-admin-muted">reason: {details.reason ?? 'n/a'}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Playbooks Panel                                                    */
/* ------------------------------------------------------------------ */

function PlaybooksPanel({ playbooks }: { playbooks: Playbooks }) {
  const entries = Object.entries(playbooks);
  if (entries.length === 0) return null;

  return (
    <div className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-admin-border px-4 py-3">
        <BookOpen className="h-4 w-4 text-purple-400" />
        <span className="text-xs font-semibold text-admin-text">Operational Playbooks</span>
        <span className="text-[10px] text-admin-muted ml-1">Quick-reference runbooks</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-admin-border/30">
        {entries.map(([key, steps]) => (
          <div key={key} className="bg-admin-card p-4">
            <h4 className="text-xs font-semibold text-admin-text capitalize mb-2">
              {key.replace(/_/g, ' ')}
            </h4>
            <div className="space-y-1">
              {steps.split('\n').map((line, i) => (
                <p key={i} className="text-[11px] text-admin-muted leading-relaxed">{line}</p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Reserves Bar                                                       */
/* ------------------------------------------------------------------ */

function ReservesBar({ por }: { por: { totalLiabilities: number; totalHotReserves: number; reserveRatio: number } }) {
  const pct = Math.min(100, por.reserveRatio * 100);
  const ok = por.reserveRatio >= 1;

  return (
    <div className="rounded-xl border border-admin-border bg-admin-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-emerald-400" />
          <span className="text-xs font-semibold text-admin-text">Proof of Reserves</span>
        </div>
        <div className="flex items-center gap-4 text-[10px] text-admin-muted">
          <span>Liabilities: <b className="text-admin-text">${por.totalLiabilities.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b></span>
          <span>Hot Reserves: <b className="text-admin-text">${por.totalHotReserves.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b></span>
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-admin-muted">Reserve ratio</span>
          <span className={cn('font-bold tabular-nums', ok ? 'text-emerald-400' : 'text-red-400')}>
            {pct.toFixed(1)}%
          </span>
        </div>
        <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-500', ok ? 'bg-emerald-500' : 'bg-red-500')}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        <div className="flex items-center gap-1 text-[10px]">
          {ok ? (
            <>
              <ShieldCheck className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-400 font-medium">Fully collateralized</span>
            </>
          ) : (
            <>
              <AlertTriangle className="h-3 w-3 text-red-400" />
              <span className="text-red-400 font-medium">Under-collateralized — review immediately</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tip Card                                                           */
/* ------------------------------------------------------------------ */

function TipCard({ title, items, ordered }: { title: string; items: string[]; ordered?: boolean }) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <div className="rounded-xl border border-admin-border bg-admin-card p-4 space-y-2">
      <p className="text-xs font-semibold text-admin-text">{title}</p>
      <Tag className={cn('space-y-1.5 pl-4 text-[11px] text-admin-muted leading-relaxed', ordered ? 'list-decimal' : 'list-disc')}>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </Tag>
    </div>
  );
}
