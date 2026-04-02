'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import RequireAuth from '@/components/RequireAuth';
import { fetchP2PDisputeById, P2P_V2_DISPUTE_KEY } from '@/lib/p2pApi';

export default function P2PV2DisputePage() {
  return (
    <RequireAuth>
      <DisputeInner />
    </RequireAuth>
  );
}

function DisputeInner() {
  const params = useParams();
  const disputeId = typeof params?.id === 'string' ? params.id : '';

  const { data: d, isLoading } = useQuery({
    queryKey: P2P_V2_DISPUTE_KEY(disputeId),
    queryFn: () => fetchP2PDisputeById(disputeId),
    enabled: !!disputeId,
    refetchInterval: 10_000,
  });

  if (!disputeId) return <p className="text-sm text-gray-500">Invalid dispute</p>;
  if (isLoading) return <p className="text-sm text-gray-500">Loading…</p>;
  if (!d) return <p className="text-sm text-gray-500">Dispute not found.</p>;

  const evidence = Array.isArray(d.evidence) ? d.evidence : [];

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Link href="/p2p/orders" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
        ← Orders
      </Link>
      <h1 className="text-xl font-semibold text-foreground">Dispute</h1>
      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-card space-y-2 text-sm">
        <p>
          <span className="text-gray-500">Status:</span> <span className="font-medium">{d.status}</span>
        </p>
        <p>
          <span className="text-gray-500">Order:</span>{' '}
          <Link className="text-primary" href={`/p2p/orders/${d.order_id}`}>
            {d.order_id.slice(0, 8)}…
          </Link>
        </p>
        {d.order_status && (
          <p>
            <span className="text-gray-500">Order status:</span> {d.order_status}
          </p>
        )}
        <div>
          <p className="text-gray-500">Your reason</p>
          <p className="whitespace-pre-wrap text-foreground">{d.reason}</p>
        </div>
        {evidence.length > 0 && (
          <div>
            <p className="text-gray-500">Evidence URLs</p>
            <ul className="list-inside list-disc text-xs">
              {evidence.map((url, i) => (
                <li key={i}>
                  <a href={url} target="_blank" rel="noreferrer" className="text-blue-600 break-all">
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {d.admin_notes && (
          <div className="border-t border-gray-100 pt-3 dark:border-gray-800">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Support / admin</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200">{d.admin_notes}</p>
          </div>
        )}
        {d.resolution && (
          <p className="text-xs text-muted-foreground">
            Resolution: <span className="font-mono">{d.resolution}</span>
            {d.resolved_at && ` · ${new Date(d.resolved_at).toLocaleString()}`}
          </p>
        )}
      </div>
      <p className="text-xs text-gray-500">
        Further communication happens through support channels. This page reflects database state only.
      </p>
    </div>
  );
}
