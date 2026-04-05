'use client';

import { useState, useEffect, useCallback, memo, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  PanelRightClose, PanelRightOpen,
  AlertTriangle, Siren, BrainCircuit, Clock,
  Activity, ArrowDownToLine, ArrowUpFromLine,
  Repeat2, UserPlus, ShieldCheck, Ban,
  Wifi, WifiOff,
} from 'lucide-react';
import { useAdminAuthStore } from '@/store/auth';
import { useAdminAlertStore } from '@/store/adminAlerts';
import { useAdminIncidentStore } from '@/store/adminIncidents';
import { useRealtimeStore, type RealtimeActivity } from '@/store/realtime';
import { getAuditActivityLogs, type AuditActivityLog } from '@/lib/api';
import { ADMIN_FEATURE_FLAGS } from '@/lib/admin/featureFlags';
import { cn } from '@/lib/cn';

function timeAgo(ts: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

type Tab = 'alerts' | 'activity' | 'incidents' | 'insights';

function RightPanelInner() {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('alerts');

  const alerts = useAdminAlertStore((s) => s.alerts);
  const predictiveAlerts = useAdminAlertStore((s) => s.predictiveAlerts);
  const incidents = useAdminIncidentStore((s) => s.incidents);
  const activeIncident = useAdminIncidentStore((s) => s.activeIncident);

  const recentAlerts = useMemo(() => alerts.slice(0, 15), [alerts]);
  const recentPredictions = useMemo(() => predictiveAlerts.slice(0, 10), [predictiveAlerts]);
  const activeIncidents = useMemo(() => incidents.filter((i) => i.status !== 'resolved').slice(0, 10), [incidents]);

  const alertCount = recentAlerts.length;
  const incidentCount = activeIncidents.length;
  const predictionCount = recentPredictions.length;

  const TABS: { id: Tab; label: string; count: number; icon: React.ElementType; flag?: boolean }[] = [
    { id: 'alerts', label: 'Alerts', count: alertCount, icon: AlertTriangle },
    { id: 'activity', label: 'Activity', count: 0, icon: Activity },
    { id: 'incidents', label: 'Incidents', count: incidentCount, icon: Siren, flag: ADMIN_FEATURE_FLAGS.ADMIN_INCIDENT_SYSTEM },
    { id: 'insights', label: 'AI', count: predictionCount, icon: BrainCircuit, flag: ADMIN_FEATURE_FLAGS.ADMIN_AI_OPS },
  ];

  const visibleTabs = TABS.filter((t) => t.flag !== false);

  if (!open) {
    const totalBadge = alertCount + incidentCount;
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed right-0 top-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-2 rounded-l-lg border border-r-0 border-admin-border bg-admin-card px-1.5 py-3 shadow-md hover:bg-white/5 transition-colors"
        aria-label="Open panel"
      >
        <PanelRightOpen className="h-4 w-4 text-admin-muted" />
        {totalBadge > 0 && (
          <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white px-1">
            {totalBadge > 99 ? '99+' : totalBadge}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="fixed right-0 top-14 z-30 h-[calc(100vh-3.5rem)] w-80 border-l border-admin-border bg-admin-card shadow-lg flex flex-col animate-slide-in-right">
      {/* Header — tabs */}
      <div className="flex items-center justify-between border-b border-admin-border px-2 py-2 shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap',
                activeTab === tab.id
                  ? 'bg-admin-primary/10 text-admin-primary'
                  : 'text-admin-muted hover:text-admin-text'
              )}
            >
              <tab.icon className="h-3 w-3" />
              {tab.label}
              {tab.count > 0 && (
                <span className="ml-0.5 rounded-full bg-red-100 text-red-600 text-[9px] font-bold px-1">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={() => setOpen(false)}
          className="rounded-md p-1 text-admin-muted hover:bg-white/5 transition-colors shrink-0 ml-1"
          aria-label="Close panel"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'alerts' && <AlertsList alerts={recentAlerts} />}
        {activeTab === 'activity' && <ActivityStream />}
        {activeTab === 'incidents' && <IncidentsList incidents={activeIncidents} activeIncident={activeIncident} />}
        {activeTab === 'insights' && <InsightsList predictions={recentPredictions} />}
      </div>
    </div>
  );
}

export const RightPanel = memo(RightPanelInner);

/* ------------------------------------------------------------------ */
/*  Activity Stream — real-time from WS with polling fallback          */
/* ------------------------------------------------------------------ */

interface ActivityEvent {
  id: string;
  type: 'trade' | 'deposit' | 'withdrawal' | 'signup' | 'kyc' | 'alert' | 'ban' | 'admin';
  message: string;
  timestamp: number;
}

const EVENT_ICONS: Record<ActivityEvent['type'], { icon: React.ElementType; color: string }> = {
  trade:      { icon: Repeat2, color: 'text-blue-500' },
  deposit:    { icon: ArrowDownToLine, color: 'text-admin-success' },
  withdrawal: { icon: ArrowUpFromLine, color: 'text-admin-warning' },
  signup:     { icon: UserPlus, color: 'text-violet-500' },
  kyc:        { icon: ShieldCheck, color: 'text-cyan-500' },
  alert:      { icon: AlertTriangle, color: 'text-admin-danger' },
  ban:        { icon: Ban, color: 'text-admin-danger' },
  admin:      { icon: Activity, color: 'text-admin-primary' },
};

function classifyAction(action: string): ActivityEvent['type'] {
  const a = action.toLowerCase();
  if (a.includes('trade') || a.includes('order') || a.includes('match')) return 'trade';
  if (a.includes('deposit') || a.includes('credit')) return 'deposit';
  if (a.includes('withdraw') || a.includes('freeze')) return 'withdrawal';
  if (a.includes('kyc') || a.includes('verification')) return 'kyc';
  if (a.includes('alert') || a.includes('aml') || a.includes('risk')) return 'alert';
  if (a.includes('ban') || a.includes('block') || a.includes('suspend')) return 'ban';
  if (a.includes('signup') || a.includes('register')) return 'signup';
  return 'admin';
}

function realtimeToActivity(rt: RealtimeActivity): ActivityEvent {
  return { id: rt.id, type: classifyAction(rt.type), message: rt.message, timestamp: rt.timestamp };
}

function mapLogsToEvents(logs: AuditActivityLog[]): ActivityEvent[] {
  return logs.map((log) => ({
    id: log.id,
    type: classifyAction(log.action),
    message: `${log.adminName}: ${log.action.replace(/_/g, ' ')}`,
    timestamp: new Date(log.createdAt).getTime(),
  }));
}

function ActivityStream() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const connectionState = useRealtimeStore((s) => s.connectionState);
  const shouldPoll = useRealtimeStore((s) => s.shouldPoll);
  const liveEvents = useRealtimeStore((s) => s.liveEvents);

  const isWsConnected = connectionState === 'connected';

  // Polling fallback: only enabled when WS is down
  const { data: pollData } = useQuery({
    queryKey: ['admin', 'activity-stream', token],
    queryFn: () => getAuditActivityLogs(token, { limit: 30 }),
    enabled: !!token && (shouldPoll || !isWsConnected),
    staleTime: 10000,
    refetchInterval: shouldPoll ? 15000 : false,
  });

  const events = useMemo<ActivityEvent[]>(() => {
    if (isWsConnected && liveEvents.length > 0) {
      return liveEvents.slice(0, 30).map(realtimeToActivity);
    }
    // Fallback to polled data
    const logs = pollData?.data?.logs ?? [];
    if (logs.length > 0) return mapLogsToEvents(logs);
    // Show any live events even if WS reconnecting
    if (liveEvents.length > 0) return liveEvents.slice(0, 30).map(realtimeToActivity);
    return [];
  }, [isWsConnected, liveEvents, pollData]);

  if (events.length === 0) {
    return <EmptyState icon={Activity} text="No recent activity" />;
  }

  return (
    <div>
      {/* Connection status bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-admin-border/50 bg-white/[0.02]">
        <span className="text-[10px] text-admin-muted font-medium">Activity feed</span>
        <span className={cn(
          'text-[10px] font-medium flex items-center gap-1',
          isWsConnected ? 'text-admin-success' : connectionState === 'reconnecting' ? 'text-admin-warning' : 'text-admin-muted'
        )}>
          {isWsConnected ? <Wifi className="h-2.5 w-2.5" /> : <WifiOff className="h-2.5 w-2.5" />}
          {isWsConnected ? 'Live' : connectionState === 'reconnecting' ? 'Reconnecting…' : shouldPoll ? 'Polling' : 'Connecting…'}
        </span>
      </div>

      <div className="divide-y divide-admin-border/50">
        {events.map((evt) => {
          const cfg = EVENT_ICONS[evt.type] ?? EVENT_ICONS.admin;
          const Icon = cfg.icon;
          return (
            <div key={evt.id} className="px-3 py-2 hover:bg-white/[0.03] transition-colors">
              <div className="flex items-start gap-2">
                <Icon className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', cfg.color)} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-admin-text leading-snug">{evt.message}</p>
                  <span className="text-[10px] text-admin-muted flex items-center gap-0.5 mt-0.5">
                    <Clock className="h-2.5 w-2.5" />
                    {timeAgo(evt.timestamp)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Existing sub-views (kept intact)                                   */
/* ------------------------------------------------------------------ */

function AlertsList({ alerts }: { alerts: ReturnType<typeof useAdminAlertStore.getState>['alerts'] }) {
  if (alerts.length === 0) {
    return <EmptyState icon={AlertTriangle} text="No active alerts" />;
  }
  return (
    <div className="divide-y divide-admin-border">
      {alerts.map((a) => (
        <div key={a.id} className="px-3 py-2.5 hover:bg-white/[0.03] transition-colors">
          <div className="flex items-start gap-2">
            <span className={cn(
              'mt-0.5 h-2 w-2 rounded-full shrink-0',
              a.severity === 'critical' ? 'bg-red-500' : a.severity === 'warning' ? 'bg-amber-500' : 'bg-violet-500'
            )} />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-admin-text leading-snug">{a.message}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className={cn(
                  'text-[9px] uppercase font-bold tracking-wider',
                  a.severity === 'critical' ? 'text-red-500' : a.severity === 'warning' ? 'text-amber-500' : 'text-violet-500'
                )}>
                  {a.severity}
                </span>
                <span className="text-[10px] text-admin-muted flex items-center gap-0.5">
                  <Clock className="h-2.5 w-2.5" />
                  {timeAgo(a.timestamp)}
                </span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function IncidentsList({
  incidents,
  activeIncident,
}: {
  incidents: ReturnType<typeof useAdminIncidentStore.getState>['incidents'];
  activeIncident: ReturnType<typeof useAdminIncidentStore.getState>['activeIncident'];
}) {
  const allItems = activeIncident
    ? [activeIncident, ...incidents.filter((i) => i.id !== activeIncident.id)]
    : incidents;

  if (allItems.length === 0) {
    return <EmptyState icon={Siren} text="No active incidents" />;
  }

  return (
    <div className="divide-y divide-admin-border">
      {allItems.map((inc) => {
        const isActive = inc.id === activeIncident?.id;
        return (
          <div key={inc.id} className={cn(
            'px-3 py-2.5 transition-colors',
            isActive ? 'bg-red-50/50' : 'hover:bg-white/[0.03]'
          )}>
            <div className="flex items-center gap-2 mb-1">
              {isActive && <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />}
              <p className="text-xs font-medium text-admin-text truncate">{inc.title}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn(
                'text-[9px] uppercase font-bold tracking-wider rounded px-1 py-0.5',
                inc.status === 'active' ? 'bg-red-100 text-red-600' :
                inc.status === 'investigating' ? 'bg-amber-100 text-amber-700' :
                inc.status === 'acknowledged' ? 'bg-blue-100 text-blue-600' :
                'bg-green-100 text-green-600'
              )}>
                {inc.status}
              </span>
              <span className="text-[10px] text-admin-muted">{timeAgo(inc.startedAt)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InsightsList({ predictions }: { predictions: ReturnType<typeof useAdminAlertStore.getState>['predictiveAlerts'] }) {
  if (predictions.length === 0) {
    return <EmptyState icon={BrainCircuit} text="No predictive insights" />;
  }
  return (
    <div className="divide-y divide-admin-border">
      {predictions.map((p) => (
        <div key={p.id} className="px-3 py-2.5 hover:bg-violet-50/30 transition-colors">
          <div className="flex items-start gap-2">
            <BrainCircuit className="h-3.5 w-3.5 mt-0.5 text-violet-500 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-admin-text leading-snug">{p.message}</p>
              <span className="text-[10px] text-violet-500 font-medium mt-1 inline-block">Prediction</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-admin-muted">
      <Icon className="h-8 w-8 mb-2 opacity-30" />
      <p className="text-xs">{text}</p>
    </div>
  );
}
