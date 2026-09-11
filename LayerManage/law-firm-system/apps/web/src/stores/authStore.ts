import { create } from 'zustand';
import { authApi } from '@/api/auth';
import { runtimeSession } from '@/features/auth/runtime-session';
import type { AuthenticatedData } from '@/features/auth/types';
import { authorizationApi, isAuthorizationSummaryExpired } from '@/features/authorization/api';
import type { AuthorizationSummary, PermissionCode } from '@/features/authorization/types';

export interface UserInfo {
  id: string;
  username: string;
  name: string;
  roles?: string[];
  permissions?: string[];
}

type AuthorizationStatus = 'idle' | 'loading' | 'ready' | 'error';
type BootstrapStatus = 'idle' | 'loading' | 'ready';
let authorizationRequest: Promise<void> | null = null;
let bootstrapRequest: Promise<void> | null = null;

interface AuthState {
  userInfo: UserInfo | null;
  isAuthenticated: boolean;
  bootstrapStatus: BootstrapStatus;
  authorization: AuthorizationSummary | null;
  authorizationStatus: AuthorizationStatus;
  setAuthenticated: (data: AuthenticatedData) => void;
  setUserInfo: (userInfo: UserInfo) => void;
  bootstrap: () => Promise<void>;
  clearSession: () => void;
  logout: () => void;
  ensureAuthorization: (force?: boolean) => Promise<void>;
  hasPermission: (permission: PermissionCode) => boolean;
  hasAnyPermission: (permissions: PermissionCode[]) => boolean;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  userInfo: null,
  isAuthenticated: false,
  bootstrapStatus: 'idle',
  authorization: null,
  authorizationStatus: 'idle',

  setAuthenticated: data => {
    runtimeSession.setAuthenticated(data);
    set({
      userInfo: data.user,
      isAuthenticated: true,
      bootstrapStatus: 'ready',
      authorization: null,
      authorizationStatus: 'idle',
    });
  },

  setUserInfo: userInfo => set({ userInfo }),

  bootstrap: async () => {
    if (get().bootstrapStatus === 'ready') return;
    if (bootstrapRequest) return bootstrapRequest;
    set({ bootstrapStatus: 'loading' });
    bootstrapRequest = runtimeSession.refreshOnce()
      .then(() => authApi.me())
      .then(response => {
        set({ userInfo: response.data, isAuthenticated: true, bootstrapStatus: 'ready' });
      })
      .catch(() => {
        runtimeSession.clear();
        set({ userInfo: null, isAuthenticated: false, bootstrapStatus: 'ready' });
      })
      .finally(() => { bootstrapRequest = null; });
    return bootstrapRequest;
  },

  clearSession: () => {
    runtimeSession.clear();
    authorizationRequest = null;
    set({
      userInfo: null,
      isAuthenticated: false,
      bootstrapStatus: 'ready',
      authorization: null,
      authorizationStatus: 'idle',
    });
  },

  logout: () => {
    get().clearSession();
    window.location.href = '/login';
  },

  ensureAuthorization: async (force = false) => {
    if (!get().isAuthenticated) return;
    const current = get().authorization;
    if (!force && !isAuthorizationSummaryExpired(current)) {
      if (get().authorizationStatus !== 'ready') set({ authorizationStatus: 'ready' });
      return;
    }
    if (authorizationRequest) return authorizationRequest;
    set({ authorizationStatus: 'loading' });
    const requestPromise: Promise<void> = authorizationApi.me()
      .then(authorization => { set({ authorization, authorizationStatus: 'ready' }); })
      .catch(error => {
        set({ authorization: null, authorizationStatus: 'error' });
        throw error;
      })
      .finally(() => { authorizationRequest = null; });
    authorizationRequest = requestPromise;
    return requestPromise;
  },

  hasPermission: permission => {
    const { authorization } = get();
    return !isAuthorizationSummaryExpired(authorization)
      && authorization!.permissions.includes(permission);
  },

  hasAnyPermission: permissions => {
    const { authorization } = get();
    return !isAuthorizationSummaryExpired(authorization)
      && permissions.some(permission => authorization!.permissions.includes(permission));
  },
}));
