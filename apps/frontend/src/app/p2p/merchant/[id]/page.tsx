import { redirect } from 'next/navigation';

/** Legacy path shape; canonical user profiles live under /p2p/profile/[userId]. */
export default function P2PMerchantAliasPage({ params }: { params: { id: string } }) {
  redirect(`/p2p/profile/${encodeURIComponent(params.id)}`);
}
