import { redirect } from 'next/navigation';

export default function SpotRedirectPage() {
  // Server-side redirect avoids client boot delays and chunk fetch races on /spot.
  redirect('/trade/spot');
}
