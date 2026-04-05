'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useAdminAuthStore } from '@/store/auth';
import { getSystemSettings, patchSystemSettings } from '@/lib/system-api';
import { Server, ShieldCheck, Cable, Settings, Globe } from 'lucide-react';

export default function SettingsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const { data: settingsData } = useQuery({
    queryKey: ['admin', 'system', 'settings', token],
    queryFn: () => getSystemSettings(token),
    enabled: !!token,
    staleTime: 30_000,
  });
  const [geoBlockedCountries, setGeoBlockedCountries] = useState('');
  const [highRiskCountries, setHighRiskCountries] = useState('');
  const [kycRequiredCountries, setKycRequiredCountries] = useState('');

  const settings = settingsData?.data?.settings ?? {};
  useEffect(() => {
    setGeoBlockedCountries(settings.GEO_BLOCKED_COUNTRIES?.value ?? 'KP,IR,SY,CU,UA-43');
    setHighRiskCountries(settings.HIGH_RISK_COUNTRIES?.value ?? 'MM,SS,YE');
    setKycRequiredCountries(settings.KYC_REQUIRED_COUNTRIES?.value ?? 'US');
  }, [settings.GEO_BLOCKED_COUNTRIES?.value, settings.HIGH_RISK_COUNTRIES?.value, settings.KYC_REQUIRED_COUNTRIES?.value]);

  const normalizeCountryList = (value: string) =>
    value
      .split(',')
      .map((v) => v.trim().toUpperCase())
      .filter(Boolean)
      .join(',');

  const geoSummary = useMemo(() => ({
    blockedCount: geoBlockedCountries.split(',').map((v) => v.trim()).filter(Boolean).length,
    highRiskCount: highRiskCountries.split(',').map((v) => v.trim()).filter(Boolean).length,
    kycCount: kycRequiredCountries.split(',').map((v) => v.trim()).filter(Boolean).length,
  }), [geoBlockedCountries, highRiskCountries, kycRequiredCountries]);

  const geoMutation = useMutation({
    mutationFn: () =>
      patchSystemSettings(token, {
        GEO_BLOCKED_COUNTRIES: normalizeCountryList(geoBlockedCountries),
        HIGH_RISK_COUNTRIES: normalizeCountryList(highRiskCountries),
        KYC_REQUIRED_COUNTRIES: normalizeCountryList(kycRequiredCountries),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'system', 'settings'] });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-admin-text">Settings</h1>
        <p className="text-xs text-admin-muted mt-0.5">Configure system and integration settings.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
        <Link href="/settings#geo-blocking">
          <Card className="cursor-pointer transition-shadow hover:shadow-md">
            <CardHeader className="flex flex-row items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
                <Globe className="h-5 w-5" />
              </div>
              <CardTitle className="text-base">Geo-blocking & Restrictions</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-admin-muted">
                Country allowlists, OFAC alignment, and high-risk jurisdiction policies enforced at the gateway.
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      <Card id="geo-blocking">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4" /> Geo-blocking & Country Restrictions
          </CardTitle>
          <Badge variant="default">Live Config</Badge>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-admin-muted mb-4">Manage country controls from admin (runtime, no redeploy).</p>
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-admin-border p-3">
              <div>
                <p className="text-sm font-medium text-admin-text">OFAC Sanctioned Countries</p>
                <p className="text-xs text-admin-muted">{geoSummary.blockedCount} blocked country codes configured</p>
              </div>
              <Badge variant="danger" size="sm">Blocked</Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-admin-border p-3">
              <div>
                <p className="text-sm font-medium text-admin-text">High-Risk Jurisdictions</p>
                <p className="text-xs text-admin-muted">{geoSummary.highRiskCount} countries under enhanced due diligence</p>
              </div>
              <Badge variant="warning" size="sm">Restricted</Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-admin-border p-3">
              <div>
                <p className="text-sm font-medium text-admin-text">US Users</p>
                <p className="text-xs text-admin-muted">{geoSummary.kycCount} countries with forced KYC policy</p>
              </div>
              <Badge variant="warning" size="sm">KYC Required</Badge>
            </div>
          </div>
          <div className="mt-4 grid gap-3">
            <div>
              <label className="block text-sm font-medium text-admin-text">Blocked countries (ISO2 CSV)</label>
              <input
                value={geoBlockedCountries}
                onChange={(e) => setGeoBlockedCountries(e.target.value)}
                placeholder="KP,IR,SY,CU,UA-43"
                className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-admin-text">High-risk countries (ISO2 CSV)</label>
              <input
                value={highRiskCountries}
                onChange={(e) => setHighRiskCountries(e.target.value)}
                placeholder="MM,SS,YE"
                className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-admin-text">KYC required countries (ISO2 CSV)</label>
              <input
                value={kycRequiredCountries}
                onChange={(e) => setKycRequiredCountries(e.target.value)}
                placeholder="US"
                className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => geoMutation.mutate()} disabled={geoMutation.isPending}>
                {geoMutation.isPending ? 'Saving...' : 'Save Geo Rules'}
              </Button>
              {geoMutation.isSuccess && <span className="text-xs text-green-700">Saved</span>}
              {geoMutation.isError && <span className="text-xs text-red-700">Failed to save</span>}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
