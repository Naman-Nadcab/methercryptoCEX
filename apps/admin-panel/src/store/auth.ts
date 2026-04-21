import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions?: string[];
}

interface AdminAuthState {
  accessToken: string | null;
  admin: AdminUser | null;
  /**
   * `_hasHydrated` flips to true once Zustand persist finishes reading localStorage.
   * Critical for avoiding a "flash of unauthenticated state" on first paint —
   * the protected layout uses this to defer the `!accessToken ⇒ /login` redirect
   * until after rehydration completes.
   */
  _hasHydrated: boolean;
  setTokens: (accessToken: string, admin: AdminUser) => void;
  logout: () => void;
  setHasHydrated: (v: boolean) => void;
}

export function hasAdminPermission(admin: AdminUser | null, permission: string): boolean {
  if (!admin) return false;
  const perms = admin.permissions;
  if (!Array.isArray(perms)) return false;
  return perms.includes(permission) || perms.includes('all');
}

export const useAdminAuthStore = create<AdminAuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      admin: null,
      _hasHydrated: false,
      setTokens: (accessToken, admin) => set({
        accessToken,
        admin: {
          id: admin.id,
          email: admin.email,
          name: admin.name,
          role: admin.role,
          permissions: Array.isArray(admin.permissions) ? admin.permissions : [],
        },
      }),
      logout: () => set({ accessToken: null, admin: null }),
      setHasHydrated: (v) => set({ _hasHydrated: v }),
    }),
    {
      name: 'admin-auth',
      /** Don't persist the hydration flag itself — it's derived state. */
      partialize: (state) => ({ accessToken: state.accessToken, admin: state.admin }),
      /** Zustand calls this once rehydration finishes; flip the flag so gated UI can decide. */
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
