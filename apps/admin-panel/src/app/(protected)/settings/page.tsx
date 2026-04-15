'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useAdminAuthStore } from '@/store/auth';
import { getSystemSettings, patchSystemSettings } from '@/lib/system-api';
import { Server, ShieldCheck, Cable, Settings, Globe, CheckCircle2, AlertTriangle } from 'lucide-react';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';

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
    <AdminPageFrame title="Settings" description="Configure system and integration settings.">

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          {
            href: '/settings/system',
            icon: <Settings className="h-5 w-5" />,
            iconBg: 'bg-violet-950/40 border border-violet-500/30 text-violet-400',
            title: 'System & Feature Flags',
            desc: 'Feature flags, trading and risk config, system limits, emergency controls.',
          },
          {
            href: '/settings/nodes',
            icon: <Server className="h-5 w-5" />,
            iconBg: 'bg-slate-800/60 border border-slate-500/30 text-slate-400',
            title: 'Node Providers',
            desc: 'Manage RPC node providers (Infura, Alchemy, QuickNode, self-hosted).',
          },
          {
            href: '/settings/integrations',
            icon: <ShieldCheck className="h-5 w-5" />,
            iconBg: 'bg-emerald-950/40 border border-emerald-500/30 text-emerald-400',
            title: 'Compliance Integrations',
            desc: 'Configure Chainalysis, TRM Labs, Elliptic, SumSub, ComplyAdvantage.',
          },
          {
            href: '/settings/infrastructure',
            icon: <Cable className="h-5 w-5" />,
            iconBg: 'bg-indigo-950/40 border border-indigo-500/30 text-indigo-400',
            title: 'Infrastructure',
            desc: 'RPC nodes, price oracles, email/SMS gateways, webhook endpoints.',
          },
          {
            href: '/settings#geo-blocking',
            icon: <Globe className="h-5 w-5" />,
            iconBg: 'bg-sky-950/40 border border-sky-500/30 text-sky-400',
            title: 'Geo-blocking & Restrictions',
            desc: 'Country allowlists, OFAC alignment, and high-risk jurisdiction policies.',
          },
        ].map((item) => (
          <Link key={item.href} href={item.href}>
            <Card className="group cursor-pointer border border-admin-border bg-admin-card transition-all hover:border-admin-border/80 hover:bg-white/[0.04]">
              <CardHeader className="flex flex-row items-center gap-3 pb-2">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${item.iconBg}`}>
                  {item.icon}
                </div>
                <CardTitle className="text-sm font-semibold text-admin-text">{item.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-admin-muted leading-relaxed">{item.desc}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
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
                className="mt-1 w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-1 focus:ring-admin-accent/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-admin-text">High-risk countries (ISO2 CSV)</label>
              <input
                value={highRiskCountries}
                onChange={(e) => setHighRiskCountries(e.target.value)}
                placeholder="MM,SS,YE"
                className="mt-1 w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-1 focus:ring-admin-accent/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-admin-text">KYC required countries (ISO2 CSV)</label>
              <input
                value={kycRequiredCountries}
                onChange={(e) => setKycRequiredCountries(e.target.value)}
                placeholder="US"
                className="mt-1 w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-1 focus:ring-admin-accent/50"
              />
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={() => geoMutation.mutate()} disabled={geoMutation.isPending}>
                {geoMutation.isPending ? 'Saving…' : 'Save Geo Rules'}
              </Button>
              {geoMutation.isSuccess && (
                <span className="flex items-center gap-1 text-xs text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Saved
                </span>
              )}
              {geoMutation.isError && (
                <span className="flex items-center gap-1 text-xs text-red-400">
                  <AlertTriangle className="h-3.5 w-3.5" /> Failed to save
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </AdminPageFrame>
  );
}
