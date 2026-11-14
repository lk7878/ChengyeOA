import { useEffect } from 'react';
import { authorizationApi } from '../authorization/api';
import { runtimeSession } from '../auth/runtime-session';
import { useAuthStore } from '@/stores/authStore';

/** Successful background refreshes preserve mounted forms; stale sessions never publish a result. */
export function useNavigationAuthorization() {
  const userId = useAuthStore((state) => state.userInfo?.id);
  const authenticated = useAuthStore((state) => state.isAuthenticated);
  useEffect(() => {
    if (!authenticated || !userId) return;
    let active = true,
      inflight = false;
    const refresh = async () => {
      if (!active || inflight) return;
      inflight = true;
      const token = runtimeSession.getAccessToken();
      const current = () =>
        active &&
        useAuthStore.getState().userInfo?.id === userId &&
        runtimeSession.getAccessToken() === token;
      try {
        const authorization = await authorizationApi.me();
        if (current() && authorization.userId === userId)
          useAuthStore.setState({ authorization, authorizationStatus: 'ready' });
      } catch {
        if (current()) useAuthStore.setState({ authorization: null, authorizationStatus: 'error' });
      } finally {
        inflight = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [authenticated, userId]);
}
