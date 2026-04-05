'use client';

import { ADMIN_FEATURE_FLAGS } from '@/lib/admin/featureFlags';
import { DashboardV2 } from '@/components/admin-v2/Dashboard';

function BaseDashboardV2() {
  return <DashboardV2 />;
}

function DashboardFallback() {
  return (
    <div className="min-h-screen bg-[#0F1117] flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-[#E5E7EB] mb-2">Dashboard V2</h2>
        <p className="text-sm text-zinc-500">Intelligence features are disabled. Enable ADMIN_NEW_DASHBOARD_V2_INTELLIGENCE flag.</p>
      </div>
    </div>
  );
}

export default function DashboardV2Page() {
  if (ADMIN_FEATURE_FLAGS.ADMIN_NEW_DASHBOARD_V2_INTELLIGENCE) {
    return <BaseDashboardV2 />;
  }
  return <DashboardFallback />;
}
