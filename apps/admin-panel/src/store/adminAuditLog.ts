/**
 * Admin Audit Log — Production Hardening Layer
 *
 * Tracks all admin actions for regulatory compliance and debugging.
 * 100% frontend-only. Stores in Zustand with session persistence.
 *
 * SAFETY: Read-only audit trail — never modifies backend state.
 */

import { create } from 'zustand';

export type AuditActionType =
  | 'pause_trading'
  | 'emergency_mode'
  | 'freeze_withdrawals'
  | 'incident_created'
  | 'incident_acknowledged'
  | 'incident_investigating'
  | 'incident_resolved'
  | 'incident_note_added'
  | 'alert_dismissed'
  | 'alert_drawer_opened'
  | 'alerts_cleared'
  | 'alerts_marked_read'
  | 'page_visited'
  | 'search_performed'
  | 'report_exported'
  | 'session_started';

export interface AuditEntry {
  id: string;
  action: AuditActionType;
  actor: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

const MAX_ENTRIES = 500;
const SESSION_ID = `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

interface AdminAuditLogState {
  entries: AuditEntry[];
  sessionId: string;
  sessionStartedAt: number;
  pagesVisited: string[];

  logAction: (action: AuditActionType, metadata?: Record<string, unknown>, actor?: string) => void;
  getRecentActions: (limit?: number) => AuditEntry[];
  getSessionActions: () => AuditEntry[];
  getActionsByType: (type: AuditActionType) => AuditEntry[];
  trackPageVisit: (path: string) => void;
  clearLog: () => void;
}

export const useAdminAuditLog = create<AdminAuditLogState>((set, get) => ({
  entries: [],
  sessionId: SESSION_ID,
  sessionStartedAt: Date.now(),
  pagesVisited: [],

  logAction: (action, metadata, actor = 'Admin') => {
    const entry: AuditEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      action,
      actor,
      timestamp: Date.now(),
      metadata,
    };
    set((s) => ({
      entries: [entry, ...s.entries].slice(0, MAX_ENTRIES),
    }));
  },

  getRecentActions: (limit = 50) => {
    return get().entries.slice(0, limit);
  },

  getSessionActions: () => {
    const { entries, sessionStartedAt } = get();
    return entries.filter((e) => e.timestamp >= sessionStartedAt);
  },

  getActionsByType: (type) => {
    return get().entries.filter((e) => e.action === type);
  },

  trackPageVisit: (path) => {
    const state = get();
    const alreadyLatest = state.pagesVisited[0] === path;
    if (alreadyLatest) return;

    set((s) => ({
      pagesVisited: [path, ...s.pagesVisited].slice(0, 100),
    }));

    state.logAction('page_visited', { path });
  },

  clearLog: () => set({ entries: [] }),
}));
