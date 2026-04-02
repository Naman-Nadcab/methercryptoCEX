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

/** If persist + /me never resolve, still mount the app (no infinite blank / spinner). */
const AUTH_SHELL_FAIL_OPEN_MS = 4500;

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
  const authReadyWarned = useRef(false);
  const logout = useAuthStore((s) => s.logout);
  const setAuthResolved = useAuthStore((s) => s.setAuthResolved);
  const setAuthFlags = useAuthStore((s) => s.setAuthFlags);
  const setUser = useAuthStore((s) => s.setUser);
  const authFlags = useAuthStore((s) => s.authFlags);
  const authResolved = useAuthStore((s) => s.authResolved);
  const _hasHydrated = useAuthStore((s) => s._hasHydrated);
  const meCalled = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      console.log('[AuthProvider] rendered (mount)');
    }
  }, []);

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
    if (typeof window === 'undefined') return;
    const handleRefreshFailed = () => setUnauthenticated();
    window.addEventListener('auth:refresh-failed', handleRefreshFailed);
    return () => window.removeEventListener('auth:refresh-failed', handleRefreshFailed);
  }, [setUnauthenticated]);

  /** Last-resort: never block the full tree past this deadline (SRE / production resilience). */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const id = window.setTimeout(() => {
      const st = useAuthStore.getState();
      if (!st._hasHydrated) {
        st.setHasHydrated(true);
      }
      if (!st.authResolved) {
        st.setAuthResolved(true);
      }
      const u = st.user ?? null;
      setUserState(u);
      setStatus((prev) => {
        if (prev !== 'loading') return prev;
        if (u && st.accessToken) return 'authenticated';
        return 'unauthenticated';
      });
    }, AUTH_SHELL_FAIL_OPEN_MS);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !_hasHydrated) return;
    isMountedRef.current = true;
    const controller = new AbortController();
    const AUTH_ME_TIMEOUT_MS = 3000;
    const FALLBACK_RESOLVE_MS = 4000;
    const timeoutId = setTimeout(() => {
      if (!isMountedRef.current) return;
      controller.abort();
      setAuthResolved(true);
      setAuthFlags(0);
      setUnauthenticated();
    }, AUTH_ME_TIMEOUT_MS);
    const fallbackId = setTimeout(() => {
      if (!isMountedRef.current) return;
      if (!useAuthStore.getState().authResolved) {
        setAuthResolved(true);
        setAuthFlags(0);
        setUnauthenticated();
      }
    }, FALLBACK_RESOLVE_MS);

    const apiUrl = getApiBaseUrl();

    const runMe = async () => {
      const clearAuthTimeout = () => clearTimeout(timeoutId);
      const safeSet = (fn: () => void) => {
        if (isMountedRef.current) fn();
      };
      const stored = getStoredAccessToken();
      const fromStore = useAuthStore.getState().accessToken;
      let token = (typeof stored === 'string' && stored.length > 0) ? stored : (typeof fromStore === 'string' && fromStore.length > 0 ? fromStore : null);

      // No token and no refresh token → not logged in; resolve immediately without calling /me (avoids 401 and long wait)
      if (!token && !getStoredRefreshToken()) {
        clearTimeout(timeoutId);
        clearTimeout(fallbackId);
        safeSet(() => {
          setAuthResolved(true);
          setAuthFlags(0);
          setUnauthenticated();
        });
        return;
      }

      if (process.env.NODE_ENV === 'development' && token) {
        console.warn('[Auth] token before /me:', token.slice(0, 12) + '...');
      }
      try {
        let res = await fetch(`${apiUrl}/api/v1/auth/me`, {
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            ...(token && { Authorization: `Bearer ${token}` }),
          },
        });
        if (process.env.NODE_ENV === 'development') {
          console.warn('[Auth] /me response:', res.status, res.statusText);
        }
        if (res.status === 401 && token) {
          const newToken = await tryRefreshFromStorage();
          const freshToken = newToken ?? getStoredAccessToken();
          if (freshToken) {
            token = freshToken;
            res = await fetch(`${apiUrl}/api/v1/auth/me`, {
              signal: controller.signal,
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            });
          }
        }
        if (!isMountedRef.current) return;
        if (res.status === 401 || res.status === 403) {
          if (process.env.NODE_ENV === 'development') {
            console.warn('[Auth] /me 401 or 403 — setting unauthenticated');
          }
          clearAuthTimeout();
          safeSet(() => {
            setAuthResolved(true);
            setAuthFlags(0);
            setUnauthenticated();
          });
          return;
        }
        if (!res.ok) {
          clearAuthTimeout();
          safeSet(() => {
            setAuthResolved(true);
            const existingUser = useAuthStore.getState().user;
            if (existingUser) {
              setUserState(existingUser);
              setStatus('authenticated');
            } else {
              setAuthFlags(0);
              setUnauthenticated();
            }
          });
          return;
        }
        const json = await res.json();
        if (process.env.NODE_ENV === 'development') {
          console.warn('[Auth] /me body:', json?.success ? 'success' : 'no success', json?.data ? 'has data' : 'no data');
        }
        if (!isMountedRef.current) return;
        clearAuthTimeout();
        safeSet(() => {
          setAuthResolved(true);
          if (json?.success && json?.data) {
            const u = mapMeResponseToUser(json.data as Record<string, unknown>);
            setUser(u);
            setUserState(u);
            setStatus('authenticated');
            setAuthFlags(typeof json.data.auth_flags === 'number' ? json.data.auth_flags : 1);
          } else {
            setAuthFlags(0);
            setUnauthenticated();
          }
        });
      } catch (e) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[Auth] /me catch:', (e as Error).name, (e as Error).message);
        }
        clearAuthTimeout();
        if (!isMountedRef.current) return;
        if ((e as Error).name === 'AbortError') {
          safeSet(() => {
            setAuthResolved(true);
            setAuthFlags(0);
            setUnauthenticated();
          });
          return;
        }
        safeSet(() => {
          setAuthResolved(true);
          const existingUser = useAuthStore.getState().user;
          if (existingUser) {
            setUserState(existingUser);
            setStatus('authenticated');
          } else {
            setAuthFlags(0);
            setUnauthenticated();
          }
        });
      }
    };
    runMe();
    return () => {
      isMountedRef.current = false;
      clearTimeout(timeoutId);
      clearTimeout(fallbackId);
      meCalled.current = false;
    };
  }, [_hasHydrated]);

  const isAuthenticated = status === 'authenticated';
  const authShellReady = _hasHydrated && authResolved;

  useEffect(() => {
    if (typeof window === 'undefined' || authShellReady || authReadyWarned.current) return;
    authReadyWarned.current = true;
    console.warn('[AuthProvider] Auth not ready — fail-open (rendering children; use useAuth() defensively)');
  }, [authShellReady]);

  const value: AuthContextValue = {
    status,
    user,
    authResolved,
    isAuthenticated,
    setAuthenticated,
    setUnauthenticated,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
