import { create } from 'zustand';
import type { SystemAlert } from '@/components/admin-v2/alert-engine';

const MAX_ALERTS = 200;
const DEDUP_WINDOW_MS = 10_000;

interface AdminAlertState {
  alerts: SystemAlert[];
  predictiveAlerts: SystemAlert[];
  unreadCount: number;
  drawerOpen: boolean;

  addAlert: (alert: SystemAlert) => void;
  addAlerts: (incoming: SystemAlert[]) => void;
  addPredictiveAlerts: (incoming: SystemAlert[]) => void;
  clearPredictiveAlerts: () => void;
  markAllRead: () => void;
  clearAlerts: () => void;
  dismissAlert: (id: string) => void;
  toggleDrawer: () => void;
  setDrawerOpen: (open: boolean) => void;
}

export const useAdminAlertStore = create<AdminAlertState>((set, get) => ({
  alerts: [],
  predictiveAlerts: [],
  unreadCount: 0,
  drawerOpen: false,

  addAlert: (alert) => {
    get().addAlerts([alert]);
  },

  addAlerts: (incoming) => {
    const state = get();
    const existingSources = new Map<string, number>();
    for (const a of state.alerts) {
      existingSources.set(a.source + ':' + a.severity, a.timestamp);
    }

    const newAlerts: SystemAlert[] = [];
    for (const alert of incoming) {
      const key = alert.source + ':' + alert.severity;
      const lastTs = existingSources.get(key) ?? 0;
      if (alert.timestamp - lastTs > DEDUP_WINDOW_MS) {
        newAlerts.push(alert);
        existingSources.set(key, alert.timestamp);
      }
    }

    if (newAlerts.length === 0) return;

    set((s) => ({
      alerts: [...newAlerts, ...s.alerts].slice(0, MAX_ALERTS),
      unreadCount: s.unreadCount + newAlerts.length,
    }));
  },

  addPredictiveAlerts: (incoming) => {
    if (incoming.length === 0) return;
    set((s) => ({
      predictiveAlerts: [...incoming, ...s.predictiveAlerts].slice(0, MAX_ALERTS),
    }));
  },

  clearPredictiveAlerts: () => set({ predictiveAlerts: [] }),

  markAllRead: () => set({ unreadCount: 0 }),

  clearAlerts: () => set({ alerts: [], unreadCount: 0, predictiveAlerts: [] }),

  dismissAlert: (id) =>
    set((s) => ({
      alerts: s.alerts.filter((a) => a.id !== id),
      unreadCount: Math.max(0, s.unreadCount - 1),
    })),

  toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),

  setDrawerOpen: (open) => set({ drawerOpen: open }),
}));
