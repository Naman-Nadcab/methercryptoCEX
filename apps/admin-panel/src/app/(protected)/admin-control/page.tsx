'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore, hasAdminPermission } from '@/store/auth';
import {
  getControlStatus,
  postControlCircuit,
  getControlAssetFreeze,
  patchControlAssetFreeze,
  postControlLiquidityKill,
  postControlEmergencyMode,
  getControlIncidents,
  resolveControlIncident,
  createControlIncident,
  postControlCommand,
  getControlCommandHistory,
  getControlEvents,
  getControlHealthScore,
  getControlHealth,
  getControlAssetFreezeHistory,
  getControlCircuitHistory,
  getControlTimeline,
  getControlEmergencyLevel,
  postControlEmergencyLevel,
  getControlSafetyTriggers,
  patchControlSafetyTriggers,
  type AssetFreezeRow,
  type ControlIncidentRow,
  type ControlEventRow,
  type WorkerHealthRow,
  type AssetFreezeHistoryRow,
  type CircuitHistoryRow,
  type TimelineItem,
  type TimelineEventPayload,
  type SafetyTriggerRow,
  postControlGlobalAction,
  type GlobalActionType,
} from '@/lib/control-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TableSkeleton } from '@/components/ui';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { exportStandardCsv, exportStandardJson, type StandardExportRow } from '@/lib/export-utils';
import { useAdminControlEventsWs } from '@/hooks/useAdminControlEventsWs';
import {
  Activity,
  Zap,
  Shield,
  AlertTriangle,
  Pause,
  Play,
  Snowflake,
  Power,
  PowerOff,
  ListChecks,
  Terminal,
  Clock,
  CheckCircle,
  Gauge,
  Server,
  History,
  Layers,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Settings,
  Flame,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';

const CIRCUIT_ACTIONS = [
  { action: 'open_trading_circuit', label: 'Open trading circuit', icon: Pause },
  { action: 'close_trading_circuit', label: 'Close trading circuit', icon: Play },
  { action: 'pause_matching_engine', label: 'Pause matching engine', icon: Snowflake },
  { action: 'resume_matching_engine', label: 'Resume matching engine', icon: Play },
];

const SYSTEM_COMMANDS = [
  { command: 'restart_matching_engine', label: 'Restart matching engine' },
  { command: 'restart_settlement_worker', label: 'Restart settlement worker' },
  { command: 'restart_websocket_service', label: 'Restart WebSocket server' },
];

const EMERGENCY_LEVELS: { level: number; label: string; description: string }[] = [
  { level: 0, label: 'Normal', description: 'Exchange operating normally.' },
  { level: 1, label: 'Trading Halt', description: 'Spot trading paused but deposits and withdrawals still active.' },
  { level: 2, label: 'Financial Lockdown', description: 'Trading paused and withdrawals disabled.' },
  { level: 3, label: 'Full Emergency', description: 'Trading paused, withdrawals disabled, deposits disabled, safe mode enabled.' },
];

const SAFETY_TRIGGER_ACTION_OPTIONS = [
  { value: 'pause_trading', label: 'Pause trading' },
  { value: 'disable_withdrawals', label: 'Disable withdrawals' },
  { value: 'switch_rpc_provider', label: 'Switch RPC provider' },
  { value: 'send_admin_alert', label: 'Send admin alert' },
  { value: 'enable_risk_alerts', label: 'Enable risk alerts' },
];

function MetricScore({ label, value }: { label: string; value: number }) {
  const isCritical = value < 50;
  const isWarning = value < 70 && !isCritical;
  const barColor = isCritical ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-emerald-500';
  const textColor = isCritical ? 'text-red-400 font-semibold' : isWarning ? 'text-amber-400 font-medium' : 'text-admin-text';
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-admin-muted">{label}</span>
        <span className={`text-xs tabular-nums ${textColor}`}>{value}/100</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  );
}

function ZoneHeader({ title, icon: Icon, variant = 'default' }: { title: string; icon: React.ComponentType<{ className?: string }>; variant?: 'default' | 'danger' }) {
  return (
    <div className={cn(
      'flex items-center gap-3 border-b pb-2 pt-6 first:pt-0',
      variant === 'danger' ? 'border-red-500/20' : 'border-admin-border/50',
    )}>
      <Icon className={cn('h-4 w-4', variant === 'danger' ? 'text-red-400' : 'text-admin-muted')} />
      <h2 className={cn('text-xs font-bold uppercase tracking-widest', variant === 'danger' ? 'text-red-400' : 'text-admin-muted')}>
        {title}
      </h2>
    </div>
  );
}

function FreezeToggle({ frozen, onToggle, disabled, label }: { frozen: boolean; onToggle: () => void; disabled: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={frozen}
      aria-label={label}
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50',
        frozen ? 'bg-red-500/40 focus:ring-red-500' : 'bg-emerald-500/30 focus:ring-emerald-500',
      )}
    >
      <span className={cn(
        'pointer-events-none inline-block h-5 w-5 rounded-full shadow ring-0 transition-transform',
        frozen ? 'translate-x-5 bg-red-400' : 'translate-x-0 bg-emerald-400',
      )} />
    </button>
  );
}

