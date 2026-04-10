'use client';

import { ADMIN_FEATURE_FLAGS } from '@/lib/admin/featureFlags';
import { IncidentHistoryPage } from '@/components/admin-v2/IncidentHistoryPage';
import { MonitoringIncidentsPanel } from '@/components/incidents/MonitoringIncidentsPanel';

function IncidentsFallback() {
  return (
    <div className="space-y-6">
      <MonitoringIncidentsPanel />
      <div className="flex min-h-[30vh] items-center justify-center rounded-xl border border-admin-border border-dashed bg-admin-card/50">
        <div className="text-center px-4 py-8">
          <h2 className="text-lg font-semibold text-admin-text mb-2">Incident workspace</h2>
          <p className="text-sm text-admin-muted max-w-md">
            Playbooks, timelines, and session notes are disabled. Enable <code className="rounded bg-white/5 px-1 text-xs">ADMIN_INCIDENT_SYSTEM</code> for
            the extended workspace. Recorded incidents above are always loaded from the database.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function IncidentsPage() {
  if (ADMIN_FEATURE_FLAGS.ADMIN_INCIDENT_SYSTEM) {
    return (
      <div className="space-y-8">
        <MonitoringIncidentsPanel />
        <div>
          <h2 className="text-sm font-semibold text-admin-text mb-1">Session workspace & playbooks</h2>
          <p className="text-[11px] text-admin-muted mb-3">
            Local session tools below supplement — but do not replace — recorded incidents in the table above.
          </p>
          <IncidentHistoryPage />
        </div>
      </div>
    );
  }
  return <IncidentsFallback />;
}
