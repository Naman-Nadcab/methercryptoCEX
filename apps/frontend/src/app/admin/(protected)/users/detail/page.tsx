'use client';

import Link from 'next/link';
import { SectionHeader, Panel } from '@/components/admin/control-plane';
import { Users, ArrowRight } from 'lucide-react';

export default function UserDetailLandingPage() {
  return (
    <div className="space-y-6">
      <SectionHeader
        title="User Detail"
        subtitle="View a single user's profile, balances, and activity."
      />
      <Panel title="Select a user" subtitle="User detail is available from the User List.">
        <p className="text-gray-400 text-sm mb-4">
          Open the User List and click a user row to view their detail (profile, balances, deposits, withdrawals, freeze/unfreeze).
        </p>
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600/20 border border-amber-500/30 text-amber-400 hover:bg-amber-600/30 transition-colors"
        >
          <Users className="w-4 h-4" />
          Go to User List
          <ArrowRight className="w-4 h-4" />
        </Link>
      </Panel>
    </div>
  );
}