function HealthGauge({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (pct / 100) * circumference;
  const color = pct >= 70 ? '#10B981' : pct >= 50 ? '#F59E0B' : '#EF4444';
  return (
    <div className="relative h-36 w-36">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" className="text-white/[0.06]" strokeWidth="8" />
        <circle cx="60" cy="60" r="54" fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" className="transition-all duration-700" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tabular-nums text-admin-text">{score}</span>
        <span className="text-[10px] text-admin-muted">/ 100</span>
      </div>
    </div>
  );
}

const EVENT_SERVICE_OPTIONS = [
  { value: '', label: 'All services' },
  { value: 'matching_engine', label: 'matching_engine' },
  { value: 'settlement_worker', label: 'settlement_worker' },
  { value: 'websocket', label: 'websocket' },
  { value: 'risk_engine', label: 'risk_engine' },
  { value: 'system', label: 'system' },
];

const EVENT_SEVERITY_OPTIONS = [
  { value: '', label: 'All severities' },
  { value: 'info', label: 'info' },
  { value: 'warning', label: 'warning' },
  { value: 'critical', label: 'critical' },
];

const FREEZE_HISTORY_ASSET_OPTIONS = [
  { value: '', label: 'All assets' },
  { value: 'BTC', label: 'BTC' },
  { value: 'ETH', label: 'ETH' },
  { value: 'USDT', label: 'USDT' },
  { value: 'USDC', label: 'USDC' },
  { value: 'SOL', label: 'SOL' },
];

const FREEZE_HISTORY_ACTION_OPTIONS = [
  { value: '', label: 'All actions' },
  { value: 'deposit_frozen', label: 'Deposits Frozen' },
  { value: 'withdrawal_frozen', label: 'Withdrawals Frozen' },
  { value: 'trading_frozen', label: 'Trading Frozen' },
  { value: 'unfreeze', label: 'Unfreeze' },
];

const FREEZE_ACTION_MATCH: Record<string, string[]> = {
  deposit_frozen: ['Deposits Frozen'],
  withdrawal_frozen: ['Withdrawals Frozen'],
  trading_frozen: ['Trading Frozen'],
  unfreeze: ['Deposits Unfrozen', 'Withdrawals Unfrozen', 'Trading Unfrozen'],
};

const CIRCUIT_EVENT_TYPE_OPTIONS = [
  { value: '', label: 'All event types' },
  { value: 'circuit_open', label: 'Circuit open' },
  { value: 'circuit_close', label: 'Circuit close' },
  { value: 'matching_pause', label: 'Matching pause' },
  { value: 'matching_resume', label: 'Matching resume' },
  { value: 'emergency_mode', label: 'Emergency mode' },
];

const CIRCUIT_SERVICE_OPTIONS = [
  { value: '', label: 'All services' },
  { value: 'matching_engine', label: 'matching_engine' },
  { value: 'exchange', label: 'exchange' },
];

function circuitEventToType(event: string): string {
  const e = event.toLowerCase();
  if (e.includes('trading circuit opened') || (e.includes('circuit') && e.includes('open'))) return 'circuit_open';
  if (e.includes('trading circuit closed') || (e.includes('circuit') && e.includes('close'))) return 'circuit_close';
  if (e.includes('matching engine paused') || (e.includes('matching') && e.includes('pause'))) return 'matching_pause';
  if (e.includes('matching engine resumed') || (e.includes('matching') && e.includes('resume'))) return 'matching_resume';
  if (e.includes('emergency mode')) return 'emergency_mode';
  return '';
}

function circuitRowToServiceCategory(event: string, service: string | null): string {
  const e = event.toLowerCase();
  if (e.includes('matching engine')) return 'matching_engine';
  if (e.includes('trading circuit') || e.includes('emergency mode') || service === 'circuit' || service === 'emergency') return 'exchange';
  return '';
}

export default function AdminControlPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const admin = useAdminAuthStore((s) => s.admin);
  const queryClient = useQueryClient();
  const canExecuteCommands = hasAdminPermission(admin, 'control:commands');

  type TimelinePrependItem = TimelineItem & { id: string; isNew?: boolean };
  const [timelinePrepend, setTimelinePrepend] = useState<TimelinePrependItem[]>([]);
  const [timelineMore, setTimelineMore] = useState<TimelineItem[]>([]);
  const [timelineHasMore, setTimelineHasMore] = useState(false);
  const [timelineLoadingMore, setTimelineLoadingMore] = useState(false);

  const handleTimelineEvent = useCallback((entry: TimelineEventPayload) => {
    const id = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const item: TimelinePrependItem = {
      event: entry.event,
      service: entry.service,
      severity: entry.severity,
      timestamp: entry.timestamp,
      triggered_by: entry.triggered_by,
      id,
      isNew: true,
    };
    setTimelinePrepend((prev) => [item, ...prev]);
    setTimeout(() => {
      setTimelinePrepend((prev) => prev.map((p) => (p.id === id ? { ...p, isNew: false } : p)));
    }, 3000);
  }, []);
  useAdminControlEventsWs({ onTimelineEvent: handleTimelineEvent });

  const [confirmCircuit, setConfirmCircuit] = useState<{ action: string; label: string } | null>(null);
  const [confirmCommand, setConfirmCommand] = useState<{ command: string; label: string } | null>(null);
  const [confirmLiquidityKill, setConfirmLiquidityKill] = useState<boolean | null>(null);
  const [confirmEmergencyMode, setConfirmEmergencyMode] = useState<boolean | null>(null);
  const [confirmEmergencyLevel, setConfirmEmergencyLevel] = useState<number | null>(null);
  const [eventServiceFilter, setEventServiceFilter] = useState('');
  const [eventSeverityFilter, setEventSeverityFilter] = useState('');
  const [eventDateStart, setEventDateStart] = useState('');
  const [eventDateEnd, setEventDateEnd] = useState('');
  const [freezeHistoryAssetFilter, setFreezeHistoryAssetFilter] = useState('');
  const [freezeHistoryActionFilter, setFreezeHistoryActionFilter] = useState('');
  const [freezeHistoryDateStart, setFreezeHistoryDateStart] = useState('');
  const [freezeHistoryDateEnd, setFreezeHistoryDateEnd] = useState('');
  const [circuitEventTypeFilter, setCircuitEventTypeFilter] = useState('');
  const [circuitServiceFilter, setCircuitServiceFilter] = useState('');
  const [circuitDateStart, setCircuitDateStart] = useState('');
  const [circuitDateEnd, setCircuitDateEnd] = useState('');
  const [createIncidentOpen, setCreateIncidentOpen] = useState(false);
  const [createIncidentForm, setCreateIncidentForm] = useState({ type: '', severity: 'warning' as string, description: '' });
  const [incidentToast, setIncidentToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [editTriggerModal, setEditTriggerModal] = useState<SafetyTriggerRow | null>(null);
  const [editTriggerForm, setEditTriggerForm] = useState({ threshold_value: '', action: '' });
  const [editTriggerSaveConfirm, setEditTriggerSaveConfirm] = useState(false);
  const [addTriggerModalOpen, setAddTriggerModalOpen] = useState(false);
  const [addTriggerForm, setAddTriggerForm] = useState({
    trigger_name: '',
    metric: '',
    threshold_value: '',
    action: 'send_admin_alert',
    enabled: true,
  });
  const [testTriggerModal, setTestTriggerModal] = useState<SafetyTriggerRow | null>(null);
  const [testTriggerSimulatedMetric, setTestTriggerSimulatedMetric] = useState('');

  // Card quick-action modal
  type CardAction = {
    title: string;
    action: GlobalActionType;
    description: string;
    variant: 'danger' | 'safe';
    needsReason: boolean;
  };
  const [cardAction, setCardAction] = useState<CardAction | null>(null);
  const [cardActionReason, setCardActionReason] = useState('');
  const [cardActionToast, setCardActionToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (!cardActionToast) return;
    const t = setTimeout(() => setCardActionToast(null), 4000);
    return () => clearTimeout(t);
  }, [cardActionToast]);

  useEffect(() => {
    if (!incidentToast) return;
    const t = setTimeout(() => setIncidentToast(null), 3000);
    return () => clearTimeout(t);
  }, [incidentToast]);

  const { data: statusData } = useQuery({
    queryKey: ['admin', 'control', 'status', token],
    staleTime: 30_000,
    queryFn: () => getControlStatus(token),
    enabled: !!token,
    refetchInterval: 10000,
  });
  const { data: assetFreezeData } = useQuery({
    queryKey: ['admin', 'control', 'asset-freeze', token],
    staleTime: 30_000,
    queryFn: () => getControlAssetFreeze(token),
    enabled: !!token,
    refetchInterval: 15_000,
  });
  const { data: incidentsData } = useQuery({
    queryKey: ['admin', 'control', 'incidents', token],
    staleTime: 30_000,
    queryFn: () => getControlIncidents(token, { limit: 50 }),
    enabled: !!token,
    refetchInterval: 20_000,
  });
  const { data: eventsData } = useQuery({
    queryKey: ['admin', 'control', 'events', token],
    staleTime: 30_000,
    queryFn: () => getControlEvents(token, 30),
    enabled: !!token,
    refetchInterval: 20_000,
  });
  const { data: healthScoreData } = useQuery({
    queryKey: ['admin', 'control', 'health-score', token],
    staleTime: 30_000,
    queryFn: () => getControlHealthScore(token),
    enabled: !!token,
    refetchInterval: 15000,
  });
  const { data: healthData } = useQuery({
    queryKey: ['admin', 'control', 'health', token],
    staleTime: 30_000,
    queryFn: () => getControlHealth(token),
    enabled: !!token,
    refetchInterval: 10_000,
  });
  const { data: freezeHistoryData } = useQuery({
    queryKey: ['admin', 'control', 'asset-freeze-history', token],
    staleTime: 30_000,
    queryFn: () => getControlAssetFreezeHistory(token, 20),
    enabled: !!token,
    refetchInterval: 30_000,
  });
  const { data: circuitHistoryData } = useQuery({
    queryKey: ['admin', 'control', 'circuit-history', token],
    staleTime: 30_000,
    queryFn: () => getControlCircuitHistory(token, 20),
    enabled: !!token,
    refetchInterval: 30_000,
  });
  const TIMELINE_PAGE_SIZE = 30;
  const { data: timelineData } = useQuery({
    queryKey: ['admin', 'control', 'timeline', token],
    staleTime: 30_000,
    queryFn: () => getControlTimeline(token, TIMELINE_PAGE_SIZE, 0),
    enabled: !!token,
    refetchInterval: 30_000,
  });
  const { data: commandHistoryData } = useQuery({
    queryKey: ['admin', 'control', 'commands', 'history', token],
    staleTime: 30_000,
    queryFn: () => getControlCommandHistory(token, 50),
    enabled: !!token,
    refetchInterval: 20_000,
  });
  const { data: emergencyLevelData } = useQuery({
    queryKey: ['admin', 'control', 'emergency-level', token],
    staleTime: 30_000,
    queryFn: () => getControlEmergencyLevel(token),
    enabled: !!token,
    refetchInterval: 15_000,
  });
  const { data: safetyTriggersData } = useQuery({
    queryKey: ['admin', 'control', 'safety-triggers', token],
    staleTime: 30_000,
    queryFn: () => getControlSafetyTriggers(token),
    enabled: !!token,
    refetchInterval: 30_000,
  });

  const status = statusData?.data;
  const assets = (assetFreezeData?.data?.assets ?? []) as AssetFreezeRow[];
  const incidents = (incidentsData?.data?.incidents ?? []) as ControlIncidentRow[];
  const events = (eventsData?.data?.events ?? []) as ControlEventRow[];
  const healthScore = healthScoreData?.data;
  const workerHealthServices = (healthData?.data?.services ?? []) as WorkerHealthRow[];

  function formatUptimeSeconds(sec: number): string {
    if (sec < 0 || !Number.isFinite(sec)) return '—';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
  function formatLastRestart(iso: string | null): string {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      const sec = Math.floor((Date.now() - d.getTime()) / 1000);
      if (sec < 60) return 'just now';
      if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
      if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
      return `${Math.floor(sec / 86400)}d ago`;
    } catch {
      return iso;
    }
  }
  function healthStatusVariant(status: string): 'success' | 'warning' | 'danger' {
    if (status === 'healthy') return 'success';
    if (status === 'warning') return 'warning';
    return 'danger';
  }

  const baseTimeline = (timelineData?.data?.timeline ?? []) as TimelineItem[];

  const loadMoreTimeline = useCallback(async () => {
    if (!token || timelineLoadingMore) return;
    const offset = baseTimeline.length + timelineMore.length;
    setTimelineLoadingMore(true);
    try {
      const res = await getControlTimeline(token, TIMELINE_PAGE_SIZE, offset);
      if (res.success && res.data) {
        setTimelineMore((prev) => [...prev, ...(res.data!.timeline ?? [])]);
        setTimelineHasMore(res.data.hasMore ?? false);
      }
    } finally {
      setTimelineLoadingMore(false);
    }
  }, [token, timelineLoadingMore, baseTimeline.length, timelineMore.length]);

  const freezeHistory = (freezeHistoryData?.data?.history ?? []) as AssetFreezeHistoryRow[];
  const circuitHistory = (circuitHistoryData?.data?.history ?? []) as CircuitHistoryRow[];
  useEffect(() => {
    if (timelineData?.data?.hasMore != null) setTimelineHasMore(timelineData.data.hasMore);
  }, [timelineData?.data?.hasMore]);
  const timeline = useMemo(
    () => [...timelinePrepend, ...baseTimeline, ...timelineMore],
    [timelinePrepend, baseTimeline, timelineMore]
  );
  const emergencyLevel = emergencyLevelData?.data?.level ?? 0;
  const safetyTriggers = (safetyTriggersData?.data?.triggers ?? []) as SafetyTriggerRow[];

  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      if (eventServiceFilter && ev.service !== eventServiceFilter) return false;
      if (eventSeverityFilter && ev.severity !== eventSeverityFilter) return false;
      if (eventDateStart || eventDateEnd) {
        const t = ev.timestamp ? new Date(ev.timestamp).getTime() : 0;
        if (eventDateStart) {
          const start = new Date(eventDateStart);
          start.setHours(0, 0, 0, 0);
          if (t < start.getTime()) return false;
        }
        if (eventDateEnd) {
          const end = new Date(eventDateEnd);
          end.setHours(23, 59, 59, 999);
          if (t > end.getTime()) return false;
        }
      }
      return true;
    });
  }, [events, eventServiceFilter, eventSeverityFilter, eventDateStart, eventDateEnd]);

  const filteredFreezeHistory = useMemo(() => {
    return freezeHistory.filter((h) => {
      if (freezeHistoryAssetFilter && h.asset !== freezeHistoryAssetFilter) return false;
      if (freezeHistoryActionFilter) {
        const matchList = FREEZE_ACTION_MATCH[freezeHistoryActionFilter];
        if (matchList && !matchList.includes(h.action)) return false;
      }
      if (freezeHistoryDateStart || freezeHistoryDateEnd) {
        const t = h.created_at ? new Date(h.created_at).getTime() : 0;
        if (freezeHistoryDateStart) {
          const start = new Date(freezeHistoryDateStart);
          start.setHours(0, 0, 0, 0);
          if (t < start.getTime()) return false;
        }
        if (freezeHistoryDateEnd) {
          const end = new Date(freezeHistoryDateEnd);
          end.setHours(23, 59, 59, 999);
          if (t > end.getTime()) return false;
        }
      }
      return true;
    });
  }, [freezeHistory, freezeHistoryAssetFilter, freezeHistoryActionFilter, freezeHistoryDateStart, freezeHistoryDateEnd]);

  const filteredCircuitHistory = useMemo(() => {
    return circuitHistory.filter((h) => {
      if (circuitEventTypeFilter) {
        const rowType = circuitEventToType(h.event);
        if (rowType !== circuitEventTypeFilter) return false;
      }
      if (circuitServiceFilter) {
        const rowService = circuitRowToServiceCategory(h.event, h.service);
        if (rowService !== circuitServiceFilter) return false;
      }
      if (circuitDateStart || circuitDateEnd) {
        const t = h.created_at ? new Date(h.created_at).getTime() : 0;
        if (circuitDateStart) {
          const start = new Date(circuitDateStart);
          start.setHours(0, 0, 0, 0);
          if (t < start.getTime()) return false;
        }
        if (circuitDateEnd) {
          const end = new Date(circuitDateEnd);
          end.setHours(23, 59, 59, 999);
          if (t > end.getTime()) return false;
        }
      }
      return true;
    });
  }, [circuitHistory, circuitEventTypeFilter, circuitServiceFilter, circuitDateStart, circuitDateEnd]);

  const circuitMutation = useMutation({
    mutationFn: (action: string) => postControlCircuit(token, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'control', 'status'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'control', 'circuit-history'] });
      setConfirmCircuit(null);
    },
  });
  const assetFreezeMutation = useMutation({
    mutationFn: (body: { asset: string; deposits_frozen?: boolean; withdrawals_frozen?: boolean; trading_frozen?: boolean }) =>
      patchControlAssetFreeze(token, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'control', 'asset-freeze'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'control', 'asset-freeze-history'] });
    },
  });
  const liquidityKillMutation = useMutation({
    mutationFn: (enabled: boolean) => postControlLiquidityKill(token, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'control', 'status'] });
      setConfirmLiquidityKill(null);
    },
  });
  const emergencyModeMutation = useMutation({
    mutationFn: (enabled: boolean) => postControlEmergencyMode(token, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'control', 'status'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'control', 'circuit-history'] });
      setConfirmEmergencyMode(null);
    },
  });
  const resolveIncidentMutation = useMutation({
    mutationFn: (id: string) => resolveControlIncident(token, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'control', 'incidents'] }),
  });
  const createIncidentMutation = useMutation({
    mutationFn: (body: { type: string; severity: string; description?: string }) => createControlIncident(token, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'control', 'incidents'] });
      setCreateIncidentOpen(false);
      setCreateIncidentForm({ type: '', severity: 'warning', description: '' });
      setIncidentToast({ message: 'Incident created successfully.', type: 'success' });
    },
    onError: () => {
      setIncidentToast({ message: 'Failed to create incident.', type: 'error' });
    },
  });
  const commandMutation = useMutation({
    mutationFn: (command: string) => postControlCommand(token, command),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'control', 'events'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'control', 'commands', 'history'] });
      setConfirmCommand(null);
    },
  });
  const emergencyLevelMutation = useMutation({
    mutationFn: (level: number) => postControlEmergencyLevel(token, level),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'control', 'emergency-level'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'control', 'status'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'control', 'circuit-history'] });
      setConfirmEmergencyLevel(null);
    },
  });
  const safetyTriggersMutation = useMutation({
    mutationFn: (triggers: Array<{ trigger_type: string; threshold_value: number; action: string; enabled: boolean }>) =>
      patchControlSafetyTriggers(token, triggers),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'control', 'safety-triggers'] }),
  });

  const globalActionMutation = useMutation({
    mutationFn: (body: { action: GlobalActionType; reason?: string }) =>
      postControlGlobalAction(token, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'control', 'status'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'control', 'events'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'control', 'circuit-history'] });
      setCardAction(null);
      setCardActionReason('');
      setCardActionToast({ message: 'Action executed successfully.', type: 'success' });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Action failed';
      setCardActionToast({ message: msg, type: 'error' });
    },
  });

  return (
    <AdminPageFrame title="Exchange Controls" description="Control exchange operations, circuit breakers, asset freezes, and emergency actions.">

      {/* Quick status strip */}
      {status && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-admin-border bg-white/[0.02] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className={cn('h-2 w-2 rounded-full', status.exchange_status === 'operational' ? 'bg-emerald-400' : status.exchange_status === 'degraded' ? 'bg-amber-400' : 'bg-red-400')} />
            <span className="text-xs font-medium text-admin-muted">Exchange</span>
            <span className="text-xs font-semibold text-admin-text capitalize">{status.exchange_status}</span>
          </div>
          <div className="h-4 w-px bg-admin-border" />
          <div className="flex items-center gap-2">
            <Zap className="h-3 w-3 text-admin-muted" />
            <span className="text-xs text-admin-muted">Trading</span>
            <span className={cn('text-xs font-semibold capitalize', status.trading_status === 'active' ? 'text-emerald-400' : 'text-red-400')}>{status.trading_status}</span>
          </div>
          <div className="h-4 w-px bg-admin-border" />
          <div className="flex items-center gap-2">
            <Power className="h-3 w-3 text-admin-muted" />
            <span className="text-xs text-admin-muted">Withdrawals</span>
            <span className={cn('text-xs font-semibold capitalize', status.withdrawals_status === 'enabled' ? 'text-emerald-400' : 'text-red-400')}>{status.withdrawals_status}</span>
          </div>
          <div className="h-4 w-px bg-admin-border" />
          <div className="flex items-center gap-2">
            <Power className="h-3 w-3 text-admin-muted" />
            <span className="text-xs text-admin-muted">Deposits</span>
            <span className={cn('text-xs font-semibold capitalize', status.deposits_status === 'enabled' ? 'text-emerald-400' : 'text-red-400')}>{status.deposits_status}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Layers className="h-3 w-3 text-admin-muted" />
            <span className="text-xs text-admin-muted">Emergency Level</span>
            <span className={cn('rounded px-1.5 py-0.5 text-xs font-bold tabular-nums', emergencyLevel === 0 ? 'bg-emerald-500/10 text-emerald-400' : emergencyLevel === 1 ? 'bg-amber-500/10 text-amber-400' : emergencyLevel === 2 ? 'bg-orange-500/10 text-orange-400' : 'bg-red-500/10 text-red-400')}>{emergencyLevel}</span>
          </div>
        </div>
      )}

      {/* ZONE: Live Status */}
      <ZoneHeader title="Live Status" icon={Activity} />

      {/* Health score hero */}
      <Card className="overflow-hidden">
        <div className="flex flex-col lg:flex-row">
          {/* Gauge side */}
          <div className="flex flex-col items-center justify-center gap-2 border-b border-admin-border bg-gradient-to-br from-white/[0.03] to-transparent px-8 py-6 lg:border-b-0 lg:border-r lg:py-8">
            <HealthGauge score={healthScore?.score ?? 0} />
            <p className="text-xs font-medium uppercase tracking-widest text-admin-muted">Health Score</p>
            <p className="text-[10px] text-admin-muted/60">via WebSocket · 5s</p>
          </div>
          {/* Metrics side */}
          <div className="flex-1 p-6">
            <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-admin-muted">Metric Breakdown</p>
            {healthScore?.metrics ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <MetricScore label="API Latency" value={healthScore.metrics.api_latency} />
                <MetricScore label="Matching Latency" value={healthScore.metrics.matching_latency} />
                <MetricScore label="RPC Health" value={healthScore.metrics.rpc_health} />
                <MetricScore label="Queue Backlog" value={healthScore.metrics.queue_backlog} />
              </div>
            ) : (
              <p className="text-sm text-admin-muted">Waiting for health data…</p>
            )}
          </div>
        </div>
      </Card>

      {/* Service status monitoring */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Service status
          </CardTitle>
          <p className="text-sm text-admin-muted">Real health from backend workers. Polled every 10s.</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border border-admin-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/[0.02]">
                <tr>
                  <th className="px-4 py-3 font-medium text-admin-muted">Service</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Status</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Uptime</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Last restart</th>
                </tr>
              </thead>
              <tbody>
                {workerHealthServices.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-admin-muted">Loading…</td></tr>
                ) : (
                  workerHealthServices.map((s) => (
                    <tr key={s.service} className="border-t border-admin-border">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={cn('h-2 w-2 rounded-full shrink-0', s.status === 'healthy' || s.status === 'running' ? 'bg-emerald-400' : s.status === 'degraded' ? 'bg-amber-400' : 'bg-red-400')} />
                          <span className="font-medium">{s.service}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={s.status} variant={healthStatusVariant(s.status)} />
                      </td>
                      <td className="px-4 py-3 tabular-nums text-admin-muted">{formatUptimeSeconds(s.uptime)}</td>
                      <td className="px-4 py-3 text-admin-muted text-xs">{formatLastRestart(s.last_restart)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Exchange status cards — clickable */}
      {cardActionToast && (
        <div className={cn('rounded-lg px-4 py-2 text-sm', cardActionToast.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20')} role="alert">
          {cardActionToast.message}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {([
          {
            title: 'Exchange',
            value: status?.exchange_status,
            icon: Activity,
            ok: ['operational'],
            onAction: status?.exchange_status === 'operational'
              ? { title: 'Enable Emergency Mode', action: 'halt_trading' as GlobalActionType, description: 'This will halt all trading and put the exchange in degraded state.', variant: 'danger' as const, needsReason: true }
              : { title: 'Resume Exchange', action: 'resume_trading' as GlobalActionType, description: 'This will resume normal trading operations.', variant: 'safe' as const, needsReason: false },
          },
          {
            title: 'Trading',
            value: status?.trading_status,
            icon: Zap,
            ok: ['active'],
            onAction: status?.trading_status === 'active'
              ? { title: 'Halt Trading', action: 'halt_trading' as GlobalActionType, description: 'This will pause all spot trading across all markets.', variant: 'danger' as const, needsReason: true }
              : { title: 'Resume Trading', action: 'resume_trading' as GlobalActionType, description: 'This will resume trading across all markets.', variant: 'safe' as const, needsReason: false },
          },
          {
            title: 'Withdrawals',
            value: status?.withdrawals_status,
            icon: Power,
            ok: ['enabled'],
            onAction: status?.withdrawals_status === 'enabled'
              ? { title: 'Disable Withdrawals', action: 'disable_withdrawals' as GlobalActionType, description: 'This will block all user withdrawal requests.', variant: 'danger' as const, needsReason: true }
              : { title: 'Enable Withdrawals', action: 'enable_withdrawals' as GlobalActionType, description: 'This will allow withdrawal requests again.', variant: 'safe' as const, needsReason: false },
          },
          {
            title: 'Deposits',
            value: status?.deposits_status,
            icon: Power,
            ok: ['enabled'],
            onAction: status?.deposits_status === 'enabled'
              ? { title: 'Disable Deposits', action: 'disable_deposits' as GlobalActionType, description: 'This will block all incoming deposit credits.', variant: 'danger' as const, needsReason: true }
              : { title: 'Enable Deposits', action: 'enable_deposits' as GlobalActionType, description: 'This will allow deposit credits again.', variant: 'safe' as const, needsReason: false },
          },
          {
            title: 'Liquidity Engine',
            value: status?.liquidity_engine_status,
            icon: Activity,
            ok: ['operational', 'active', 'enabled'],
            onAction: status?.liquidity_engine_status !== 'disabled'
              ? { title: 'Pause Market Making', action: 'pause_market_making' as GlobalActionType, description: 'This will stop the MM engine and block new orders from the liquidity bot.', variant: 'danger' as const, needsReason: true }
              : { title: 'Resume Market Making', action: 'resume_market_making' as GlobalActionType, description: 'This will resume the MM engine and liquidity bot.', variant: 'safe' as const, needsReason: false },
          },
        ]).map(({ title, value, icon: SIcon, ok, onAction }) => {
          const isOk = value ? ok.includes(value) : false;
          return (
            <button
              key={title}
              type="button"
              onClick={() => { setCardAction(onAction); setCardActionReason(''); }}
              disabled={!status || globalActionMutation.isPending}
              className={cn(
                'group relative rounded-lg border p-4 text-left transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none',
                isOk ? 'border-emerald-500/20 bg-emerald-500/[0.04] hover:border-emerald-500/40 hover:bg-emerald-500/[0.08]' : value ? 'border-red-500/20 bg-red-500/[0.04] hover:border-red-500/40 hover:bg-red-500/[0.08]' : 'border-admin-border bg-admin-card',
              )}
            >
              <div className="flex items-center justify-between">
                <SIcon className={cn('h-4 w-4', isOk ? 'text-emerald-400' : value ? 'text-red-400' : 'text-admin-muted')} />
                <div className="flex items-center gap-1.5">
                  <span className={cn('h-2 w-2 rounded-full', isOk ? 'bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.4)]' : value ? 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.4)]' : 'bg-zinc-600')} />
                </div>
              </div>
              <p className="mt-3 text-xs text-admin-muted">{title}</p>
              <p className={cn('text-sm font-semibold capitalize', isOk ? 'text-emerald-400' : value ? 'text-red-400' : 'text-admin-text')}>{value ?? '—'}</p>
              {/* Hover hint */}
              <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <span className={cn('text-[10px] font-medium', onAction.variant === 'danger' ? 'text-red-400/70' : 'text-emerald-400/70')}>
                  Click to {onAction.variant === 'danger' ? 'disable' : 'enable'}
                </span>
                <ChevronRight className="h-2.5 w-2.5 text-admin-muted/50" />
              </div>
            </button>
          );
        })}
      </div>

      {/* ZONE: Emergency Controls */}
      <ZoneHeader title="Emergency Controls" icon={Flame} variant="danger" />

      {/* Circuit breaker + Kill switch + Emergency mode — Danger Zone */}
      <div className="rounded-xl border border-red-500/20 bg-red-500/[0.02] p-4 space-y-4">
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Circuit breaker */}
          <Card className="border-red-500/10">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Zap className="h-4 w-4 text-red-400" />
                Circuit Breaker
              </CardTitle>
              <p className="text-xs text-admin-muted">Open/close trading circuit or pause matching engine.</p>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {CIRCUIT_ACTIONS.map(({ action, label, icon: Icon }) => (
                  <Button
                    key={action}
                    variant="secondary"
                    size="sm"
                    onClick={() => setConfirmCircuit({ action, label })}
                    disabled={circuitMutation.isPending}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Kill switch */}
          <Card className="border-red-500/10">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <PowerOff className="h-4 w-4 text-red-400" />
                Liquidity Kill Switch
              </CardTitle>
              <p className="text-xs text-admin-muted">Disables liquidity bot, MM accounts, and external providers.</p>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button variant="danger" size="sm" onClick={() => setConfirmLiquidityKill(true)} disabled={liquidityKillMutation.isPending}>
                Activate
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirmLiquidityKill(false)} disabled={liquidityKillMutation.isPending}>
                Deactivate
              </Button>
            </CardContent>
          </Card>

          {/* Emergency mode */}
          <Card className="border-red-500/10">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-red-400" />
                Emergency Mode
              </CardTitle>
              <p className="text-xs text-admin-muted">Pause trading, disable withdrawals and deposits, enable safe mode.</p>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button variant="danger" size="sm" onClick={() => setConfirmEmergencyMode(true)} disabled={emergencyModeMutation.isPending}>
                Enable
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirmEmergencyMode(false)} disabled={emergencyModeMutation.isPending}>
                Disable
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Asset freeze controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Snowflake className="h-5 w-5" />
            Asset freeze controls
          </CardTitle>
          <p className="text-sm text-admin-muted">Freeze deposits, withdrawals, or trading per asset.</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border border-admin-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/[0.02]">
                <tr>
                  <th className="px-4 py-3 font-medium text-admin-muted">Asset</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Deposits</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Withdrawals</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Trading</th>
                </tr>
              </thead>
              <tbody>
                {assets.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-0">
                      <TableSkeleton rows={3} cols={4} />
                    </td>
                  </tr>
                ) : (
                  assets.map((row) => (
                    <tr key={row.asset} className="border-t border-admin-border">
                      <td className="px-4 py-3 font-semibold">{row.asset}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <FreezeToggle
                            frozen={!!row.deposits_frozen}
                            onToggle={() => assetFreezeMutation.mutate({ asset: row.asset, deposits_frozen: !row.deposits_frozen })}
                            disabled={assetFreezeMutation.isPending}
                            label={`Toggle ${row.asset} deposits`}
                          />
                          <span className={cn('text-xs font-medium', row.deposits_frozen ? 'text-red-400' : 'text-emerald-400')}>{row.deposits_frozen ? 'Frozen' : 'OK'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <FreezeToggle
                            frozen={!!row.withdrawals_frozen}
                            onToggle={() => assetFreezeMutation.mutate({ asset: row.asset, withdrawals_frozen: !row.withdrawals_frozen })}
                            disabled={assetFreezeMutation.isPending}
                            label={`Toggle ${row.asset} withdrawals`}
                          />
                          <span className={cn('text-xs font-medium', row.withdrawals_frozen ? 'text-red-400' : 'text-emerald-400')}>{row.withdrawals_frozen ? 'Frozen' : 'OK'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <FreezeToggle
                            frozen={!!row.trading_frozen}
                            onToggle={() => assetFreezeMutation.mutate({ asset: row.asset, trading_frozen: !row.trading_frozen })}
                            disabled={assetFreezeMutation.isPending}
                            label={`Toggle ${row.asset} trading`}
                          />
                          <span className={cn('text-xs font-medium', row.trading_frozen ? 'text-red-400' : 'text-emerald-400')}>{row.trading_frozen ? 'Frozen' : 'OK'}</span>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ZONE: Incidents & History */}
      <ZoneHeader title="Incidents & History" icon={Clock} />

      {/* 6. Incident management */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ListChecks className="h-5 w-5" />
                Incident management
              </CardTitle>
              <p className="text-sm text-admin-muted">View and mark incidents resolved.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={() => setCreateIncidentOpen(true)}>
                Create Incident
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const rows: StandardExportRow[] = incidents.map((inc) => ({
                    timestamp: inc.created_at ?? '',
                    type: inc.type,
                    service: inc.type,
                    admin: '',
                    details: `${inc.severity} ${inc.status}`,
                  }));
                  exportStandardCsv(rows, 'incidents');
                }}
              >
                Export CSV
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const rows: StandardExportRow[] = incidents.map((inc) => ({
                    timestamp: inc.created_at ?? '',
                    type: inc.type,
                    service: inc.type,
                    admin: '',
                    details: `${inc.severity} ${inc.status}`,
                  }));
                  exportStandardJson(rows, 'incidents');
                }}
              >
                Export JSON
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {incidentToast && (
            <div
              className={cn('mb-4 rounded-lg px-4 py-2 text-sm', incidentToast.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20')}
              role="alert"
            >
              {incidentToast.message}
            </div>
          )}
          <div className="overflow-x-auto rounded-xl border border-admin-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/[0.02]">
                <tr>
                  <th className="px-4 py-3 font-medium text-admin-muted">Incident ID</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Type</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Severity</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Status</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Created</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Actions</th>
                </tr>
              </thead>
              <tbody>
                {incidents.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-admin-muted">No incidents.</td>
                  </tr>
                ) : (
                  incidents.map((inc) => (
                    <tr key={inc.id} className="border-t border-admin-border">
                      <td className="px-4 py-3 font-mono text-xs">{inc.id.slice(0, 8)}…</td>
                      <td className="px-4 py-3">{inc.type}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={inc.severity} variant={inc.severity === 'high' ? 'danger' : inc.severity === 'medium' ? 'warning' : 'default'} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={inc.status} variant={inc.status === 'resolved' ? 'success' : 'warning'} />
                      </td>
                      <td className="px-4 py-3 text-admin-muted text-xs">{inc.created_at ? new Date(inc.created_at).toLocaleString() : '—'}</td>
                      <td className="px-4 py-3">
                        {inc.status !== 'resolved' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => resolveIncidentMutation.mutate(inc.id)}
                            disabled={resolveIncidentMutation.isPending}
                          >
                            <CheckCircle className="h-4 w-4" />
                            Mark resolved
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* History side-by-side */}
      <div className="grid gap-6 lg:grid-cols-2">
      {/* Asset freeze history */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Asset freeze history
              </CardTitle>
              <p className="text-sm text-admin-muted">Track asset freeze changes.</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const rows: StandardExportRow[] = filteredFreezeHistory.map((h) => ({
                    timestamp: h.created_at ?? '',
                    type: h.action,
                    service: h.asset,
                    admin: h.changed_by ?? '',
                    details: h.action,
                  }));
                  exportStandardCsv(rows, 'asset_freeze_history');
                }}
              >
                Export CSV
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const rows: StandardExportRow[] = filteredFreezeHistory.map((h) => ({
                    timestamp: h.created_at ?? '',
                    type: h.action,
                    service: h.asset,
                    admin: h.changed_by ?? '',
                    details: h.action,
                  }));
                  exportStandardJson(rows, 'asset_freeze_history');
                }}
              >
                Export JSON
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <select
              className="rounded-lg border border-admin-border bg-admin-card px-3 py-2 text-sm text-admin-text"
              value={freezeHistoryAssetFilter}
              onChange={(e) => setFreezeHistoryAssetFilter(e.target.value)}
            >
              {FREEZE_HISTORY_ASSET_OPTIONS.map((o) => (
                <option key={o.value || 'all'} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              className="rounded-lg border border-admin-border bg-admin-card px-3 py-2 text-sm text-admin-text"
              value={freezeHistoryActionFilter}
              onChange={(e) => setFreezeHistoryActionFilter(e.target.value)}
            >
              {FREEZE_HISTORY_ACTION_OPTIONS.map((o) => (
                <option key={o.value || 'all'} value={o.value}>{o.label}</option>
              ))}
            </select>
            <input
              type="date"
              className="rounded-lg border border-admin-border px-3 py-2 text-sm text-admin-text"
              value={freezeHistoryDateStart}
              onChange={(e) => setFreezeHistoryDateStart(e.target.value)}
              title="From date"
            />
            <input
              type="date"
              className="rounded-lg border border-admin-border px-3 py-2 text-sm text-admin-text"
              value={freezeHistoryDateEnd}
              onChange={(e) => setFreezeHistoryDateEnd(e.target.value)}
              title="To date"
            />
          </div>
          <div className="overflow-x-auto rounded-xl border border-admin-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/[0.02]">
                <tr>
                  <th className="px-4 py-3 font-medium text-admin-muted">Asset</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Action</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Changed by</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {filteredFreezeHistory.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-admin-muted">
                      {freezeHistory.length === 0 ? 'No history yet.' : 'No events match selected filters.'}
                    </td>
                  </tr>
                ) : (
                  filteredFreezeHistory.map((h, i) => (
                    <tr key={i} className="border-t border-admin-border">
                      <td className="px-4 py-3 font-medium">{h.asset}</td>
                      <td className="px-4 py-3">{h.action}</td>
                      <td className="px-4 py-3 text-admin-muted text-xs">{h.changed_by ?? '—'}</td>
                      <td className="px-4 py-3 text-admin-muted text-xs">{h.created_at ? new Date(h.created_at).toLocaleString() : '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Circuit breaker history */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Circuit breaker history
              </CardTitle>
              <p className="text-sm text-admin-muted">Trading circuit opened/closed, matching engine paused, emergency mode.</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const rows: StandardExportRow[] = filteredCircuitHistory.map((h) => ({
                    timestamp: h.created_at ?? '',
                    type: h.event,
                    service: h.service ?? '',
                    admin: '',
                    details: h.event,
                  }));
                  exportStandardCsv(rows, 'circuit_history');
                }}
              >
                Export CSV
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const rows: StandardExportRow[] = filteredCircuitHistory.map((h) => ({
                    timestamp: h.created_at ?? '',
                    type: h.event,
                    service: h.service ?? '',
                    admin: '',
                    details: h.event,
                  }));
                  exportStandardJson(rows, 'circuit_history');
                }}
              >
                Export JSON
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <select
              className="rounded-lg border border-admin-border bg-admin-card px-3 py-2 text-sm text-admin-text"
              value={circuitEventTypeFilter}
              onChange={(e) => setCircuitEventTypeFilter(e.target.value)}
            >
              {CIRCUIT_EVENT_TYPE_OPTIONS.map((o) => (
                <option key={o.value || 'all'} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              className="rounded-lg border border-admin-border bg-admin-card px-3 py-2 text-sm text-admin-text"
              value={circuitServiceFilter}
              onChange={(e) => setCircuitServiceFilter(e.target.value)}
            >
              {CIRCUIT_SERVICE_OPTIONS.map((o) => (
                <option key={o.value || 'all'} value={o.value}>{o.label}</option>
              ))}
            </select>
            <input
              type="date"
              className="rounded-lg border border-admin-border px-3 py-2 text-sm text-admin-text"
              value={circuitDateStart}
              onChange={(e) => setCircuitDateStart(e.target.value)}
              title="From date"
            />
            <input
              type="date"
              className="rounded-lg border border-admin-border px-3 py-2 text-sm text-admin-text"
              value={circuitDateEnd}
              onChange={(e) => setCircuitDateEnd(e.target.value)}
              title="To date"
            />
          </div>
          <div className="overflow-x-auto rounded-xl border border-admin-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/[0.02]">
                <tr>
                  <th className="px-4 py-3 font-medium text-admin-muted">Event</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Service</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Triggered By</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {filteredCircuitHistory.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-admin-muted">
                      {circuitHistory.length === 0 ? 'No circuit events yet.' : 'No circuit events found.'}
                    </td>
                  </tr>
                ) : (
                  filteredCircuitHistory.map((h, i) => (
                    <tr key={i} className="border-t border-admin-border">
                      <td className="px-4 py-3">{h.event}</td>
                      <td className="px-4 py-3 text-admin-muted">{h.service ?? '—'}</td>
                      <td className="px-4 py-3 text-admin-muted text-xs">—</td>
                      <td className="px-4 py-3 text-admin-muted text-xs">{h.created_at ? new Date(h.created_at).toLocaleString() : '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      </div>{/* close history grid */}

      {/* Incident timeline */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Incident timeline
              </CardTitle>
              <p className="text-sm text-admin-muted">Real-time timeline. New events appear at top; highlight for 3s.</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const rows: StandardExportRow[] = timeline.map((item) => ({
                    timestamp: item.timestamp ?? '',
                    type: item.event,
                    service: item.service,
                    admin: '',
                    details: item.event,
                  }));
                  exportStandardCsv(rows, 'timeline');
                }}
              >
                Export CSV
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const rows: StandardExportRow[] = timeline.map((item) => ({
                    timestamp: item.timestamp ?? '',
                    type: item.event,
                    service: item.service,
                    admin: '',
                    details: item.event,
                  }));
                  exportStandardJson(rows, 'timeline');
                }}
              >
                Export JSON
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="relative max-h-96 overflow-y-auto pl-6">
            {timeline.length === 0 ? (
              <p className="py-4 text-center text-admin-muted">No timeline events.</p>
            ) : (
              <>
                {/* Vertical line */}
                <div className="absolute left-[11px] top-0 bottom-0 w-px bg-admin-border" />
                <div className="space-y-0">
                  {timeline.map((item, i) => {
                    const isPrepend = 'id' in item && item.id;
                    const key = isPrepend ? (item as TimelinePrependItem).id : `t-${i}-${item.timestamp}-${item.event}`;
                    const isNew = isPrepend && (item as TimelinePrependItem).isNew;
                    const dateStr = item.timestamp ? new Date(item.timestamp).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—';
                    return (
                      <div key={key} className="relative flex gap-4 pb-4">
                        {/* Dot */}
                        <div className={cn(
                          'absolute -left-6 top-1.5 h-2.5 w-2.5 rounded-full border-2 shrink-0 z-10',
                          isNew ? 'border-blue-400 bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.5)]' : 'border-admin-border bg-[#0a0b0f]',
                        )} />
                        <div className={cn(
                          'flex-1 rounded-lg border p-3 text-sm transition-all',
                          isNew ? 'border-blue-500/30 bg-blue-500/[0.05]' : 'border-admin-border/50 bg-transparent',
                        )}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-admin-text">{item.event}</span>
                              <StatusBadge status={item.service} variant="default" />
                            </div>
                            <span className="shrink-0 text-[11px] tabular-nums text-admin-muted">{dateStr}</span>
                          </div>
                          {'triggered_by' in item && item.triggered_by && (
                            <p className="mt-1 text-xs text-admin-muted">Triggered by {item.triggered_by}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          {timelineHasMore && (
            <div className="mt-3 flex justify-center">
              <Button variant="secondary" size="sm" onClick={loadMoreTimeline} disabled={timelineLoadingMore}>
                {timelineLoadingMore ? 'Loading…' : 'Load More'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Multi-stage emergency controls — Stepper */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Layers className="h-5 w-5" />
                Multi-stage emergency controls
              </CardTitle>
              <p className="text-sm text-admin-muted">Select a level or use Escalate/Downgrade. Changes require confirmation.</p>
            </div>
            <div className="flex gap-1">
              <Button variant="secondary" size="sm" onClick={() => emergencyLevel > 0 && setConfirmEmergencyLevel(Math.max(0, emergencyLevel - 1))} disabled={emergencyLevel <= 0 || emergencyLevelMutation.isPending}>
                <ChevronDown className="h-4 w-4" /> Downgrade
              </Button>
              <Button variant="secondary" size="sm" onClick={() => emergencyLevel < 3 && setConfirmEmergencyLevel(Math.min(3, emergencyLevel + 1))} disabled={emergencyLevel >= 3 || emergencyLevelMutation.isPending}>
                <ChevronUp className="h-4 w-4" /> Escalate
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Stepper visualization */}
          <div className="flex items-start gap-0 overflow-x-auto pb-2">
            {EMERGENCY_LEVELS.map(({ level, label, description }, i) => {
              const isActive = emergencyLevel === level;
              const isPassed = emergencyLevel > level;
              const levelColors = [
                { ring: 'border-emerald-500 bg-emerald-500/20 text-emerald-400', line: 'bg-emerald-500', desc: 'text-emerald-400/60' },
                { ring: 'border-amber-500 bg-amber-500/20 text-amber-400', line: 'bg-amber-500', desc: 'text-amber-400/60' },
                { ring: 'border-orange-500 bg-orange-500/20 text-orange-400', line: 'bg-orange-500', desc: 'text-orange-400/60' },
                { ring: 'border-red-500 bg-red-500/20 text-red-400', line: 'bg-red-500', desc: 'text-red-400/60' },
              ];
              const c = levelColors[level];
              return (
                <div key={level} className="flex items-start">
                  <button
                    onClick={() => setConfirmEmergencyLevel(level)}
                    disabled={emergencyLevelMutation.isPending}
                    className="flex flex-col items-center gap-1.5 px-2 disabled:opacity-50"
                  >
                    <div className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-bold tabular-nums transition-all',
                      isActive || isPassed ? c.ring : 'border-admin-border bg-transparent text-admin-muted',
                      isActive && 'ring-2 ring-offset-2 ring-offset-[#0a0b0f]',
                      isActive && (level === 0 ? 'ring-emerald-500/40' : level === 1 ? 'ring-amber-500/40' : level === 2 ? 'ring-orange-500/40' : 'ring-red-500/40'),
                    )}>
                      {level}
                    </div>
                    <span className={cn('text-[11px] font-semibold whitespace-nowrap', isActive ? 'text-admin-text' : 'text-admin-muted')}>{label}</span>
                    <span className={cn('text-[10px] max-w-[120px] text-center leading-tight', isActive ? c.desc : 'text-admin-muted/40')}>{description}</span>
                  </button>
                  {i < EMERGENCY_LEVELS.length - 1 && (
                    <div className="mt-5 flex items-center">
                      <div className={cn('h-0.5 w-10 transition-colors', isPassed ? c.line : 'bg-admin-border')} />
                      <ChevronRight className={cn('h-3 w-3 -ml-1', isPassed ? c.line.replace('bg-', 'text-') : 'text-admin-border')} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ZONE: Automation & Commands */}
      <ZoneHeader title="Automation & Commands" icon={Settings} />

      {/* Automated safety triggers */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Automated safety triggers
              </CardTitle>
              <p className="mt-1 text-sm text-admin-muted">When a metric exceeds its threshold, the system runs the selected action. Max 20 triggers.</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setAddTriggerModalOpen(true);
                setAddTriggerForm({ trigger_name: '', metric: '', threshold_value: '', action: 'send_admin_alert', enabled: true });
              }}
              disabled={safetyTriggers.length >= 20}
            >
              Add trigger
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border border-admin-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/[0.02]">
                <tr>
                  <th className="px-4 py-3 font-medium text-admin-muted">Trigger</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Threshold</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Action</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Enabled</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Actions</th>
                </tr>
              </thead>
              <tbody>
                {safetyTriggers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-0">
                      <TableSkeleton rows={3} cols={4} />
                    </td>
                  </tr>
                ) : (
                  safetyTriggers.map((t) => (
                    <tr key={t.id} className="border-t border-admin-border">
                      <td className="px-4 py-3 font-medium">{t.trigger_type.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-3">{t.threshold_value}</td>
                      <td className="px-4 py-3 text-admin-muted">{t.action.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={t.enabled ? 'On' : 'Off'} variant={t.enabled ? 'success' : 'default'} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setTestTriggerModal(t);
                              const thresh = Number(t.threshold_value);
                              setTestTriggerSimulatedMetric(Number.isNaN(thresh) ? '' : String(thresh + 300));
                            }}
                          >
                            Test trigger
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setEditTriggerModal(t);
                              setEditTriggerForm({ threshold_value: String(t.threshold_value), action: t.action });
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => safetyTriggersMutation.mutate(
                              safetyTriggers.map((x) => ({
                                trigger_type: x.trigger_type,
                                metric: x.metric ?? x.trigger_type,
                                threshold_value: Number(x.threshold_value),
                                action: x.action,
                                enabled: x.id === t.id ? !x.enabled : !!x.enabled,
                              }))
                            )}
                            disabled={safetyTriggersMutation.isPending}
                          >
                            Toggle
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 7. System command execution */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            System command execution
          </CardTitle>
          <p className="text-sm text-admin-muted">
            Run operational commands. All require confirmation. Requires <code className="rounded bg-white/5 px-1">control:commands</code> permission.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap gap-2">
            {SYSTEM_COMMANDS.map(({ command, label }) => (
              <Button
                key={command}
                variant="secondary"
                onClick={() => setConfirmCommand({ command, label })}
                disabled={commandMutation.isPending || !canExecuteCommands}
              >
                {label}
              </Button>
            ))}
          </div>
          {!canExecuteCommands && (
            <p className="text-sm text-amber-400">You do not have permission to run system commands.</p>
          )}
          <div>
            <h4 className="mb-3 text-sm font-medium text-admin-text">Command history</h4>
            <div className="overflow-x-auto rounded-xl border border-admin-border">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className="px-4 py-3 font-medium text-admin-muted">Command</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Triggered by</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Status</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {!commandHistoryData?.data?.history?.length ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-admin-muted">
                        No command history yet.
                      </td>
                    </tr>
                  ) : (
                    commandHistoryData.data.history.map((row, i) => (
                      <tr key={i} className="border-t border-admin-border">
                        <td className="px-4 py-3 font-mono text-xs">{row.command}</td>
                        <td className="px-4 py-3">{row.triggered_by || '—'}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={row.status} variant={row.status === 'success' ? 'success' : row.status === 'failed' ? 'danger' : 'default'} />
                        </td>
                        <td className="px-4 py-3 text-admin-muted text-xs">
                          {row.timestamp ? new Date(row.timestamp).toLocaleString() : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 8. Global event log */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Global event log
              </CardTitle>
              <p className="text-sm text-admin-muted">System-wide operational events.</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const rows: StandardExportRow[] = filteredEvents.map((ev) => ({
                    timestamp: ev.timestamp ?? '',
                    type: ev.event,
                    service: ev.service,
                    admin: '',
                    details: ev.event,
                  }));
                  exportStandardCsv(rows, 'events');
                }}
              >
                Export CSV
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const rows: StandardExportRow[] = filteredEvents.map((ev) => ({
                    timestamp: ev.timestamp ?? '',
                    type: ev.event,
                    service: ev.service,
                    admin: '',
                    details: ev.event,
                  }));
                  exportStandardJson(rows, 'events');
                }}
              >
                Export JSON
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <select
              className="rounded-lg border border-admin-border bg-admin-card px-3 py-2 text-sm text-admin-text"
              value={eventServiceFilter}
              onChange={(e) => setEventServiceFilter(e.target.value)}
            >
              {EVENT_SERVICE_OPTIONS.map((o) => (
                <option key={o.value || 'all'} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              className="rounded-lg border border-admin-border bg-admin-card px-3 py-2 text-sm text-admin-text"
              value={eventSeverityFilter}
              onChange={(e) => setEventSeverityFilter(e.target.value)}
            >
              {EVENT_SEVERITY_OPTIONS.map((o) => (
                <option key={o.value || 'all'} value={o.value}>{o.label}</option>
              ))}
            </select>
            <input
              type="date"
              className="rounded-lg border border-admin-border px-3 py-2 text-sm text-admin-text"
              value={eventDateStart}
              onChange={(e) => setEventDateStart(e.target.value)}
              title="From date"
            />
            <input
              type="date"
              className="rounded-lg border border-admin-border px-3 py-2 text-sm text-admin-text"
              value={eventDateEnd}
              onChange={(e) => setEventDateEnd(e.target.value)}
              title="To date"
            />
          </div>
          <div className="overflow-x-auto rounded-xl border border-admin-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/[0.02]">
                <tr>
                  <th className="px-4 py-3 font-medium text-admin-muted">Event</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Service</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Severity</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-admin-muted">
                      {events.length === 0 ? 'No events.' : 'No events match selected filters.'}
                    </td>
                  </tr>
                ) : (
                  filteredEvents.map((ev, idx) => (
                    <tr key={idx} className="border-t border-admin-border">
                      <td className="px-4 py-3">{ev.event}</td>
                      <td className="px-4 py-3 text-admin-muted">{ev.service}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={ev.severity} variant="default" />
                      </td>
                      <td className="px-4 py-3 text-admin-muted text-xs">{ev.timestamp ? new Date(ev.timestamp).toLocaleString() : '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Card action modal */}
      {cardAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => !globalActionMutation.isPending && setCardAction(null)}>
          <div className="w-full max-w-md rounded-xl border border-admin-border bg-admin-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', cardAction.variant === 'danger' ? 'bg-red-500/10' : 'bg-emerald-500/10')}>
                {cardAction.variant === 'danger' ? <AlertTriangle className="h-5 w-5 text-red-400" /> : <CheckCircle className="h-5 w-5 text-emerald-400" />}
              </div>
              <div>
                <h3 className="text-lg font-semibold text-admin-text">{cardAction.title}</h3>
                <p className="mt-1 text-sm text-admin-muted">{cardAction.description}</p>
              </div>
            </div>
            {cardAction.needsReason && (
              <div className="mt-4">
                <label className="block text-sm font-medium text-admin-text">Reason <span className="text-red-400">*</span></label>
                <textarea
                  value={cardActionReason}
                  onChange={(e) => setCardActionReason(e.target.value)}
                  placeholder="Provide a reason for this action (min 8 characters)..."
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-admin-border bg-white/[0.02] px-3 py-2 text-sm text-admin-text placeholder:text-admin-muted/50 focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary"
                />
                <p className="mt-1 text-xs text-admin-muted">{cardActionReason.trim().length}/8 characters minimum</p>
              </div>
            )}
            {cardAction.variant === 'danger' && (
              <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2">
                <p className="text-xs text-amber-400">This is a destructive action. It will be logged in the audit trail and cannot be undone automatically.</p>
              </div>
            )}
            <div className="mt-6 flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => { setCardAction(null); setCardActionReason(''); }} disabled={globalActionMutation.isPending}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                variant={cardAction.variant === 'danger' ? 'danger' : 'primary'}
                onClick={() => {
                  const reason = cardActionReason.trim();
                  if (cardAction.needsReason && reason.length < 8) return;
                  globalActionMutation.mutate({ action: cardAction.action, reason: reason || undefined });
                }}
                disabled={globalActionMutation.isPending || (cardAction.needsReason && cardActionReason.trim().length < 8)}
              >
                {globalActionMutation.isPending ? 'Executing…' : 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {confirmCircuit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setConfirmCircuit(null)}>
          <div className="w-full max-w-sm rounded-xl bg-admin-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-admin-text">Confirm circuit action</h3>
            <p className="mt-2 text-sm text-admin-muted">Execute: {confirmCircuit.label}. This may affect trading.</p>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirmCircuit(null)}>Cancel</Button>
              <Button className="flex-1" onClick={() => circuitMutation.mutate(confirmCircuit.action)} disabled={circuitMutation.isPending}>Confirm</Button>
            </div>
          </div>
        </div>
      )}
      {createIncidentOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !createIncidentMutation.isPending && setCreateIncidentOpen(false)}>
          <div className="w-full max-w-md rounded-xl bg-admin-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-admin-text">Create incident</h3>
            <p className="mt-1 text-sm text-admin-muted">Manually create an incident. It will be logged in control events.</p>
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-admin-text">Incident type</label>
                <input
                  type="text"
                  placeholder="e.g. matching_engine_failure"
                  value={createIncidentForm.type}
                  onChange={(e) => setCreateIncidentForm((f) => ({ ...f, type: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm text-admin-text placeholder:text-admin-muted focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-admin-text">Severity</label>
                <select
                  value={createIncidentForm.severity}
                  onChange={(e) => setCreateIncidentForm((f) => ({ ...f, severity: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-admin-border bg-admin-card px-3 py-2 text-sm text-admin-text"
                >
                  <option value="info">info</option>
                  <option value="warning">warning</option>
                  <option value="critical">critical</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-admin-text">Description</label>
                <textarea
                  placeholder="e.g. Matching engine queue stuck"
                  value={createIncidentForm.description}
                  onChange={(e) => setCreateIncidentForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm text-admin-text placeholder:text-admin-muted focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary"
                />
              </div>
            </div>
            <div className="mt-6 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => !createIncidentMutation.isPending && setCreateIncidentOpen(false)} disabled={createIncidentMutation.isPending}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                variant="primary"
                onClick={() => {
                  const type = createIncidentForm.type.trim();
                  if (!type) return;
                  createIncidentMutation.mutate({
                    type,
                    severity: createIncidentForm.severity,
                    description: createIncidentForm.description.trim() || undefined,
                  });
                }}
                disabled={!createIncidentForm.type.trim() || createIncidentMutation.isPending}
              >
                {createIncidentMutation.isPending ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </div>
        </div>
      )}
      {confirmCommand && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setConfirmCommand(null)}>
          <div className="w-full max-w-sm rounded-xl bg-admin-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-admin-text">Confirm system command</h3>
            <p className="mt-2 text-sm text-admin-muted">Run: {confirmCommand.label}. This will trigger a restart.</p>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirmCommand(null)}>Cancel</Button>
              <Button className="flex-1" onClick={() => commandMutation.mutate(confirmCommand.command)} disabled={commandMutation.isPending}>Execute</Button>
            </div>
          </div>
        </div>
      )}
      {confirmLiquidityKill !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setConfirmLiquidityKill(null)}>
          <div className="w-full max-w-sm rounded-xl bg-admin-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-admin-text">Liquidity kill switch</h3>
            <p className="mt-2 text-sm text-admin-muted">
              {confirmLiquidityKill ? 'Activate kill switch? This disables liquidity bot and external providers.' : 'Deactivate kill switch?'}
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirmLiquidityKill(null)}>Cancel</Button>
              <Button className="flex-1" variant={confirmLiquidityKill ? 'danger' : 'primary'} onClick={() => liquidityKillMutation.mutate(confirmLiquidityKill)} disabled={liquidityKillMutation.isPending}>
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}
      {confirmEmergencyMode !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setConfirmEmergencyMode(null)}>
          <div className="w-full max-w-sm rounded-xl bg-admin-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-admin-text">Exchange emergency mode</h3>
            <p className="mt-2 text-sm text-admin-muted">
              {confirmEmergencyMode ? 'Enable emergency mode? This will pause trading, disable withdrawals and deposits, and enable safe mode.' : 'Disable emergency mode?'}
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirmEmergencyMode(null)}>Cancel</Button>
              <Button className="flex-1" variant={confirmEmergencyMode ? 'danger' : 'primary'} onClick={() => emergencyModeMutation.mutate(confirmEmergencyMode)} disabled={emergencyModeMutation.isPending}>
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmEmergencyLevel !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setConfirmEmergencyLevel(null)}>
          <div className="w-full max-w-sm rounded-xl bg-admin-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-admin-text">Confirm emergency level change</h3>
            <p className="mt-2 text-sm text-admin-muted">
              Confirm changing emergency level to Level {confirmEmergencyLevel}?
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirmEmergencyLevel(null)}>Cancel</Button>
              <Button className="flex-1" onClick={() => emergencyLevelMutation.mutate(confirmEmergencyLevel)} disabled={emergencyLevelMutation.isPending}>
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}

      {editTriggerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { if (!editTriggerSaveConfirm) { setEditTriggerModal(null); setEditTriggerSaveConfirm(false); } }}>
          <div className="w-full max-w-md rounded-xl bg-admin-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-admin-text">Edit trigger</h3>
            <p className="mt-1 text-sm text-amber-400">Incorrect trigger settings may pause trading automatically.</p>
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-admin-text">Trigger name</label>
                <input
                  type="text"
                  readOnly
                  value={editTriggerModal.trigger_type.replace(/_/g, ' ')}
                  className="mt-1 w-full rounded-lg border border-admin-border bg-white/[0.02] px-3 py-2 text-sm text-admin-muted"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-admin-text">Metric</label>
                <input
                  type="text"
                  readOnly
                  value={editTriggerModal.trigger_type}
                  className="mt-1 w-full rounded-lg border border-admin-border bg-white/[0.02] px-3 py-2 text-sm font-mono text-admin-muted"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-admin-text">Threshold value</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={editTriggerForm.threshold_value}
                  onChange={(e) => setEditTriggerForm((f) => ({ ...f, threshold_value: e.target.value }))}
                  placeholder="e.g. 5000"
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                />
                <p className="mt-0.5 text-xs text-admin-muted">When metric exceeds this value, the action runs (e.g. &gt; 5000).</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-admin-text">Action</label>
                <select
                  value={editTriggerForm.action}
                  onChange={(e) => setEditTriggerForm((f) => ({ ...f, action: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                >
                  {SAFETY_TRIGGER_ACTION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-6 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => { setEditTriggerModal(null); setEditTriggerSaveConfirm(false); }}>Cancel</Button>
              <Button
                className="flex-1"
                variant="primary"
                onClick={() => setEditTriggerSaveConfirm(true)}
                disabled={!editTriggerForm.threshold_value.trim() || !editTriggerForm.action || Number.isNaN(Number(editTriggerForm.threshold_value)) || Number(editTriggerForm.threshold_value) < 0}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {editTriggerSaveConfirm && editTriggerModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={() => setEditTriggerSaveConfirm(false)}>
          <div className="w-full max-w-sm rounded-xl bg-admin-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-admin-text">Confirm save</h3>
            <p className="mt-2 text-sm text-admin-muted">Save trigger settings? Incorrect trigger settings may pause trading automatically.</p>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setEditTriggerSaveConfirm(false)}>Cancel</Button>
              <Button
                className="flex-1"
                variant="primary"
                onClick={() => {
                  const threshold = Number(editTriggerForm.threshold_value);
                  if (Number.isNaN(threshold) || threshold < 0) return;
                  safetyTriggersMutation.mutate(
                    safetyTriggers.map((x) =>
                      x.id === editTriggerModal.id
                        ? { trigger_type: x.trigger_type, metric: x.metric ?? x.trigger_type, threshold_value: threshold, action: editTriggerForm.action, enabled: !!x.enabled }
                        : { trigger_type: x.trigger_type, metric: x.metric ?? x.trigger_type, threshold_value: Number(x.threshold_value), action: x.action, enabled: !!x.enabled }
                    ),
                    {
                      onSuccess: () => {
                        setEditTriggerModal(null);
                        setEditTriggerSaveConfirm(false);
                      },
                    }
                  );
                }}
                disabled={safetyTriggersMutation.isPending}
              >
                {safetyTriggersMutation.isPending ? 'Saving…' : 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {addTriggerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setAddTriggerModalOpen(false)}>
          <div className="w-full max-w-md rounded-xl bg-admin-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-admin-text">Create trigger</h3>
            <p className="mt-1 text-sm text-admin-muted">When the metric exceeds the threshold, the selected action runs. Max 20 triggers.</p>
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-admin-text">Trigger name</label>
                <input
                  type="text"
                  value={addTriggerForm.trigger_name}
                  onChange={(e) => setAddTriggerForm((f) => ({ ...f, trigger_name: e.target.value }))}
                  placeholder="e.g. withdrawal_queue_spike"
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-admin-text">Metric</label>
                <input
                  type="text"
                  value={addTriggerForm.metric}
                  onChange={(e) => setAddTriggerForm((f) => ({ ...f, metric: e.target.value }))}
                  placeholder="e.g. withdrawal_queue_size or rpc_failure_percentage"
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-admin-text">Threshold</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={addTriggerForm.threshold_value}
                  onChange={(e) => setAddTriggerForm((f) => ({ ...f, threshold_value: e.target.value }))}
                  placeholder="e.g. 200 or 20"
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                />
                <p className="mt-0.5 text-xs text-admin-muted">When metric exceeds this value (e.g. &gt; 200 or &gt; 20%).</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-admin-text">Action</label>
                <select
                  value={addTriggerForm.action}
                  onChange={(e) => setAddTriggerForm((f) => ({ ...f, action: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                >
                  {SAFETY_TRIGGER_ACTION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-admin-text">Enabled</label>
                <button
                  type="button"
                  role="switch"
                  aria-checked={addTriggerForm.enabled}
                  onClick={() => setAddTriggerForm((f) => ({ ...f, enabled: !f.enabled }))}
                  className={cn(
                    'relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-admin-primary focus:ring-offset-2',
                    addTriggerForm.enabled ? 'bg-admin-primary' : 'bg-white/5'
                  )}
                >
                  <span
                    className={cn(
                      'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-admin-card shadow ring-0 transition',
                      addTriggerForm.enabled ? 'translate-x-5' : 'translate-x-1'
                    )}
                  />
                </button>
                <span className="text-sm text-admin-muted">{addTriggerForm.enabled ? 'On' : 'Off'}</span>
              </div>
            </div>
            <div className="mt-6 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setAddTriggerModalOpen(false)}>Cancel</Button>
              <Button
                className="flex-1"
                variant="primary"
                onClick={() => {
                  const name = addTriggerForm.trigger_name.trim();
                  const threshold = Number(addTriggerForm.threshold_value);
                  if (!name || Number.isNaN(threshold) || threshold < 0 || !addTriggerForm.action) return;
                  const newTrigger = {
                    trigger_type: name,
                    metric: addTriggerForm.metric.trim() || name,
                    threshold_value: threshold,
                    action: addTriggerForm.action,
                    enabled: addTriggerForm.enabled,
                  };
                  const nextTriggers = [
                    ...safetyTriggers.map((t) => ({
                      trigger_type: t.trigger_type,
                      metric: t.metric ?? t.trigger_type,
                      threshold_value: Number(t.threshold_value),
                      action: t.action,
                      enabled: !!t.enabled,
                    })),
                    newTrigger,
                  ];
                  safetyTriggersMutation.mutate(nextTriggers, {
                    onSuccess: () => {
                      setAddTriggerModalOpen(false);
                      setAddTriggerForm({ trigger_name: '', metric: '', threshold_value: '', action: 'send_admin_alert', enabled: true });
                    },
                    onError: () => {},
                  });
                }}
                disabled={
                  !addTriggerForm.trigger_name.trim() ||
                  !addTriggerForm.action ||
                  Number.isNaN(Number(addTriggerForm.threshold_value)) ||
                  Number(addTriggerForm.threshold_value) < 0 ||
                  safetyTriggersMutation.isPending
                }
              >
                {safetyTriggersMutation.isPending ? 'Saving…' : 'Create'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {testTriggerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setTestTriggerModal(null)}>
          <div className="w-full max-w-md rounded-xl bg-admin-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-admin-text">Test trigger (simulation)</h3>
            <p className="mt-1 text-sm text-admin-muted">No real system actions are executed. This is a UI-only simulation.</p>
            <dl className="mt-4 space-y-3">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-admin-muted">Trigger</dt>
                <dd className="mt-0.5 font-medium">{testTriggerModal.trigger_type.replace(/_/g, ' ')}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-admin-muted">Threshold</dt>
                <dd className="mt-0.5 font-mono text-sm">&gt; {testTriggerModal.threshold_value}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-admin-muted">Current metric (simulated)</dt>
                <dd className="mt-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={testTriggerSimulatedMetric}
                    onChange={(e) => setTestTriggerSimulatedMetric(e.target.value)}
                    className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm font-mono"
                    placeholder="e.g. 5300"
                  />
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-admin-muted">Expected action</dt>
                <dd className="mt-0.5">{testTriggerModal.action.replace(/_/g, ' ')}</dd>
              </div>
              <div className="rounded-lg border border-admin-border bg-white/[0.02] p-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-admin-muted">Result</dt>
                <dd className="mt-1 font-medium">
                  {(() => {
                    const threshold = Number(testTriggerModal.threshold_value);
                    const current = Number(testTriggerSimulatedMetric);
                    if (testTriggerSimulatedMetric.trim() === '' || Number.isNaN(current)) {
                      return <span className="text-admin-muted">Enter a simulated metric value above.</span>;
                    }
                    const wouldActivate = current > threshold;
                    return wouldActivate ? (
                      <span className="text-amber-400">Trigger would activate.</span>
                    ) : (
                      <span className="text-admin-muted">Trigger would not activate.</span>
                    );
                  })()}
                </dd>
              </div>
            </dl>
            <div className="mt-6 flex justify-end">
              <Button variant="secondary" onClick={() => setTestTriggerModal(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </AdminPageFrame>
  );
}
