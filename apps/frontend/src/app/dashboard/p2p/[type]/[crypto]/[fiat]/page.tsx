import { redirect } from 'next/navigation';

type Props = { params: { type: string; crypto: string; fiat: string } };

/** Deep links to old path land on v2 marketplace (filters are chosen in-app). */
export default function DashboardP2PMarketRedirect({ params }: Props) {
  void params;
  redirect('/p2p');
}
