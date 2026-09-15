import IntelligencePage from './pages/Intelligence';
import DesktopKnowledgeBridge from './features/intelligence/DesktopKnowledgeBridge';
import SmartCaseLauncher from './pages/Intelligence/SmartCaseLauncher';
import CaseWorkbench from './components/CaseWorkbench';
import ChineseConfig from './components/ChineseConfig';
import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { Spin } from 'antd';
import { useAuthStore } from './stores/authStore';
import { useChallengeStore } from './features/auth/challengeStore';
import type { PermissionCode } from './features/authorization/types';
import PermissionRoute from './features/authorization/PermissionRoute';
import MainLayout from './components/Layout';
import Login from './pages/Login';
import PasswordChange from './pages/PasswordChange';
import Dashboard from './pages/Dashboard';
import AreaPage from './features/navigation/AreaPage';
import { legacyRedirects } from './features/navigation/catalog';
import WorkspacesPage from './pages/Workspaces';
import BusinessWorkspacePage from './features/crm/BusinessWorkspacePage';
import LeadDetailPage from './pages/leads/LeadDetailPage';
import PublicPoolPage from './pages/leads/PublicPoolPage';
import VisitCalendarPage from './pages/leads/VisitCalendarPage';
import CustomerCreatePage, { CustomerWorkspacePage } from './pages/customers/CustomerCreatePage';
import CustomerDetailPage from './pages/customers/CustomerDetailPage';
import NegotiationRecordPage from './pages/negotiations/NegotiationRecordPage';

import ContractDetailPage from './pages/contracts/ContractDetailPage';
import ContractCreatePage from './pages/contracts/ContractCreatePage';
import FinanceWorkspace, { FinanceTablePage } from './pages/finance/FinanceWorkspace';
import FinanceRecordPage from './pages/finance/FinanceRecordPage';
import ApprovalLedger from './pages/approvals/ApprovalLedger';

import AnomalyListPage from './pages/anomalies/AnomalyListPage';
import CaseWorkspacePage from './pages/Case/CaseWorkspacePage';
import CaseRecordPage from './pages/Case/CaseRecordPage';
import EmployeePage from './pages/Employee';
import UserPage from './pages/User';
import SecurityRolePage from './pages/SecurityRole';
import SecurityUserPage from './pages/SecurityUser';
import PermissionTracePage from './pages/PermissionTrace';
import MyAccessPage from './pages/MyAccess';
import AdminGovernancePage from './pages/AdminGovernance';
import EventOperationsPage from './pages/EventOperations';
import SecuritySettingsPage from './pages/SecuritySettings';
import OrganizationPage from './pages/Organization';
import PositionPage from './pages/Position';
import ProfessionalTeamPage from './pages/ProfessionalTeam';
import ChannelPage from './pages/Channel';
import ApprovalCenterPage from './pages/approvals/ApprovalCenterPage';
import NotificationPage from './pages/Notification';
import PerformancePage from './pages/Performance';
import InventoryPage from './pages/Inventory';

const PrivateRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
};

const LoginRoute: React.FC = () => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return isAuthenticated ? <Navigate to="/" replace /> : <Login />;
};

