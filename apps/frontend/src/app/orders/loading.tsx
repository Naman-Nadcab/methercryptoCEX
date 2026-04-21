import { PageSkeleton } from '@/components/PageSkeleton';

export default function OrdersLoading() {
  return <PageSkeleton rows={10} metrics={0} />;
}
