import { useLocation } from 'react-router';
import BusinessWorkspacePage from '@/features/crm/BusinessWorkspacePage';
import InventoryAnalyticsPage from './InventoryAnalyticsPage';
import InventoryWorksheetPage from './InventoryWorksheetPage';
import { inventoryWorksheetRoutes } from './worksheet-routes';
export default function InventoryWorkspace() {
  const { pathname } = useLocation();
  const section = pathname.split('/')[2] || 'dashboard';
  if (section === 'dashboard' || section.endsWith('statistics')) return <InventoryAnalyticsPage />;
  if (inventoryWorksheetRoutes[section]) return <InventoryWorksheetPage key={section} section={section} />;
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
