import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UserInfo {
  id: string;
  username: string;
  name: string;
  roles: string[];
  permissions: string[];
}

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  userInfo: UserInfo | null;
  isAuthenticated: boolean;
  
  // Actions
  setToken: (token: string, refreshToken: string) => void;
  setUserInfo: (userInfo: UserInfo) => void;
  clearSession: () => void;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      refreshToken: null,
      userInfo: null,
      isAuthenticated: false,

      setToken: (token: string, refreshToken: string) => {
        localStorage.setItem('law_firm_token', token);
        localStorage.setItem('law_firm_refresh_token', refreshToken);
        set({ token, refreshToken, isAuthenticated: true });
      },

      setUserInfo: (userInfo: UserInfo) => {
        set({ userInfo });
      },

      clearSession: () => {
        localStorage.removeItem('law_firm_token');
        localStorage.removeItem('law_firm_refresh_token');
        set({ token: null, refreshToken: null, userInfo: null, isAuthenticated: false });
        localStorage.removeItem('auth-storage');
      },

      logout: () => {
        get().clearSession();
        window.location.href = '/login';
      },

      hasPermission: (permission: string) => {
        const { userInfo } = get();
        if (!userInfo) return false;
        return userInfo.permissions.includes(permission) || userInfo.roles.includes('admin');
      },

      hasAnyPermission: (permissions: string[]) => {
        const { userInfo } = get();
        if (!userInfo) return false;
        return permissions.some(p => userInfo.permissions.includes(p)) || userInfo.roles.includes('admin');
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ token: state.token, refreshToken: state.refreshToken, userInfo: state.userInfo, isAuthenticated: state.isAuthenticated }),
    }
  )
);
