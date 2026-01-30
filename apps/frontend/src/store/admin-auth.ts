import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
}

interface AdminAuthState {
  admin: AdminUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  _hasHydrated: boolean;
  
  // Actions
  setAdmin: (admin: AdminUser | null) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  login: (admin: AdminUser, accessToken: string, refreshToken: string) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
  setHasHydrated: (state: boolean) => void;
}

export const useAdminAuthStore = create<AdminAuthState>()(
  persist(
    (set) => ({
      admin: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: true,
      _hasHydrated: false,

      setAdmin: (admin) => set({ admin, isAuthenticated: !!admin }),

      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),

      login: (admin, accessToken, refreshToken) => set({
        admin,
        accessToken,
        refreshToken,
        isAuthenticated: true,
        isLoading: false,
      }),

      logout: () => set({
        admin: null,
        accessToken: null,
        refreshToken: null,
        isAuthenticated: false,
      }),

      setLoading: (isLoading) => set({ isLoading }),
      
      setHasHydrated: (state) => set({ _hasHydrated: state }),
    }),
    {
      name: 'admin-auth-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        admin: state.admin,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
