'use client';

import Link from 'next/link';
import { Settings, ArrowRight } from 'lucide-react';

export default function P2PSettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-foreground">P2P Settings</h1>
      <p className="text-sm text-muted-foreground">Configure P2P trading behaviour and limits.</p>
      <div className="rounded-xl border border-border bg-card p-6 max-w-lg">
        <p className="text-sm text-muted-foreground mb-4">
          Global P2P toggles, limits, and payment-method rules are managed from System Settings. Use the links below for related config.
        </p>
        <ul className="space-y-2 text-sm">
          <li>
            <Link
              href="/admin/settings"
              className="inline-flex items-center gap-2 text-primary hover:underline"
            >
              <Settings className="w-4 h-4" />
              System Settings
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <span className="text-muted-foreground"> — P2P on/off, limits, fees</span>
          </li>
          <li>
            <Link
              href="/admin/p2p/payment-methods"
              className="inline-flex items-center gap-2 text-primary hover:underline"
            >
              Payment Methods
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <span className="text-muted-foreground"> — Allowed payment methods</span>
          </li>
          <li>
            <Link
              href="/admin/settings/p2p-assets"
              className="inline-flex items-center gap-2 text-primary hover:underline"
            >
              P2P Assets
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <span className="text-muted-foreground"> — Currencies enabled for P2P</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
