import { useEffect, type ReactNode } from 'react';
import { Result, Spin } from 'antd';
import { useAuthStore } from '@/stores/authStore';
import type { PermissionCode } from './types';
import './authorization.css';

export default function PermissionRoute({
  permission,
  children,
}: {
  permission: PermissionCode;
  children: ReactNode;
}) {
  const authorizationStatus = useAuthStore(state => state.authorizationStatus);
  const ensureAuthorization = useAuthStore(state => state.ensureAuthorization);
  const allowed = useAuthStore(state => state.hasPermission(permission));

  useEffect(() => {
    if (authorizationStatus === 'idle') void ensureAuthorization().catch(() => undefined);
  }, [authorizationStatus, ensureAuthorization]);

  if (authorizationStatus === 'idle' || authorizationStatus === 'loading') {
    return <div className="permission-route-state"><Spin /></div>;
  }
  if (!allowed) return <Result status="403" title="403" />;
  return <>{children}</>;
}
