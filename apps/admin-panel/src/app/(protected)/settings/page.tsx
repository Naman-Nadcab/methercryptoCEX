'use client';

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Server, ShieldCheck, Cable, Settings } from 'lucide-react';

export default function SettingsPage() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-admin-muted">Configure system and integration settings.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/settings/system">
          <Card className="cursor-pointer transition-shadow hover:shadow-md">
            <CardHeader className="flex flex-row items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                <Settings className="h-5 w-5" />
              </div>
              <CardTitle className="text-base">System & feature flags</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-admin-muted">
                Feature flags, trading and risk config, system limits, emergency controls.
              </p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/settings/nodes">
          <Card className="cursor-pointer transition-shadow hover:shadow-md">
            <CardHeader className="flex flex-row items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                <Server className="h-5 w-5" />
              </div>
              <CardTitle className="text-base">Node Providers</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-admin-muted">
                Manage RPC node providers (Infura, Alchemy, QuickNode, self-hosted). Update without redeploy.
              </p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/settings/integrations">
          <Card className="cursor-pointer transition-shadow hover:shadow-md">
            <CardHeader className="flex flex-row items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 text-green-700">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <CardTitle className="text-base">Compliance Integrations</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-admin-muted">
                Configure Chainalysis, TRM Labs, Elliptic, SumSub, ComplyAdvantage. Enable/disable and update API keys.
              </p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/settings/infrastructure">
          <Card className="cursor-pointer transition-shadow hover:shadow-md">
            <CardHeader className="flex flex-row items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                <Cable className="h-5 w-5" />
              </div>
              <CardTitle className="text-base">Infrastructure</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-admin-muted">
                RPC nodes, price oracles, email/SMS gateways, webhook endpoints. Update without redeploy.
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
