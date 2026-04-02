'use client';

import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import RequireAuth from '@/components/RequireAuth';
import { fetchOrderById, P2P_V2_ORDER_KEY } from '@/lib/p2pApi';
import { useAuthStore } from '@/store/auth';
import { useP2pOrderWs } from '@/hooks/useP2pOrderWs';
import { P2POrderSummary } from '@/components/p2p-v2/P2POrderSummary';
import { P2PTimer } from '@/components/p2p-v2/P2PTimer';
import { P2PChat } from '@/components/p2p-v2/P2PChat';
import { P2PActionButtons } from '@/components/p2p-v2/P2PActionButtons';
import { P2PPaymentInstructions } from '@/components/p2p-v2/P2PPaymentInstructions';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';

function P2POrderDetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-4 w-40" />
      <div className="space-y-3 rounded-xl border border-border bg-card p-5 dark:border-border dark:bg-card">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
  );
}

export default function P2PV2OrderDetailPage() {
  return (
    <RequireAuth>
      <OrderDetailInner />
    </RequireAuth>
  );
}

function OrderDetailInner() {
  const params = useParams();
  const orderId =
    typeof params?.id === 'string'
      ? params.id
      : typeof params?.orderId === 'string'
        ? params.orderId
        : '';
  const { user, _hasHydrated, accessToken } = useAuthStore();
  const qc = useQueryClient();

  const terminal = (st: string | undefined) =>
    !st || ['completed', 'cancelled', 'expired'].includes(st);

  const { connected: p2pWsConnected } = useP2pOrderWs({
    orderId,
    enabled: !!orderId && _hasHydrated && !!accessToken,
    onEvent: (ev) => {
      if (ev.type === 'order:updated' || ev.type === 'order:status_changed') {
        qc.invalidateQueries({ queryKey: P2P_V2_ORDER_KEY(orderId) });
      }
    },
  });

  const { data: order, isLoading, isError, error, refetch } = useQuery({
    queryKey: P2P_V2_ORDER_KEY(orderId),
    queryFn: () => fetchOrderById(orderId),
    enabled: !!orderId && _hasHydrated,
    refetchInterval: (q) => {
      const st = (q.state.data as { status?: string } | null)?.status;
      if (terminal(st)) return false;
      return p2pWsConnected ? 60_000 : 5_000;
    },
  });

  if (!orderId) {
    return <p className="text-sm text-muted-foreground">Invalid order</p>;
  }

  if (isLoading) {
    return <P2POrderDetailSkeleton />;
  }

  if (isError) {
    return (
      <ErrorState
        title="Could not load this order"
        message={error instanceof Error ? error.message : undefined}
        onRetry={() => void refetch()}
      />
    );
  }

  if (!order) {
    return (
      <ErrorState
        title="Order not found"
        message="It may have been removed or you don’t have access."
        onRetry={() => void refetch()}
      />
    );
  }

  const isBuyer = user?.id === order.buyer_id;
  const isSeller = user?.id === order.seller_id;
  if (!isBuyer && !isSeller) {
    return <p className="text-sm text-red-600">You do not have access to this order.</p>;
  }

  const chatEnabled = !['completed', 'cancelled', 'expired'].includes(order.status);
  const details = order.seller_payment_details as Record<string, unknown> | undefined;

  return (
    <div className="space-y-6">
      <Link href="/p2p/orders" className="text-sm text-primary hover:underline dark:text-blue-400">
        ← Back to orders
      </Link>

      <P2POrderSummary order={order} isBuyer={isBuyer} />

      <P2PTimer
        expiresAtIso={order.expires_at}
        active={order.status === 'payment_pending'}
        onExpire={() => qc.invalidateQueries({ queryKey: P2P_V2_ORDER_KEY(orderId) })}
      />

      {isBuyer && order.status === 'payment_pending' && details && (
        <P2PPaymentInstructions details={details} displayName={order.seller_payment_display_name} />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <P2PChat orderId={orderId} enabled={chatEnabled} />
        <P2PActionButtons order={order} isBuyer={isBuyer} isSeller={isSeller} />
      </div>
    </div>
  );
}
