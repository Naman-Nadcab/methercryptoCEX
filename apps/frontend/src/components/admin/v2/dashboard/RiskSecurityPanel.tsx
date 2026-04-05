'use client';

import Link from 'next/link';
import { useDashboardStats, useWithdrawalsList } from '@/hooks/admin/useAdminDashboard';
import { ShieldAlert, ArrowUpFromLine, Scale } from 'lucide-react';

export function RiskSecurityPanel() {
  const { data: statsData } = useDashboardStats();
  const { data: withdrawData } = useWithdrawalsList({ limit: 5 });
  const stats = statsData?.data as { p2p?: { openDisputes?: number }; kyc?: { pending?: number } } | undefined;
  const pendingCount = withdrawData?.data?.stats && typeof (withdrawData.data.stats as { pending_approval?: number }).pending_approval === 'number'
    ? (withdrawData.data.stats as { pending_approval: number }).pending_approval
    : 0;
  const openDisputes = stats?.p2p?.openDisputes ?? 0;

  const items = [
    { label: 'AML Alerts', value: '—', href: '/admin/compliance/alerts', icon: ShieldAlert },
    { label: 'Pending Withdrawals', value: pendingCount, href: '/admin/withdrawals?status=pending_approval', icon: ArrowUpFromLine },
    { label: 'Open P2P Disputes', value: openDisputes, href: '/admin/p2p/disputes', icon: Scale },
  ];

  return (
    <div className="rounded-[var(--admin-radius)] border border-[var(--admin-card-border)] bg-[var(--admin-card-bg)] p-4 shadow-[var(--admin-shadow)]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[var(--admin-text)]">Risk & Security</h3>
        <Link href="/admin/risk" className="text-xs font-medium text-[var(--admin-primary)] hover:underline">
          Dashboard →
        </Link>
      </div>
      <ul className="space-y-2">
        {items.map(({ label, value, href, icon: Icon }) => (
          <li key={label}>
            <Link
              href={href}
              className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg hover:bg-[var(--admin-hover-bg)] transition-colors"
            >
              <span className="flex items-center gap-2 text-sm text-[var(--admin-text)]">
                <Icon className="w-4 h-4 text-[var(--admin-text-muted)]" />
                {label}
              </span>
              <span className="text-sm font-semibold tabular-nums text-[var(--admin-text)]">
                {typeof value === 'number' ? value : value}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
