'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuthStore, type User } from '@/store/auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  authResolved: boolean;
  isAuthenticated: boolean;
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

function getStoredRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { refreshToken?: string | null } };
    const token = parsed?.state?.refreshToken;
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

async function tryRefreshFromStorage(): Promise<string | null> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return null;
  const apiUrl = getApiBaseUrl();
  try {
    const res = await fetch(`${apiUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.success && data?.data?.accessToken) {
      const { setTokens } = useAuthStore.getState();
      setTokens(data.data.accessToken, data.data.refreshToken ?? refreshToken);
      return data.data.accessToken;
    }
  } catch (_) {}
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUserState] = useState<User | null>(null);
  const logout = useAuthStore((s) => s.logout);
  const setAuthResolved = useAuthStore((s) => s.setAuthResolved);
  const setAuthFlags = useAuthStore((s) => s.setAuthFlags);
  const setUser = useAuthStore((s) => s.setUser);
  const authFlags = useAuthStore((s) => s.authFlags);
  const authResolved = useAuthStore((s) => s.authResolved);
  const _hasHydrated = useAuthStore((s) => s._hasHydrated);
  const meCalled = useRef(false);

  const setAuthenticated = useCallback((u: User) => {
    setAuthResolved(true);
    setAuthFlags(1);
    setUserState(u);
    setStatus('authenticated');
  }, [setAuthResolved, setAuthFlags]);

  const setUnauthenticated = useCallback(() => {
    setAuthFlags(0);
    logout();
    setUserState(null);
    setStatus('unauthenticated');
  }, [logout, setAuthFlags]);

  useEffect(() => {
    if (!_hasHydrated || meCalled.current) return;
    meCalled.current = true;
    const controller = new AbortController();

    const apiUrl = getApiBaseUrl();

    const runMe = async () => {
      let token = getStoredAccessToken();
      try {
        let res = await fetch(`${apiUrl}/api/v1/auth/me`, {
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            ...(token && { Authorization: `Bearer ${token}` }),
          },
        });
        if (res.status === 401 && token) {
          const newToken = await tryRefreshFromStorage();
          if (newToken) {
            token = newToken;
            res = await fetch(`${apiUrl}/api/v1/auth/me`, {
              signal: controller.signal,
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            });
          }
        }
        if (res.status === 401 || !res.ok) {
          setAuthResolved(true);
          setAuthFlags(0);
          setUnauthenticated();
          return;
        }
        const json = await res.json();
        setAuthResolved(true);
        if (json?.success && json?.data) {
          const flags = typeof json.data.auth_flags === 'number' ? json.data.auth_flags : 0;
          setAuthFlags(flags);
          if (flags > 0) {
            const u = mapMeResponseToUser(json.data as Record<string, unknown>);
            setUser(u);
            setUserState(u);
            setStatus('authenticated');
          } else {
            setUnauthenticated();
          }
        } else {
          setAuthFlags(0);
          setUnauthenticated();
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setAuthResolved(true);
        setAuthFlags(0);
        setUnauthenticated();
      }
    };
    runMe();
    return () => {
      controller.abort();
      meCalled.current = false;
    };
  }, [_hasHydrated, setAuthResolved, setAuthFlags, setUnauthenticated, setUser]);

  const isAuthenticated = authFlags > 0;
  const showChildren = _hasHydrated && authResolved;

  const value: AuthContextValue = {
    status,
    user,
    authResolved,
    isAuthenticated,
    setAuthenticated,
    setUnauthenticated,
  };

  return (
    <AuthContext.Provider value={value}>
      {!showChildren ? (
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
