'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminAuthStore } from '@/store/admin-auth';

interface AdminSessionManagerProps {
  idleTimeout?: number; // in milliseconds, default 30 minutes
}

const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const ACTIVITY_EVENTS = [
  'mousedown',
  'mousemove',
  'keydown',
  'scroll',
  'touchstart',
  'click',
];

export default function AdminSessionManager({
  idleTimeout = IDLE_TIMEOUT,
}: AdminSessionManagerProps) {
  const router = useRouter();
  const { logout, isAuthenticated, accessToken } = useAdminAuthStore();
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  const handleLogout = useCallback(() => {
    // Clear the idle timer
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }

    // Clear session flag
    sessionStorage.removeItem('admin_session_active');

    logout();
    router.push('/admin/login');
  }, [logout, router]);

  const resetIdleTimer = useCallback(() => {
    lastActivityRef.current = Date.now();

    // Clear existing timer
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }

    // Set new timer
    idleTimerRef.current = setTimeout(() => {
      console.log('Admin session expired due to inactivity');
      handleLogout();
    }, idleTimeout);
  }, [idleTimeout, handleLogout]);

  useEffect(() => {
    if (!isAuthenticated || !accessToken) return;

    // Mark session as active
    sessionStorage.setItem('admin_session_active', 'true');

    // Initialize idle timer
    resetIdleTimer();

    // Add activity listeners
    const handleActivity = () => {
      resetIdleTimer();
    };

    ACTIVITY_EVENTS.forEach((event) => {
      document.addEventListener(event, handleActivity, { passive: true });
    });

    // Handle visibility change (tab switch)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Check if idle timeout exceeded while tab was hidden
        const timeSinceLastActivity = Date.now() - lastActivityRef.current;
        if (timeSinceLastActivity >= idleTimeout) {
          handleLogout();
          return;
        }

        // Reset timer when tab becomes visible
        resetIdleTimer();
      }
    };

    // Handle storage events (cross-tab logout)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key !== 'admin-auth-storage') return;
      try {
        const newValue = e.newValue ? JSON.parse(e.newValue) : null;
        if (!newValue?.state?.accessToken) {
          handleLogout();
        }
      } catch {
        // Ignore malformed storage data
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('storage', handleStorageChange);

    // Cleanup
    return () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }

      ACTIVITY_EVENTS.forEach((event) => {
        document.removeEventListener(event, handleActivity);
      });

      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [isAuthenticated, accessToken, idleTimeout, resetIdleTimer, handleLogout]);

  return null; // This component doesn't render anything
}
