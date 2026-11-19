import { useEffect } from 'react';
import { isTransientRequestError } from '@/api/transient-error';
import { authorizationApi, isAuthorizationSummaryExpired } from '../authorization/api';
import { runtimeSession } from '../auth/runtime-session';
import { useAuthStore } from '@/stores/authStore';

/** Successful background refreshes preserve mounted forms; stale sessions never publish a result. */
export function useNavigationAuthorization(inDrive: boolean) {
  const userId = useAuthStore((state) => state.userInfo?.id);
  const authenticated = useAuthStore((state) => state.isAuthenticated);
  useEffect(() => {
    if (!authenticated || !userId) return;
    let active = true,
      inflight = false;
    let lastVerified = 0;
    let expiryTimer: number | undefined;
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
        if (current() && authorization.userId === userId) {
          clearTimeout(expiryTimer);
          lastVerified = Date.now();
          useAuthStore.setState({ authorization, authorizationStatus: 'ready' });
        }
      } catch (error) {
        if (!current()) return;
        const { authorization } = useAuthStore.getState();
        const deadline = Math.min(lastVerified + 30000, authorization?.validUntil ? Date.parse(authorization.validUntil) : Infinity);
        if (inDrive && authorization?.userId === userId && !isAuthorizationSummaryExpired(authorization)
          && isTransientRequestError(error) && Date.now() < deadline) {
          clearTimeout(expiryTimer);
          expiryTimer = window.setTimeout(() => {
            if (current() && useAuthStore.getState().authorization === authorization)
              useAuthStore.setState({ authorization: null, authorizationStatus: 'error' });
          }, deadline - Date.now());
        } else {
          clearTimeout(expiryTimer);
          useAuthStore.setState({ authorization: null, authorizationStatus: 'error' });
        }
      } finally {
        inflight = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      active = false;
      clearInterval(timer);
      clearTimeout(expiryTimer);
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [authenticated, userId, inDrive]);
}
