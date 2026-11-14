import { Navigate, useLocation } from 'react-router';

/** Keep saved bookmarks and business-record links on the single approval entry. */
export function ApprovalRedirect({ monitor = false }: { monitor?: boolean }) {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  if (monitor) params.set('role', 'MONITOR');
  return <Navigate replace to={'/approvals' + (params.size ? '?' + params.toString() : '')} />;
}
