'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { handleGoogleCallback, consumeOAuthRedirect } from '@/lib/oauth';
import { useAuthStore } from '@/store/auth';
import { useAuth } from '@/context/AuthContext';

export default function GoogleCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuthStore();
  const { setAuthenticated } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const errorParam = searchParams.get('error');

    if (errorParam) {
      setError('Google login was cancelled or failed');
      setTimeout(() => router.push('/login'), 3000);
      return;
    }

    if (!code || !state) {
      setError('Invalid callback parameters');
      setTimeout(() => router.push('/login'), 3000);
      return;
    }

    handleGoogleCallback(code, state)
      .then((result) => {
        if (result.success && result.data) {
          const user = {
            id: result.data.user.id,
            email: result.data.user.email,
            phone: result.data.user.phone,
            username: result.data.user.username,
            status: result.data.user.status as 'pending' | 'active' | 'suspended' | 'banned' | 'deleted',
            emailVerified: result.data.user.emailVerified,
            phoneVerified: result.data.user.phoneVerified,
            tierLevel: result.data.user.tierLevel,
          };
          login(user, result.data.accessToken, result.data.refreshToken);
          setAuthenticated(user);
          const redirect = consumeOAuthRedirect();
          router.push(redirect || '/dashboard');
        } else {
          setError(result.error?.message || 'Google login failed');
          setTimeout(() => router.push('/login'), 3000);
        }
      })
      .catch((err) => {
        setError('An error occurred during login');
        setTimeout(() => router.push('/login'), 3000);
      });
  }, [searchParams, router, login, setAuthenticated]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="text-center">
        {error ? (
          <div className="space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-red-500/20 flex items-center justify-center">
              <span className="text-red-500 text-2xl">!</span>
            </div>
            <p className="text-white text-lg">{error}</p>
            <p className="text-gray-500 text-sm">Redirecting to login...</p>
          </div>
        ) : (
          <div className="space-y-4">
            <Loader2 className="w-12 h-12 mx-auto text-purple-500 animate-spin" />
            <p className="text-white text-lg">Completing Google sign in...</p>
          </div>
        )}
      </div>
    </div>
  );
}
