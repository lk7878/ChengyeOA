import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router';
import ChineseConfig from '../src/components/ChineseConfig';
import MainLayout from '../src/components/Layout';
import IntelligencePage from '../src/pages/Intelligence';
import SmartCaseLauncher from '../src/pages/Intelligence/SmartCaseLauncher';
import CaseWorkbench from '../src/components/CaseWorkbench';
import { useAuthStore } from '../src/stores/authStore';
import DesktopKnowledgeBridge from '../src/features/intelligence/DesktopKnowledgeBridge';
import { runtimeSession } from '../src/features/auth/runtime-session';
const query = new URLSearchParams(location.search);
useAuthStore.setState({ isAuthenticated: true, userInfo: { id: 'intelligence-browser-test', username: 'test', name: '测试律师' }, authorization: { userId: 'intelligence-browser-test', employeeId: null, isSystemSuperAdmin: query.has('admin'), isSystemAdmin: false, permissions: [], menus: ['menu.knowledge', 'menu.smart_case'], fieldCapabilities: {}, evaluatedAt: new Date().toISOString(), validUntil: null }, authorizationStatus: 'ready' });
// The isolated desktop test injects ephemeral credentials in sessionStorage before navigation.
if (query.has('desktop-test')) {
  const credentials = sessionStorage.getItem('desktop-test-credentials');
  if (credentials) {
    const { userId, ...tokens } = JSON.parse(credentials);
    runtimeSession.setAuthenticated(tokens);
    useAuthStore.setState({ userInfo: { id: userId, username: 'test', name: '测试律师' }, authorization: { ...useAuthStore.getState().authorization!, userId, permissions: ['menu.knowledge', 'menu.smart_case'] } });
    sessionStorage.removeItem('desktop-test-credentials');
  }
}
createRoot(document.getElementById('root')!).render(<ChineseConfig><MemoryRouter initialEntries={[query.has('case') ? '/smart-case' : '/knowledge']}><DesktopKnowledgeBridge /><CaseWorkbench /><MainLayout><Routes><Route path="/smart-case" element={<SmartCaseLauncher />} /><Route path="/knowledge" element={<IntelligencePage feature="knowledge" />} /></Routes></MainLayout></MemoryRouter></ChineseConfig>);
