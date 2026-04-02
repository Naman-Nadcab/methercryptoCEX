'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function ConvertRedirect() {
  const router = useRouter();
  
  useEffect(() => {
    router.replace('/wallet/convert');
  }, [router]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-muted-foreground">Redirecting to Convert...</p>
      </div>
    </div>
  );
}
