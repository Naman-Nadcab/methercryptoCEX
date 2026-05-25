import { redirect } from 'next/navigation';

export default function LegacyDashboardSpotPage() {
  redirect('/trade/spot');
}
