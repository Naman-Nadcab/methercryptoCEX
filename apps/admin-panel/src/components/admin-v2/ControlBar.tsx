'use client';

import { useState, useCallback } from 'react';
import {
  Search, PauseCircle, ShieldAlert, Lock, Bell,
  Loader2, CheckCircle2, XCircle, AlertTriangle, Radio,
} from 'lucide-react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { useAdminAlertStore } from '@/store/adminAlerts';
import { useAdminAuditLog } from '@/store/adminAuditLog';
import { adminFetch } from '@/lib/admin/apiClient';
import { ADMIN_FEATURE_FLAGS } from '@/lib/admin/featureFlags';
import { ConfirmModal } from './ConfirmModal';

type ServiceStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

interface ControlBarProps {
  systemStatus?: {
    engine: ServiceStatus;
    trading: ServiceStatus;
    settlement: ServiceStatus;
  };
  alertCount?: number;
  onSearch?: (query: string) => void;
}

const STATUS_DISPLAY: Record<ServiceStatus, { icon: typeof CheckCircle2; class: string; pulse: boolean }> = {
  healthy: { icon: CheckCircle2, class: 'text-emerald-400', pulse: false },
  degraded: { icon: AlertTriangle, class: 'text-amber-400', pulse: true },
  down: { icon: XCircle, class: 'text-red-400', pulse: true },
  unknown: { icon: Radio, class: 'text-zinc-500', pulse: false },
};

type ModalAction = 'pause' | 'emergency' | 'freeze' | null;

const MODAL_CONFIG: Record<Exclude<ModalAction, null>, {
  title: string; description: string; confirmWord: string;
  variant: 'warning' | 'critical'; endpoint: string; body: Record<string, unknown>;
}> = {
  pause: {
    title: 'Pause Trading',
    description: 'This will immediately halt all spot trading across the exchange. Open orders will remain but no new matches will occur. This action can be reversed.',
    confirmWord: 'PAUSE',
    variant: 'warning',
    endpoint: '/control/trading-halt',
    body: { halt: true },
  },
  emergency: {
    title: 'Enable Emergency Mode',
    description: 'CRITICAL: This will halt trading, freeze all withdrawals, and pause settlements. This is a last-resort action for security incidents. Recovery requires manual intervention.',
    confirmWord: 'EMERGENCY',
    variant: 'critical',
    endpoint: '/control/emergency',
    body: { enable: true },
  },
  freeze: {
    title: 'Freeze Withdrawals',
    description: 'All pending and new withdrawal requests will be blocked. Users will not be able to withdraw funds until this is reversed.',
    confirmWord: 'FREEZE',
    variant: 'warning',
    endpoint: '/control/withdrawal-freeze',
    body: { freeze: true },
  },
};

const ACTION_TYPE_MAP: Record<Exclude<ModalAction, null>, 'pause_trading' | 'emergency_mode' | 'freeze_withdrawals'> = {
  pause: 'pause_trading',
  emergency: 'emergency_mode',
  freeze: 'freeze_withdrawals',
};

export function ControlBar({ systemStatus, alertCount: propAlertCount, onSearch }: ControlBarProps) {
  const token = useAdminAuthStore((s) => s.accessToken);
  const { unreadCount, toggleDrawer } = useAdminAlertStore();
  const logAudit = useAdminAuditLog((s) => s.logAction);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeModal, setActiveModal] = useState<ModalAction>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const displayAlertCount = propAlertCount ?? unreadCount;

  const engine = systemStatus?.engine ?? 'unknown';
  const trading = systemStatus?.trading ?? 'unknown';
  const settlement = systemStatus?.settlement ?? 'unknown';

  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    onSearch?.(e.target.value);
  }, [onSearch]);

  const handleConfirmAction = useCallback(async () => {
    if (!activeModal) return;
    const cfg = MODAL_CONFIG[activeModal];
    setActionLoading(true);
    try {
      await adminFetch(cfg.endpoint, { method: 'POST', token, body: cfg.body });
      if (ADMIN_FEATURE_FLAGS.ADMIN_PRODUCTION_HARDENING) {
        logAudit(ACTION_TYPE_MAP[activeModal], { endpoint: cfg.endpoint, title: cfg.title });
      }
    } finally {
      setActionLoading(false);
    }
  }, [activeModal, token, logAudit]);

  const services = [
    { key: 'Engine', status: engine },
    { key: 'Trading', status: trading },
    { key: 'Settlement', status: settlement },
  ] as const;

  return (
    <>
      <div className="rounded-xl border border-[#1F2937] bg-[#151922] px-4 py-3">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="text" value={searchQuery} onChange={handleSearch}
              placeholder="Search users, orders, wallets…"
              className="w-full bg-[#0F1117] border border-[#1F2937] rounded-lg pl-9 pr-3 py-2 text-sm text-[#E5E7EB] placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/50 transition-colors"
            />
          </div>

          {/* Status indicators */}
          <div className="flex items-center gap-4">
            {services.map(({ key, status }) => {
              const cfg = STATUS_DISPLAY[status];
              const Icon = cfg.icon;
              return (
                <div key={key} className="flex items-center gap-1.5">
                  <Icon className={`w-3.5 h-3.5 ${cfg.class} ${cfg.pulse ? 'animate-pulse' : ''}`} />
                  <span className="text-xs text-zinc-400">{key}</span>
                </div>
              );
            })}
          </div>

          <div className="hidden md:block w-px h-6 bg-[#1F2937]" />

          {/* Danger action buttons */}
          <div className="flex items-center gap-2">
            <DangerButton icon={PauseCircle} label="Pause Trading" onClick={() => setActiveModal('pause')} variant="warning" />
            <DangerButton icon={ShieldAlert} label="Emergency" onClick={() => setActiveModal('emergency')} variant="critical" />
            <DangerButton icon={Lock} label="Freeze Withdrawals" onClick={() => setActiveModal('freeze')} variant="warning" />
          </div>

          <div className="hidden md:block w-px h-6 bg-[#1F2937]" />

          {/* Alert bell → opens drawer */}
          <button onClick={toggleDrawer}
            className="relative p-2 rounded-lg hover:bg-white/5 transition-colors"
            aria-label="System alerts">
            <Bell className={`w-5 h-5 ${displayAlertCount > 0 ? 'text-amber-400' : 'text-zinc-400'}`} />
            {displayAlertCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1 animate-pulse">
                {displayAlertCount > 99 ? '99+' : displayAlertCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Confirmation modals */}
      {activeModal && (
        <ConfirmModal
          open={!!activeModal}
          onClose={() => setActiveModal(null)}
          onConfirm={handleConfirmAction}
          title={MODAL_CONFIG[activeModal].title}
          description={MODAL_CONFIG[activeModal].description}
          confirmWord={MODAL_CONFIG[activeModal].confirmWord}
          variant={MODAL_CONFIG[activeModal].variant}
        />
      )}
    </>
  );
}

function DangerButton({ icon: Icon, label, onClick, variant }: {
  icon: typeof PauseCircle; label: string; onClick: () => void;
  variant: 'warning' | 'critical';
}) {
  const styles = variant === 'critical'
    ? 'border-red-500/30 text-red-400 hover:bg-red-500/15 hover:border-red-500/50 hover:shadow-[0_0_12px_-3px_rgba(239,68,68,0.3)]'
    : 'border-amber-500/30 text-amber-400 hover:bg-amber-500/15 hover:border-amber-500/50 hover:shadow-[0_0_12px_-3px_rgba(245,158,11,0.3)]';

  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-all duration-200 ${styles}`}>
      <Icon className="w-3.5 h-3.5" />
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}
