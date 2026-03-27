import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions?: string[];
}

interface AdminAuthState {
  accessToken: string | null;
  admin: AdminUser | null;
  setTokens: (accessToken: string, admin: AdminUser) => void;
  logout: () => void;
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
    }),
    { name: 'admin-auth' }
  )
);
