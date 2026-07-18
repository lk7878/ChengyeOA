import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { usePasswordChangeStore } from './stores/passwordChangeStore';
import MainLayout from './components/Layout';
import Login from './pages/Login';
import PasswordChange from './pages/PasswordChange';
import Dashboard from './pages/Dashboard';
import CustomerPage from './pages/Customer';
import ContractPage from './pages/Contract';
import CasePage from './pages/Case';
import PaymentPage from './pages/Payment';
import EmployeePage from './pages/Employee';
import UserPage from './pages/User';
import RolePage from './pages/Role';
import OrganizationPage from './pages/Organization';
import PositionPage from './pages/Position';
import ProfessionalTeamPage from './pages/ProfessionalTeam';
import ChannelPage from './pages/Channel';
import LeadPage from './pages/Lead';
import ApprovalPage from './pages/Approval';
import NotificationPage from './pages/Notification';
import PerformancePage from './pages/Performance';
import SuperAdminRoute from './features/master-data/SuperAdminRoute';

// 路由守卫组件
const PrivateRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuthStore();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
};

const PasswordChangeRoute: React.FC = () => {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const token = usePasswordChangeStore((state) => state.token);
  const expiresAt = usePasswordChangeStore((state) => state.expiresAt);
  const clear = usePasswordChangeStore((state) => state.clear);
  // Route admission must reject expiry before protected UI can render.
  // eslint-disable-next-line react-hooks/purity
  const valid = Boolean(token && expiresAt && expiresAt > Date.now());

  useEffect(() => {
    if (isAuthenticated) {
      clear();
      navigate('/', { replace: true });
    } else if (!valid) {
      clear();
      navigate('/login', { replace: true });
    }
  }, [clear, isAuthenticated, navigate, valid]);

  if (isAuthenticated || !valid) return null;
  return <PasswordChange />;
};

// 包装布局的组件
const WithLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <PrivateRoute>
    <MainLayout>{children}</MainLayout>
  </PrivateRoute>
);

// 占位页面组件 - 保留用于未来扩展
const PlaceholderPage: React.FC<{ title: string }> = ({ title }) => (
  <div style={{ textAlign: 'center', padding: '100px 0' }}>
    <h2>{title}</h2>
    <p style={{ color: '#999' }}>页面开发中...</p>
  </div>
);
void PlaceholderPage;

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/password-change" element={<PasswordChangeRoute />} />
        <Route path="/" element={<WithLayout><Dashboard /></WithLayout>} />
        <Route path="/leads" element={<WithLayout><LeadPage /></WithLayout>} />
        <Route path="/customers" element={<WithLayout><CustomerPage /></WithLayout>} />
        <Route path="/contracts" element={<WithLayout><ContractPage /></WithLayout>} />
        <Route path="/cases" element={<WithLayout><CasePage /></WithLayout>} />
        <Route path="/payments" element={<WithLayout><PaymentPage /></WithLayout>} />
        <Route path="/organizations" element={<Navigate to="/org/tree" replace />} />
        <Route path="/employees" element={<Navigate to="/org/employees" replace />} />
        <Route path="/org/tree" element={<WithLayout><SuperAdminRoute><OrganizationPage /></SuperAdminRoute></WithLayout>} />
        <Route path="/org/positions" element={<WithLayout><SuperAdminRoute><PositionPage /></SuperAdminRoute></WithLayout>} />
        <Route path="/org/employees" element={<WithLayout><SuperAdminRoute><EmployeePage /></SuperAdminRoute></WithLayout>} />
        <Route path="/org/professional-teams" element={<WithLayout><SuperAdminRoute><ProfessionalTeamPage /></SuperAdminRoute></WithLayout>} />
        <Route path="/users" element={<WithLayout><UserPage /></WithLayout>} />
        <Route path="/roles" element={<WithLayout><RolePage /></WithLayout>} />
        <Route path="/channels" element={<WithLayout><ChannelPage /></WithLayout>} />
        <Route path="/approvals" element={<WithLayout><ApprovalPage /></WithLayout>} />
        <Route path="/notifications" element={<WithLayout><NotificationPage /></WithLayout>} />
        <Route path="/performances" element={<WithLayout><PerformancePage /></WithLayout>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
