'use client';

import Link from 'next/link';
import { SectionHeader, Panel } from '@/components/admin/control-plane';
import { ShieldAlert, ArrowRight } from 'lucide-react';

export default function UserRiskProfilePage() {
  return (
    <div className="space-y-6">
      <SectionHeader
        title="User Risk Profile"
        subtitle="Risk rules and withdrawal risk monitoring."
      />
      <Panel title="Risk & compliance" subtitle="Configure risk rules and monitor high-risk activity.">
        <p className="text-gray-400 text-sm mb-4">
          User risk is evaluated via AML alerts, risk rules, and withdrawal monitoring. Use the links below to manage rules and view withdrawal risk.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/security/risk-rules"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-200 hover:bg-gray-600 transition-colors"
          >
            <ShieldAlert className="w-4 h-4" />
            Risk Rules
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/admin/security/withdrawals"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-200 hover:bg-gray-600 transition-colors"
          >
            Withdrawal Risk Monitor
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/admin/compliance/alerts"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-200 hover:bg-gray-600 transition-colors"
          >
            AML Alerts
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </Panel>
    </div>
  );
}
