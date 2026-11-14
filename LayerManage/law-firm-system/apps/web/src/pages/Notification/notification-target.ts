import { canOpen, findEntry } from '@/features/navigation/catalog';
import type { AuthorizationSummary } from '@/features/authorization/types';
import type { Notification } from '@/types';

/** Only known, authorized local routes are offered; destination APIs still authorize the record. */
export function notificationTarget(
  row: Pick<Notification, 'relatedType' | 'relatedId' | 'routeUrl'>,
  authorization: AuthorizationSummary | null,
): string | null {
  const record = row.relatedId;
  const route =
    record && row.relatedType === 'APPROVAL_INSTANCE'
      ? '/approvals?' + new URLSearchParams({ role: 'TODO', instance: record })
      : record && row.relatedType === 'ADMIN_OPERATION'
        ? '/security/admin-governance?' + new URLSearchParams({ operationId: record })
        : row.routeUrl;
  if (!route || !route.startsWith('/') || route.startsWith('//') || (route.includes('\\') || Array.from(route).some(char => char.charCodeAt(0) < 32)))
    return null;
  try {
    const url = new URL(route, 'https://oa.local');
    if (url.origin !== 'https://oa.local') return null;
    const entry = findEntry(url.pathname);
    return entry && canOpen(entry, authorization) ? url.pathname + url.search + url.hash : null;
  } catch {
    return null;
  }
}
