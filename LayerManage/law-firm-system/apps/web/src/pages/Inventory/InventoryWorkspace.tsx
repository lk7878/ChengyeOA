import { Navigate, useLocation } from 'react-router';
import BusinessWorkspacePage from '@/features/crm/BusinessWorkspacePage';
import InventoryAnalyticsPage from './InventoryAnalyticsPage';
export default function InventoryWorkspace() {
  const { pathname, search } = useLocation();
  const section = pathname.split('/')[2] || 'dashboard';
  if (section === 'dashboard' || section.endsWith('statistics')) return <InventoryAnalyticsPage />;
  const params = new URLSearchParams(search);
  if (['inbound', 'outbound', 'customized-records', 'office-records'].includes(section)) {
    params.set('action', section === 'inbound' ? 'INBOUND' : 'OUTBOUND');
    if (section === 'customized-records') params.set('kind', 'CUSTOMIZED');
    if (section === 'office-records') params.set('kind', 'OFFICE');
    return <Navigate replace to={'/inventory/movements?' + params.toString()} />;
  }
  return (
    <BusinessWorkspacePage
      source={
        section === 'items'
          ? 'INVENTORY_ITEMS'
          : section === 'stocktakes'
            ? 'INVENTORY_STOCKTAKES'
            : 'INVENTORY_MOVEMENTS'
      }
    />
  );
}
