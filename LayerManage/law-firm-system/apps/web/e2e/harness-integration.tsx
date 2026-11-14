import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router';
import ChineseConfig from '../src/components/ChineseConfig';
import MainLayout from '../src/components/Layout';
import HarnessPage from '../src/pages/Harness';
import { useAuthStore } from '../src/stores/authStore';
useAuthStore.setState({authorization:{userId:'browser-test',employeeId:null,isSystemSuperAdmin:false,isSystemAdmin:false,permissions:[],menus:['menu.knowledge','menu.smart_case'],fieldCapabilities:{},evaluatedAt:new Date().toISOString(),validUntil:null},authorizationStatus:'ready'});
createRoot(document.getElementById('root')!).render(<ChineseConfig><MemoryRouter initialEntries={['/smart-case']}><MainLayout><Routes><Route path="/smart-case" element={<HarnessPage key="smart" feature="smart-case" />} /><Route path="/knowledge" element={<HarnessPage key="wiki" feature="knowledge" />} /></Routes></MainLayout></MemoryRouter></ChineseConfig>);
