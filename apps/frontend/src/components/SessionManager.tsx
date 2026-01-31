'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';

interface SessionManagerProps {
  idleTimeout?: number; // DISABLED - no automatic logout
  redirectPath?: string;
  onLogout?: () => void;
}

/**
 * SessionManager - IMPORTANT: Automatic logout is DISABLED
 * 
 * User should NEVER be logged out automatically.
 * User stays logged in until they manually click the logout button.
 * This includes:
 * - No idle timeout logout
 * - No logout on browser close (using localStorage persistence)
 * - No logout on tab visibility change
 * - Cross-tab logout sync is kept (if user manually logs out in one tab, others follow)
 */
export default function SessionManager({
  redirectPath = '/login',
}: SessionManagerProps) {
  const router = useRouter();
  const { logout, isAuthenticated, accessToken } = useAuthStore();

  useEffect(() => {
    if (!isAuthenticated || !accessToken) return;

    // Only handle cross-tab manual logout sync
    // If user manually logs out in another tab, sync here
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'auth-storage') {
        const newValue = e.newValue ? JSON.parse(e.newValue) : null;
        if (!newValue?.state?.accessToken) {
          // Another tab manually logged out - sync this tab
          logout();
          router.push(redirectPath);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [isAuthenticated, accessToken, logout, router, redirectPath]);

  // No automatic logout - user stays logged in forever until manual logout
  return null;
}
