'use client';

import Link from 'next/link';
import { SectionHeader, Panel } from '@/components/admin/control-plane';
import { Users, ArrowRight } from 'lucide-react';

export default function P2PMerchantsPage() {
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Merchants"
        subtitle="Verified P2P merchants and seller activity."
      />

      <Panel>
        <div className="py-8 px-4 text-center max-w-lg mx-auto">
          <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-foreground font-medium">Merchant list</p>
          <p className="text-sm text-muted-foreground mt-1">
            Merchant verification and stats are tracked in the backend (p2p_merchant_stats). Use the links below to view seller activity and orders.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href="/admin/p2p/trades"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              Active Trades (orders)
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/admin/p2p/orders"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              Orders / Ads
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </Panel>
    </div>
  );
}
