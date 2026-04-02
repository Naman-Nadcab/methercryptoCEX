import { redirect } from 'next/navigation';

type Props = { params: { type: string; crypto: string; fiat: string } };

export default function DashboardP2PCreateAdRedirect({ params }: Props) {
  void params;
  redirect('/p2p/create-ad');
}
