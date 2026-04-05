'use client';

import { ADMIN_FEATURE_FLAGS } from '@/lib/admin/featureFlags';
import { IncidentHistoryPage } from '@/components/admin-v2/IncidentHistoryPage';

export default function IncidentsV2Page() {
  if (!ADMIN_FEATURE_FLAGS.ADMIN_INCIDENT_SYSTEM) {
    return (
      <div className="flex items-center justify-center min-h-[400px] text-sm text-zinc-500">
        Incident Management V2 is currently disabled.
      </div>
    );
  }

  return <IncidentHistoryPage />;
}
