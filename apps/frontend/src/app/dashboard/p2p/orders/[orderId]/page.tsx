import { redirect } from 'next/navigation';

type Props = { params: { orderId: string } };

export default function DashboardP2POrderRedirect({ params }: Props) {
  redirect(`/p2p/orders/${encodeURIComponent(params.orderId)}`);
}
