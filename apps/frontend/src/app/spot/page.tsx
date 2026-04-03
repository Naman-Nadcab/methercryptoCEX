'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function SpotRedirectPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/trade/spot'); }, [router]);
  return null;
}
