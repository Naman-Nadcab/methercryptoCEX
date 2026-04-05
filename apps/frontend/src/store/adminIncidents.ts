import { create } from 'zustand';

export type IncidentSeverity = 'critical' | 'warning';
export type IncidentStatus = 'active' | 'acknowledged' | 'investigating' | 'resolved';

export interface IncidentNote {
  id: string;
  text: string;
  author: string;
  timestamp: number;
}

export interface Incident {
  id: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  startedAt: number;
  acknowledgedBy?: string;
  acknowledgedAt?: number;
  resolvedAt?: number;
  notes: IncidentNote[];
  triggeringAlertIds: string[];
}

interface AdminIncidentState {
  incidents: Incident[];
  activeIncident: Incident | null;

  createIncident: (params: {
    title: string;
    severity: IncidentSeverity;
    triggeringAlertIds?: string[];
  }) => Incident;
  acknowledgeIncident: (id: string, adminName: string) => void;
  markInvestigating: (id: string) => void;
  resolveIncident: (id: string) => void;
  setActiveIncident: (id: string | null) => void;
  addNote: (id: string, text: string, author?: string) => void;
}

function updateIncident(
  state: AdminIncidentState,
  id: string,
  updater: (inc: Incident) => Incident,
): Pick<AdminIncidentState, 'incidents' | 'activeIncident'> {
  const incidents = state.incidents.map((inc) => (inc.id === id ? updater(inc) : inc));
  const target = incidents.find((i) => i.id === id);
  return {
    incidents,
    activeIncident: state.activeIncident?.id === id && target ? target : state.activeIncident,
  };
}

export const useAdminIncidentStore = create<AdminIncidentState>((set, get) => ({
  incidents: [],
  activeIncident: null,

  createIncident: ({ title, severity, triggeringAlertIds }) => {
    const incident: Incident = {
      id: `inc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title,
      severity,
      status: 'active',
      startedAt: Date.now(),
      notes: [],
      triggeringAlertIds: triggeringAlertIds ?? [],
    };

    set((s) => ({
      incidents: [incident, ...s.incidents],
      activeIncident: incident,
    }));

    return incident;
  },

  acknowledgeIncident: (id, adminName) => {
    set((s) => updateIncident(s, id, (inc) => ({
      ...inc,
      status: 'acknowledged',
      acknowledgedBy: adminName,
      acknowledgedAt: Date.now(),
    })));
  },

  markInvestigating: (id) => {
    set((s) => updateIncident(s, id, (inc) => ({
      ...inc,
      status: 'investigating',
    })));
  },

  resolveIncident: (id) => {
    set((s) => {
      const incidents = s.incidents.map((inc) =>
        inc.id === id ? { ...inc, status: 'resolved' as const, resolvedAt: Date.now() } : inc
      );
      return {
        incidents,
        activeIncident: s.activeIncident?.id === id ? null : s.activeIncident,
      };
    });
  },

  setActiveIncident: (id) => {
    if (id === null) {
      set({ activeIncident: null });
      return;
    }
    const incident = get().incidents.find((i) => i.id === id) ?? null;
    set({ activeIncident: incident });
  },

  addNote: (id, text, author = 'Admin') => {
    const note: IncidentNote = {
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      text,
      author,
      timestamp: Date.now(),
    };
    set((s) => updateIncident(s, id, (inc) => ({
      ...inc,
      notes: [...inc.notes, note],
    })));
  },
}));
