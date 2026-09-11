import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import ChineseConfig from '../src/components/ChineseConfig';
import PayrollPanel from '../src/pages/Performance/PayrollPanel';
import FinanceWorkspace from '../src/pages/finance/FinanceWorkspace';
import { useAuthStore } from '../src/stores/authStore';
useAuthStore.setState({ hasPermission: () => true });
createRoot(document.getElementById('root')!).render(<ChineseConfig><BrowserRouter>{new URLSearchParams(location.search).has('finance') ? <FinanceWorkspace /> : <PayrollPanel />}</BrowserRouter></ChineseConfig>);
