import { redirect } from 'next/navigation';

/** Legacy P2P hub — redirects to canonical /p2p marketplace. */
export default function DashboardP2PRedirect() {
  redirect('/p2p');
}
