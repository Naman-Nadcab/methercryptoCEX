'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import RequireAuth from '@/components/RequireAuth';
import { fetchP2PDisputeById, P2P_V2_DISPUTE_KEY } from '@/lib/p2pApi';
import { ArrowLeft, AlertTriangle, Shield, ExternalLink } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';

const STATUS_CLS: Record<string, string> = {
  open: 'bg-amber-500/10 text-amber-500',
  resolved: 'bg-[#0ecb81]/10 text-[#0ecb81]',
  closed: 'bg-muted text-muted-foreground',
};

export default function P2PV2DisputePage() {
  return <RequireAuth><DisputeInner /></RequireAuth>;
}

function DisputeInner() {
  const params = useParams();
  const disputeId = typeof params?.id === 'string' ? params.id : '';

  const { data: d, isLoading, isError, refetch } = useQuery({
    queryKey: P2P_V2_DISPUTE_KEY(disputeId),
    queryFn: () => fetchP2PDisputeById(disputeId),
    enabled: !!disputeId,
    refetchInterval: 10_000,
  });

  if (!disputeId) return <p className="text-sm text-muted-foreground">Invalid dispute</p>;

  const evidence = d && Array.isArray(d.evidence) ? d.evidence : [];
  const sCls = d ? (STATUS_CLS[d.status] ?? 'bg-muted text-muted-foreground') : '';

  return (
    <div className="mx-auto max-w-[800px] px-4 sm:px-6">
      <div className="flex items-center justify-between border-b border-border/20 py-3">
        <Link href="/p2p/orders" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Orders
        </Link>
        {d && <span className={`rounded-md px-2.5 py-1 text-[10px] font-semibold capitalize ${sCls}`}>{d.status}</span>}
      </div>

      {isLoading && (
        <div className="space-y-3 mt-5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-40 rounded-lg" />
        </div>
      )}

      {!isLoading && isError && (
        <div className="mt-8 text-center">
          <p className="text-sm text-muted-foreground">Failed to load dispute. Please try again.</p>
          <button
            onClick={() => refetch()}
            className="mt-3 rounded-md bg-primary px-4 py-1.5 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Retry
          </button>
        </div>
      )}

      {!isLoading && !isError && !d && (
        <p className="mt-8 text-sm text-muted-foreground text-center">Dispute not found.</p>
      )}

      {d && (
        <div className="mt-5 space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <h1 className="text-[15px] font-bold text-foreground">Dispute</h1>
          </div>

          <div className="rounded-lg border border-border/30 bg-card divide-y divide-border/15">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[11px] text-muted-foreground/60">Order</span>
              <Link className="font-mono text-[12px] text-primary hover:underline" href={`/p2p/orders/${d.order_id}`}>
                {d.order_id.slice(0, 12)}…
              </Link>
            </div>
            {d.order_status && (
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-[11px] text-muted-foreground/60">Order Status</span>
                <span className="text-[13px] font-medium text-foreground capitalize">{d.order_status.replace(/_/g, ' ')}</span>
              </div>
            )}
            <div className="px-4 py-3">
              <p className="text-[11px] text-muted-foreground/60 mb-1">Your Reason</p>
              <p className="whitespace-pre-wrap text-[13px] text-foreground">{d.reason}</p>
            </div>

            {evidence.length > 0 && (
              <div className="px-4 py-3">
                <p className="text-[11px] text-muted-foreground/60 mb-1.5">Evidence</p>
                <ul className="space-y-1">
                  {evidence.map((url: string, i: number) => (
                    <li key={i}>
                      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline break-all">
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        {url}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {d.admin_notes && (
              <div className="px-4 py-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Shield className="h-3 w-3 text-amber-500" />
                  <span className="text-[11px] font-semibold text-amber-500">Admin Response</span>
                </div>
                <p className="whitespace-pre-wrap text-[13px] text-foreground">{d.admin_notes}</p>
              </div>
            )}

            {d.resolution && (
              <div className="px-4 py-3">
                <span className="text-[11px] text-muted-foreground/60">Resolution: </span>
                <span className="font-mono text-[12px] text-foreground">{d.resolution}</span>
                {d.resolved_at && <span className="text-[11px] text-muted-foreground ml-2">· {new Date(d.resolved_at).toLocaleString()}</span>}
              </div>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground">
            Further communication happens through support channels. This page reflects the current dispute state.
          </p>
        </div>
      )}
    </div>
  );
}
