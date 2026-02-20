'use client';

import Link from 'next/link';
import { SectionHeader, Panel } from '@/components/admin/control-plane';
import { FileText, ArrowRight } from 'lucide-react';

export default function KYCAuditTrailPage() {
  return (
    <div className="space-y-6">
      <SectionHeader
        title="KYC Audit Trail"
        subtitle="Immutable audit log for KYC approve/reject and identity decisions."
      />
      <Panel title="Audit logs" subtitle="View all admin actions including KYC decisions in the central audit log.">
        <p className="text-gray-400 text-sm mb-4">
          KYC approvals, rejections, and related identity actions are recorded in the immutable audit log. Use the Security audit log with action filters to trace KYC decisions.
        </p>
        <Link
          href="/admin/security/audit-logs"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600/20 border border-amber-500/30 text-amber-400 hover:bg-amber-600/30 transition-colors"
        >
          <FileText className="w-4 h-4" />
          Open Audit Logs
          <ArrowRight className="w-4 h-4" />
        </Link>
      </Panel>
    </div>
  );
}
