import type { ReactNode } from 'react';
import { Result } from 'antd';
import { useAuthStore } from '@/stores/authStore';

export default function SuperAdminRoute({ children }: { children: ReactNode }) {
  const allowed = useAuthStore(state => state.userInfo?.roles.includes('SYSTEM_SUPER_ADMIN') === true);
  return allowed ? <>{children}</> : <Result status="403" title="403" subTitle="无权访问此页面" />;
}
