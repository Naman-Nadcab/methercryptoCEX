'use client';

import { ADMIN_FEATURE_FLAGS } from '@/lib/admin/featureFlags';
import { IncidentHistoryPage } from '@/components/admin-v2/IncidentHistoryPage';

function IncidentsFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-admin-text mb-2">Incident Management</h2>
        <p className="text-sm text-admin-muted">
          Incident system is disabled. Enable ADMIN_INCIDENT_SYSTEM flag.
        </p>
      </div>
    </div>
  );
}

export default function IncidentsPage() {
  if (ADMIN_FEATURE_FLAGS.ADMIN_INCIDENT_SYSTEM) {
    return <IncidentHistoryPage />;
  }
  return <IncidentsFallback />;
}
