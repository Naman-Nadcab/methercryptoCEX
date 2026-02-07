'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuthStore, type User } from '@/store/auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  setAuthenticated: (user: User) => void;
  setUnauthenticated: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const AUTH_STORAGE_KEY = 'auth-storage';

function getStoredAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { accessToken?: string | null } };
    const token = parsed?.state?.accessToken;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

function mapMeResponseToUser(data: Record<string, unknown>): User {
  return {
    id: String(data.id ?? ''),
    email: data.email != null ? String(data.email) : null,
    phone: data.phone != null ? String(data.phone) : null,
    username: data.username != null ? String(data.username) : null,
    firstName: data.first_name != null ? String(data.first_name) : (data.firstName != null ? String(data.firstName) : null),
    lastName: data.last_name != null ? String(data.last_name) : (data.lastName != null ? String(data.lastName) : null),
    avatarUrl: data.avatar_url != null ? String(data.avatar_url) : (data.avatarUrl != null ? String(data.avatarUrl) : null),
    role: (data.role as User['role']) ?? 'user',
    status: (data.status as User['status']) ?? 'active',
    emailVerified: Boolean(data.email_verified ?? data.emailVerified),
    phoneVerified: Boolean(data.phone_verified ?? data.phoneVerified),
    twoFaEnabled: Boolean(data.two_fa_enabled ?? data.twoFaEnabled),
    tierLevel: Number(data.tier_level ?? data.tierLevel ?? 0),
    countryCode: data.country_code != null ? String(data.country_code) : (data.countryCode != null ? String(data.countryCode) : null),
    referralCode: data.referralCode != null ? String(data.referralCode) : (data.referral_code != null ? String(data.referral_code) : null),
    createdAt: data.created_at != null ? String(data.created_at) : (data.createdAt != null ? String(data.createdAt) : undefined),
    lastLoginAt: data.last_login_at != null ? String(data.last_login_at) : (data.lastLoginAt != null ? String(data.lastLoginAt) : null),
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUserState] = useState<User | null>(null);
  const logout = useAuthStore((s) => s.logout);

  const setAuthenticated = useCallback((u: User) => {
    setUserState(u);
    setStatus('authenticated');
  }, []);

  const setUnauthenticated = useCallback(() => {
    logout();
    setUserState(null);
    setStatus('unauthenticated');
  }, [logout]);

  useEffect(() => {
    let cancelled = false;
    const token = getStoredAccessToken();

    if (!token) {
      if (!cancelled) {
        setStatus('unauthenticated');
      }
      return;
    }

    const apiUrl = getApiBaseUrl();
    fetch(`${apiUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (cancelled) return;
        if (res.status === 401) {
          setUnauthenticated();
          return;
        }
        if (!res.ok) {
          setUnauthenticated();
          return;
        }
        return res.json();
      })
      .then((json) => {
        if (cancelled || !json?.success || !json?.data) {
          if (!cancelled && !json?.success) setUnauthenticated();
          return;
        }
        const u = mapMeResponseToUser(json.data as Record<string, unknown>);
        useAuthStore.getState().setUser(u);
        setUserState(u);
        setStatus('authenticated');
      })
      .catch(() => {
        if (!cancelled) setUnauthenticated();
      });

    return () => {
      cancelled = true;
    };
  }, [setUnauthenticated]);

  const value: AuthContextValue = {
    status,
    user,
    setAuthenticated,
    setUnauthenticated,
  };

  return (
    <AuthContext.Provider value={value}>
      {status === 'loading' ? (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#0b0e11]" role="status" aria-label="Loading">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-500 border-t-transparent" />
        </div>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
