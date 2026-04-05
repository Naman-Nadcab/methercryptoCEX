'use client';

import { useCallback, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { X, AlertTriangle, AlertOctagon, Clock, Trash2, CheckCheck, BrainCircuit, Gauge } from 'lucide-react';
import { useAdminAlertStore } from '@/store/adminAlerts';
import { ADMIN_FEATURE_FLAGS } from '@/lib/admin/featureFlags';
import type { SystemAlert } from './alert-engine';

function timeAgo(ts: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function useTick(intervalMs: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

function AlertItem({ alert, onNavigate }: { alert: SystemAlert; onNavigate: (path: string) => void }) {
  const dismiss = useAdminAlertStore((s) => s.dismissAlert);
  const isCritical = alert.severity === 'critical';
  const isPredictive = alert.severity === 'predictive';

  const iconEl = isPredictive
    ? <BrainCircuit className="w-4 h-4 mt-0.5 text-violet-400 shrink-0" />
    : isCritical
      ? <AlertOctagon className="w-4 h-4 mt-0.5 text-red-400 shrink-0" />
      : <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-400 shrink-0" />;

  const labelColor = isPredictive ? 'text-violet-400' : isCritical ? 'text-red-400' : 'text-amber-400';
  const bgClass = isPredictive ? 'bg-violet-500/[0.04]' : isCritical ? 'bg-red-500/[0.04]' : '';

  return (
    <div
      className={`group relative flex items-start gap-3 px-4 py-3 border-b border-[#1F2937]/60 last:border-0 transition-colors cursor-pointer hover:bg-white/[0.03] ${bgClass}`}
      onClick={() => alert.navTarget && onNavigate(alert.navTarget)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && alert.navTarget && onNavigate(alert.navTarget)}
    >
      {iconEl}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${labelColor}`}>
            {isPredictive ? 'Prediction' : alert.severity}
          </span>
          <span className="text-[10px] text-zinc-600">•</span>
          <span className="text-[10px] text-zinc-500">{alert.source}</span>
          {alert.prediction && (
            <>
              <span className="text-[10px] text-zinc-600">•</span>
              <span className="text-[10px] text-violet-400/70">~{alert.prediction.timeHorizon}</span>
            </>
          )}
        </div>
        <p className="text-xs text-[#E5E7EB] leading-relaxed">{alert.message}</p>
        {alert.prediction && (
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1 max-w-[120px] h-1 rounded-full bg-zinc-800 overflow-hidden">
              <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${Math.round(alert.prediction.confidence * 100)}%` }} />
            </div>
            <span className="text-[10px] tabular-nums text-zinc-600">{Math.round(alert.prediction.confidence * 100)}% confidence</span>
          </div>
        )}
        <div className="flex items-center gap-1 mt-1 text-[10px] text-zinc-600">
          <Clock className="w-2.5 h-2.5" />
          {timeAgo(alert.timestamp)}
        </div>
      </div>
      {!isPredictive && (
        <button
          onClick={(e) => { e.stopPropagation(); dismiss(alert.id); }}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/10 transition-opacity"
          aria-label="Dismiss"
        >
          <X className="w-3 h-3 text-zinc-500" />
        </button>
      )}
    </div>
  );
}

export function AlertDrawer() {
  const { alerts, predictiveAlerts, drawerOpen, setDrawerOpen, markAllRead, clearAlerts, unreadCount } = useAdminAlertStore();
  const router = useRouter();

  useTick(10_000);

  const handleNavigate = useCallback((path: string) => {
    setDrawerOpen(false);
    router.push(path);
  }, [setDrawerOpen, router]);

  const criticalCount = alerts.filter((a) => a.severity === 'critical').length;
  const warningCount = alerts.filter((a) => a.severity === 'warning').length;
  const showPredictive = ADMIN_FEATURE_FLAGS.ADMIN_AI_OPS && predictiveAlerts.length > 0;

  return (
    <>
      {/* Backdrop */}
      {drawerOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-[60] backdrop-blur-[2px]"
          onClick={() => setDrawerOpen(false)}
          aria-hidden
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 z-[61] h-full w-[380px] max-w-[90vw] bg-[#0F1117] border-l border-[#1F2937] shadow-2xl transform transition-transform duration-300 ease-out ${
          drawerOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1F2937]">
          <div>
            <h2 className="text-sm font-semibold text-[#E5E7EB]">System Alerts</h2>
            <div className="flex items-center gap-3 mt-1">
              {criticalCount > 0 && (
                <span className="text-[10px] font-medium text-red-400">{criticalCount} critical</span>
              )}
              {warningCount > 0 && (
                <span className="text-[10px] font-medium text-amber-400">{warningCount} warning</span>
              )}
              {showPredictive && (
                <span className="text-[10px] font-medium text-violet-400">{predictiveAlerts.length} predicted</span>
              )}
              {alerts.length === 0 && !showPredictive && (
                <span className="text-[10px] text-zinc-500">No alerts</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <button onClick={markAllRead}
                className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors"
                title="Mark all read">
                <CheckCheck className="w-4 h-4" />
              </button>
            )}
            {alerts.length > 0 && (
              <button onClick={clearAlerts}
                className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors"
                title="Clear all">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button onClick={() => setDrawerOpen(false)}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Alert list */}
        <div className="overflow-y-auto h-[calc(100vh-64px)]">
          {/* Predictive Alerts Section */}
          {showPredictive && (
            <div>
              <div className="flex items-center gap-2 px-4 py-2.5 bg-violet-500/[0.06] border-b border-violet-500/10">
                <BrainCircuit className="w-3.5 h-3.5 text-violet-400" />
                <span className="text-[11px] font-semibold text-violet-400 uppercase tracking-wider">Predictive Alerts</span>
                <span className="ml-auto flex items-center gap-1 text-[10px] text-violet-400/60">
                  <Gauge className="w-2.5 h-2.5" />
                  AI trend analysis
                </span>
              </div>
              {predictiveAlerts.slice(0, 5).map((alert) => (
                <AlertItem key={alert.id} alert={alert} onNavigate={handleNavigate} />
              ))}
            </div>
          )}

          {/* Real Alerts */}
          {showPredictive && alerts.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-[#0F1117] border-b border-[#1F2937]">
              <AlertOctagon className="w-3.5 h-3.5 text-red-400" />
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Active Alerts</span>
            </div>
          )}
          {alerts.length === 0 && !showPredictive ? (
            <div className="flex flex-col items-center justify-center h-64 text-zinc-600">
              <AlertTriangle className="w-8 h-8 mb-3 text-zinc-700" />
              <p className="text-sm">All clear — no active alerts</p>
            </div>
          ) : (
            alerts.map((alert) => (
              <AlertItem key={alert.id} alert={alert} onNavigate={handleNavigate} />
            ))
          )}
        </div>
      </div>
    </>
  );
}