const PasswordChangeRoute: React.FC = () => {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const kind = useChallengeStore((state) => state.kind);
  const token = useChallengeStore((state) => state.token);
  const expiresAt = useChallengeStore((state) => state.expiresAt);
  const clear = useChallengeStore((state) => state.clear);
  // eslint-disable-next-line react-hooks/purity
  const valid = Boolean(kind === 'PASSWORD_CHANGE' && token && expiresAt && expiresAt > Date.now());

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

const AuthorizedPage: React.FC<{ permission: PermissionCode; children: React.ReactNode }> = ({
  permission,
  children,
}) => <PermissionRoute permission={permission}>{children}</PermissionRoute>;

function LegacyRedirect() {
  const location = useLocation();
  return (
    <Navigate to={(legacyRedirects[location.pathname] || '/') + location.search + location.hash} replace />
  );
}

function App() {
  return (
    <ChineseConfig>
      <BrowserRouter>
        <DesktopKnowledgeBridge />
        <SessionBootstrap />
      </BrowserRouter>
    </ChineseConfig>
  );
}

function SessionBootstrap() {
  const bootstrapStatus = useAuthStore((state) => state.bootstrapStatus);
  const bootstrap = useAuthStore((state) => state.bootstrap);

  useEffect(() => {
    if (bootstrapStatus === 'idle') void bootstrap();
  }, [bootstrap, bootstrapStatus]);

  if (bootstrapStatus !== 'ready') {
    return (
      <div aria-label="正在恢复会话" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <>
      <CaseWorkbench />
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/password-change" element={<PasswordChangeRoute />} />
        <Route
          element={
            <PrivateRoute>
              <MainLayout>
                <Outlet />
              </MainLayout>
            </PrivateRoute>
          }
        >
          <Route path="/" element={<AreaPage area="home" />} />
          <Route path="/apps" element={<AreaPage key="apps" area="apps" />} />
          <Route path="/analytics" element={<AreaPage key="analytics" area="analytics" />} />
          <Route path="/analytics/overview" element={<Dashboard />} />
          <Route path="/admin" element={<AreaPage key="admin" area="admin" />} />
          <Route path="/workspaces" element={<WorkspacesPage />} />
          <Route
            path="/leads"
            element={
              <AuthorizedPage permission="menu.lead_crm">
                <BusinessWorkspacePage />
              </AuthorizedPage>
            }
          />
          <Route
            path="/leads/pool"
            element={
              <AuthorizedPage permission="menu.lead_crm">
                <PublicPoolPage />
              </AuthorizedPage>
            }
          />
          <Route
            path="/leads/follows"
            element={
              <AuthorizedPage permission="menu.lead_crm">
                <BusinessWorkspacePage source="FOLLOWS" />
              </AuthorizedPage>
            }
          />
          <Route
            path="/leads/calendar"
            element={
              <AuthorizedPage permission="menu.lead_crm">
                <VisitCalendarPage />
              </AuthorizedPage>
            }
          />
          <Route
            path="/leads/:id"
            element={
              <AuthorizedPage permission="menu.lead_crm">
                <LeadDetailPage />
              </AuthorizedPage>
            }
          />
          <Route
            path="/customers"
            element={
              <AuthorizedPage permission="menu.customer">
                <CustomerWorkspacePage />
              </AuthorizedPage>
            }
          />
          <Route
            path="/customers/new"
            element={
              <AuthorizedPage permission="menu.customer">
                <CustomerCreatePage />
              </AuthorizedPage>
            }
          />
          <Route
            path="/negotiations/new"
            element={
              <AuthorizedPage permission="menu.contract">
                <NegotiationRecordPage />
              </AuthorizedPage>
            }
          />
          <Route
            path="/negotiations/:id"
            element={
              <AuthorizedPage permission="menu.contract">
                <NegotiationRecordPage />
              </AuthorizedPage>
            }
          />
          <Route
            path="/customers/:id"
            element={
              <AuthorizedPage permission="menu.customer">
                <CustomerDetailPage />
              </AuthorizedPage>
            }
          />
          <Route
            path="/negotiations"
            element={
              <AuthorizedPage permission="menu.contract">
                <BusinessWorkspacePage source="NEGOTIATIONS" />
              </AuthorizedPage>
            }
          />
          <Route
            path="/contracts"
            element={
              <AuthorizedPage permission="menu.contract">
                <BusinessWorkspacePage source="CONTRACTS" />
              </AuthorizedPage>
            }
          />
          <Route
            path="/contracts/new"
            element={
              <AuthorizedPage permission="menu.contract">
                <ContractCreatePage />
              </AuthorizedPage>
            }
          />
          <Route
            path="/contracts/:id"
            element={
              <AuthorizedPage permission="menu.contract">
                <ContractDetailPage />
              </AuthorizedPage>
            }
          />
          <Route path="/cases" element={<CaseWorkspacePage />} />
          <Route path="/cases/new" element={<CaseRecordPage />} />
          <Route path="/cases/:id" element={<CaseRecordPage />} />
          <Route
            path="/payments"
            element={
              <AuthorizedPage permission="menu.payment">
                <FinanceTablePage source="PAYMENTS" />
              </AuthorizedPage>
            }
          />
          <Route
            path="/invoices"
            element={
              <AuthorizedPage permission="menu.invoice">
                <FinanceTablePage source="INVOICES" />
              </AuthorizedPage>
            }
          />
          <Route
            path="/refunds"
            element={
              <AuthorizedPage permission="menu.refund">
                <FinanceTablePage source="REFUNDS" />
              </AuthorizedPage>
            }
          />
          <Route
            path="/costs"
            element={
              <AuthorizedPage permission="menu.cost">
                <FinanceTablePage source="COSTS" />
              </AuthorizedPage>
            }
          />
          <Route
            path="/anomalies"
            element={
              <AuthorizedPage permission="menu.anomaly">
                <AnomalyListPage />
              </AuthorizedPage>
            }
          />
          <Route path="/organizations" element={<LegacyRedirect />} />
          <Route path="/employees" element={<LegacyRedirect />} />
          <Route
            path="/org/tree"
            element={
              <AuthorizedPage permission="organization.read">
                <OrganizationPage />
              </AuthorizedPage>
            }
          />
          <Route
            path="/org/positions"
            element={
              <AuthorizedPage permission="position.read">
                <PositionPage />
              </AuthorizedPage>
            }
          />
          <Route
            path="/org/employees"
            element={
              <AuthorizedPage permission="employee.read">
                <EmployeePage />
              </AuthorizedPage>
            }
          />
          <Route
            path="/org/professional-teams"
            element={
              <AuthorizedPage permission="professional_team.read">
                <ProfessionalTeamPage />
              </AuthorizedPage>
            }
          />
          <Route
            path="/users"
            element={
              <AuthorizedPage permission="user.read">
                <UserPage />
              </AuthorizedPage>
            }
          />
          <Route path="/roles" element={<LegacyRedirect />} />
          <Route
            path="/security/roles"
            element={
              <AuthorizedPage permission="role.read">
                <SecurityRolePage />
              </AuthorizedPage>
            }
          />
          <Route
            path="/security/users"
            element={
              <AuthorizedPage permission="user.read">
                <SecurityUserPage />
              </AuthorizedPage>
            }
          />
          <Route
            path="/security/trace"
            element={
              <AuthorizedPage permission="permission.trace.any">
                <PermissionTracePage />
              </AuthorizedPage>
            }
          />
          <Route
            path="/security/my-access"
            element={
              <AuthorizedPage permission="permission.trace.self">
                <MyAccessPage />
              </AuthorizedPage>
            }
          />
          <Route
            path="/security/admin-governance"
            element={
              <AuthorizedPage permission="governance.catalog.read">
                <AdminGovernancePage />
              </AuthorizedPage>
            }
          />
          <Route
            path="/security/event-operations"
            element={
              <AuthorizedPage permission="event.delivery.read">
                <EventOperationsPage />
              </AuthorizedPage>
            }
          />
          <Route path="/security/account" element={<SecuritySettingsPage />} />
          <Route path="/channels" element={<ChannelPage />} />
          <Route
            path="/approval-ledger"
            element={
              <AuthorizedPage permission="approval.read">
                <ApprovalLedger />
              </AuthorizedPage>
            }
          />
          <Route
            path="/knowledge"
            element={
              <AuthorizedPage permission="menu.knowledge">
                <IntelligencePage key="knowledge" feature="knowledge" />
              </AuthorizedPage>
            }
          />
          <Route
            path="/smart-case"
            element={
              <AuthorizedPage permission="menu.smart_case">
                <SmartCaseLauncher />
              </AuthorizedPage>
            }
          />
          <Route
            path="/inventory/*"
            element={
              <AuthorizedPage permission="menu.inventory">
                <InventoryPage />
              </AuthorizedPage>
            }
          />
          <Route path="/finance" element={<FinanceWorkspace />} />
          <Route path="/payments/new" element={<FinanceRecordPage kind="payment" />} />
          <Route path="/payments/:id" element={<FinanceRecordPage kind="payment" />} />
          <Route path="/invoices/new" element={<FinanceRecordPage kind="invoice" />} />
          <Route path="/invoices/:id" element={<FinanceRecordPage kind="invoice" />} />
          <Route path="/refunds/new" element={<FinanceRecordPage kind="refund" />} />
          <Route path="/refunds/:id" element={<FinanceRecordPage kind="refund" />} />
          <Route path="/costs/new" element={<FinanceRecordPage kind="cost" />} />
          <Route path="/costs/:id" element={<FinanceRecordPage kind="cost" />} />

          <Route
            path="/approvals"
            element={
              <AuthorizedPage permission="approval.read">
                <ApprovalCenterPage />
              </AuthorizedPage>
            }
          />
          <Route path="/notifications" element={<NotificationPage />} />
          <Route path="/performances" element={<PerformancePage />} />
          <Route path="*" element={null} />
        </Route>
      </Routes>
    </>
  );
}

export default App;
