'use client';

import { Fragment } from 'react';
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
import { ArrowLeft, Check, Circle } from 'lucide-react';

/* ── Status timeline ── */
const STEPS = [
  { label: 'Created' },
  { label: 'Payment' },
  { label: 'Confirmed' },
  { label: 'Completed' },
];

const STATUS_STEP: Record<string, number> = {
  payment_pending: 1,
  payment_confirmed: 2,
  completed: 4,
  cancelled: -1,
  expired: -1,
  disputed: 2,
};

function StatusTimeline({ status }: { status: string }) {
  const currentStep = STATUS_STEP[status] ?? 0;
  const failed = status === 'cancelled' || status === 'expired';

  return (
    <div className="flex items-center gap-0 py-4">
      {STEPS.map((step, i) => {
        const done = currentStep > 0 && i < currentStep;
        const active = currentStep > 0 && i === currentStep;
        const last = i === STEPS.length - 1;

        return (
          <Fragment key={i}>
            <div className="flex flex-col items-center gap-1">
              <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                done
                  ? 'bg-[#0ecb81] text-white'
                  : active
                    ? 'bg-primary/20 text-primary ring-2 ring-primary/30'
                    : failed && i === currentStep
                      ? 'bg-[#f6465d]/15 text-[#f6465d]'
                      : 'bg-muted/30 text-muted-foreground/50'
              }`}>
                {done ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3 w-3" />}
              </div>
              <span className={`text-xs font-medium whitespace-nowrap ${
                done || active ? 'text-foreground' : 'text-muted-foreground/50'
              }`}>
                {step.label}
              </span>
            </div>
            {!last && (
              <div className={`h-px flex-1 mx-1 mt-[-14px] ${done ? 'bg-[#0ecb81]' : 'bg-border/20'}`} />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

/* ── Loading skeleton ── */
function OrderSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-5 w-44" />
      <div className="flex gap-8 py-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <Skeleton className="h-7 w-7 rounded-full" />
            <Skeleton className="h-3 w-14" />
          </div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Skeleton className="h-48 rounded-lg" />
          <Skeleton className="h-32 rounded-lg" />
        </div>
        <Skeleton className="h-[400px] rounded-lg" />
      </div>
    </div>
  );
}

/* ── Main export ── */
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

  if (isLoading) return <OrderSkeleton />;

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
        message="It may have been removed or you don't have access."
        onRetry={() => void refetch()}
      />
    );
  }

  const isBuyer = user?.id === order.buyer_id;
  const isSeller = user?.id === order.seller_id;
  if (!isBuyer && !isSeller) {
    return <p className="text-sm text-[#f6465d]">You do not have access to this order.</p>;
  }

  const chatEnabled = !['completed', 'cancelled', 'expired'].includes(order.status);
  const details = order.seller_payment_details as Record<string, unknown> | undefined;

  return (
    <div className="mx-auto max-w-[1400px] px-4 sm:px-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/20 py-3">
        <Link href="/p2p/orders" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Orders
        </Link>
        <span className="font-mono text-sm text-muted-foreground">#{orderId.slice(0, 12)}</span>
      </div>

      {/* Timer */}
      <div className="mt-3">
        <P2PTimer
          expiresAtIso={order.expires_at}
          active={order.status === 'payment_pending'}
          onExpire={() => qc.invalidateQueries({ queryKey: P2P_V2_ORDER_KEY(orderId) })}
        />
      </div>

      {/* Status timeline */}
      <StatusTimeline status={order.status} />

      {/* Two-column layout: Left (order + actions) / Right (chat) */}
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        {/* Left panel */}
        <div className="space-y-4">
          <P2POrderSummary order={order} isBuyer={isBuyer} />

          {isBuyer && order.status === 'payment_pending' && details && (
            <P2PPaymentInstructions details={details} displayName={order.seller_payment_display_name} />
          )}

          <P2PActionButtons order={order} isBuyer={isBuyer} isSeller={isSeller} />
        </div>

        {/* Right panel: Chat */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <P2PChat orderId={orderId} enabled={chatEnabled} />
        </div>
      </div>
    </div>
  );
}
