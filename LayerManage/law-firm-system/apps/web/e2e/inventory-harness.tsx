import { createRoot } from 'react-dom/client';
import { MemoryRouter, Link } from 'react-router';
import ChineseConfig from '../src/components/ChineseConfig';
import InventoryPage from '../src/pages/Inventory';
import { useAuthStore } from '../src/stores/authStore';
useAuthStore.setState({ hasPermission: () => true });
createRoot(document.getElementById('root')!).render(<ChineseConfig><MemoryRouter initialEntries={['/inventory/items']}><div style={{padding: 24}}><nav style={{display:'flex', gap:24}}>{[['items','库存'],['office-records','领用明细'],['stocktakes','盘点记录'],['office-statistics','领用统计'],['dashboard','仪表盘']].map(([path,label])=><Link key={path} to={'/inventory/'+path}>{label}</Link>)}</nav><InventoryPage /></div></MemoryRouter></ChineseConfig>);
