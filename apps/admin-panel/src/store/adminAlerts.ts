import { create } from 'zustand';
import type { SystemAlert } from '@/components/admin-v2/alert-engine';

const MAX_ALERTS = 100;
const DEDUP_WINDOW_MS = 30_000;

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
    if (!incoming || incoming.length === 0) return;

    const state = get();
    const now = Date.now();
    const newAlerts: SystemAlert[] = [];

    for (const alert of incoming) {
      const existing = state.alerts.find((a) => a.id === alert.id);
      if (existing) {
        if (now - existing.timestamp < DEDUP_WINDOW_MS) continue;
        if (existing.severity === alert.severity && existing.message === alert.message) continue;
      }
      newAlerts.push(alert);
    }

    if (newAlerts.length === 0) return;

    set((s) => {
      const merged = [...s.alerts];
      for (const alert of newAlerts) {
        const idx = merged.findIndex((a) => a.id === alert.id);
        if (idx >= 0) {
          merged[idx] = alert;
        } else {
          merged.unshift(alert);
        }
      }
      const actuallyNew = newAlerts.filter((a) => !s.alerts.some((e) => e.id === a.id)).length;
      return {
        alerts: merged.slice(0, MAX_ALERTS),
        unreadCount: s.unreadCount + actuallyNew,
      };
    });
  },

  addPredictiveAlerts: (incoming) => {
    if (!incoming || incoming.length === 0) return;

    set((s) => {
      const merged = [...s.predictiveAlerts];
      for (const alert of incoming) {
        const idx = merged.findIndex((a) => a.id === alert.id);
        if (idx >= 0) {
          merged[idx] = alert;
        } else {
          merged.unshift(alert);
        }
      }
      return { predictiveAlerts: merged.slice(0, MAX_ALERTS) };
    });
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
