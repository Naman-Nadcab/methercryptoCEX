'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Gauge, Activity, Sliders, Siren, Cable, Server } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui';
import { adminFetch } from '@/lib/api';
import { useAdminAuthStore } from '@/store/auth';
import { cn } from '@/lib/cn';

const LINKS: {
  href: string;
  title: string;
  description: string;
  icon: typeof Activity;
}[] = [
  {
    href: '/monitoring',
    title: 'Monitoring',
    description:
      'Health, queues, RPC providers, and live infrastructure signals. Use this view when validating SLO burn rates or tracing cascading failures across workers.',
    icon: Activity,
  },
  {
    href: '/admin-control',
    title: 'Admin control',
    description:
      'Circuit breakers, trading halts, and emergency exchange controls. Prefer narrow asset freezes before global trading halts to reduce customer impact.',
    icon: Sliders,
  },
  {
    href: '/incidents',
    title: 'Incidents',
    description:
      'Track and resolve operational incidents across services. Capture customer communications, mitigation steps, and timestamps while memory is fresh.',
    icon: Siren,
  },
  {
    href: '/integrations',
    title: 'Integrations',
    description:
      'Third-party connectors, webhooks, and external service status. Validate credentials rotation schedules and failure budgets before peak trading windows.',
    icon: Cable,
  },
  {
    href: '/settings/infrastructure',
    title: 'Infrastructure',
    description:
      'Nodes, deployment targets, and core platform configuration. Coordinate with DevOps for blue/green cutovers and ledger reconciliation checkpoints.',
    icon: Server,
  },
];

export default function OperationsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const { data: healthData, isLoading: healthLoading } = useQuery({
    queryKey: ['admin', 'system-health', token],
    queryFn: () => adminFetch('/system-health', { token }),
    enabled: !!token,
    refetchInterval: 15000,
    staleTime: 30_000,
    retry: 1,
  });
  const health = healthData?.success ? (healthData.data as Record<string, any> | undefined) : undefined;

  const dbUp = health?.database?.status === 'up';
  const redisUp = health?.redis?.status === 'up';
  const nodeUp = health?.node?.status === 'up';
  const systemStatus = health && dbUp && redisUp && nodeUp ? 'healthy' : health ? 'degraded' : null;
  const apiLatencyMs = health?.api_latency_ms;
  const wsConnections = health?.websocket?.connections;
  const memoryMb = health?.node?.memory_heap_mb;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-admin-text">Operations</h1>
        <p className="text-xs text-admin-muted mt-0.5">Operational tools for day-to-day exchange management.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card compact className="min-h-[88px]">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-admin-muted">System status</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-lg font-semibold capitalize text-admin-text">
              {!token ? (
                'N/A'
              ) : healthLoading ? (
                '...'
              ) : (
                systemStatus ?? 'N/A'
              )}
            </p>
          </CardContent>
        </Card>
        <Card compact className="min-h-[88px]">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-admin-muted">API latency</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-lg font-semibold tabular-nums text-admin-text">
              {!token ? (
                'N/A'
              ) : healthLoading ? (
                '...'
              ) : apiLatencyMs != null ? (
                `${apiLatencyMs} ms`
              ) : (
                'N/A'
              )}
            </p>
          </CardContent>
        </Card>
        <Card compact className="min-h-[88px]">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-admin-muted">WebSocket connections</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-lg font-semibold tabular-nums text-admin-text">
              {!token ? (
                'N/A'
              ) : healthLoading ? (
                '...'
              ) : wsConnections != null ? (
                wsConnections
              ) : (
                'N/A'
              )}
            </p>
          </CardContent>
        </Card>
        <Card compact className="min-h-[88px]">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-admin-muted">Memory usage</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-lg font-semibold tabular-nums text-admin-text">
              {!token ? (
                'N/A'
              ) : healthLoading ? (
                '...'
              ) : memoryMb != null ? (
                `${memoryMb} MB`
              ) : (
                'N/A'
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      <p className="max-w-2xl text-sm text-admin-muted">
        Jump to operational tools for day-to-day exchange management. Each area opens in place with your current admin
        session.
      </p>
      <p className="max-w-2xl text-sm text-admin-muted">
        Use monitoring for live telemetry, admin control for kill switches, incidents for postmortems, integrations for
        vendor links, and infrastructure for nodes and environment configuration.
      </p>

      <Card compact className="border-dashed border-admin-border bg-white/[0.02]">
        <CardContent className="space-y-2 p-0 text-sm text-admin-muted">
          <p className="font-medium text-gray-800">Runbook tips</p>
          <ul className="list-disc space-y-1 pl-5 leading-relaxed">
            <li>Start with Monitoring when users report latency or failed withdrawals.</li>
            <li>Use Admin control only after confirming blast radius with on-call leadership.</li>
            <li>File incidents early—even if root cause is unknown—so timelines stay defensible.</li>
            <li>Infrastructure changes should flow through your change-management process outside this UI.</li>
          </ul>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {LINKS.map(({ href, title, description, icon: Icon }) => (
          <Link key={href} href={href} className="group block">
            <Card
              compact
              className={cn(
                'h-full transition-shadow duration-200',
                'group-hover:border-admin-primary/40 group-hover:shadow-card-hover'
              )}
            >
              <CardContent className="flex h-full flex-col gap-3 p-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-admin-primary/10 text-admin-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-admin-text group-hover:text-admin-primary">{title}</h2>
                  <p className="mt-1 text-sm leading-relaxed text-admin-muted">{description}</p>
                </div>
                <span className="mt-auto text-xs font-medium text-admin-primary">Open →</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card compact>
        <CardContent className="space-y-3 p-0 text-sm text-admin-muted leading-relaxed">
          <p className="font-medium text-admin-text">Need something else?</p>
          <p>
            Treasury, risk, and user tooling live in the primary navigation. This hub stays focused on keeping the
            exchange technically healthy. If a destination 404s in your deployment, confirm the feature flag or route is
            enabled for your build.
          </p>
          <p className="text-xs">
            Tip: open Monitoring and Admin control in separate tabs during incidents so state-changing actions never
            happen without a telemetry pane visible.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card compact className="bg-admin-card">
          <CardContent className="space-y-2 p-0 text-sm text-admin-muted leading-relaxed">
            <p className="font-medium text-admin-text">Operational cadence</p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>Confirm monitoring green after every production deploy.</li>
              <li>Review incidents weekly—even resolved ones—for missing runbook steps.</li>
              <li>Rotate integration credentials on the same schedule as API wallets.</li>
              <li>Reconcile infrastructure capacity ahead of major market listings.</li>
            </ol>
          </CardContent>
        </Card>
        <Card compact className="bg-admin-card">
          <CardContent className="space-y-2 p-0 text-sm text-admin-muted leading-relaxed">
            <p className="font-medium text-admin-text">When to escalate</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>User balances diverge from chain state or internal ledger projections.</li>
              <li>Matching latency crosses your internal SLO for more than two poll intervals.</li>
              <li>Any automated circuit triggers without a human acknowledgement record.</li>
              <li>Third-party custody or banking integrations return repeated 5xx responses.</li>
              <li>Regulatory inbox receives repeated fraud or sanctions hits within a single hour.</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <p className="text-center text-[11px] text-admin-muted">
        Operations hub · routes validated for this admin build · bookmark for incident response
      </p>
    </div>
  );
}
