import NavigationManagement from './pages/NavigationManagement';
import RetiredArchives from './pages/RetiredArchives';
import { inPreviewFrame } from './features/authorization/preview-frame';
import AnalyticsDesigner from './pages/AnalyticsDesigner';
import {AssessmentPage,AnalysisPage,QualityMetricsPage} from './pages/Quality/AnalysisPages';
import {QualityRulesPage,QualityRunsPage,QualityRunPage,QualityInspectionPage,QualityIssuePage} from './pages/Quality';
import SopSubmissionPage from './pages/SopExecution/SubmissionPage';
import SopTaskPage from './pages/SopExecution/TaskPage';
import SopInstancePage from './pages/SopExecution/InstancePage';
import SopTemplatesPage from './pages/SopTemplates';
import RecordAccessBoundary from './features/crm/RecordAccessBoundary';
import IntelligencePage from './pages/Intelligence';
import DesktopKnowledgeBridge from './features/intelligence/DesktopKnowledgeBridge';
import SmartCaseLauncher from './pages/Intelligence/SmartCaseLauncher';
import CaseWorkbench from './components/CaseWorkbench';
import ChineseConfig from './components/ChineseConfig';
import AppearanceProvider from './features/appearance/AppearanceProvider';
import React, { useEffect } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router';
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
import { ApprovalRedirect } from './pages/approvals/ApprovalEntry';

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
import ChannelCreatePage from './pages/Channel/ChannelCreatePage';
import ChannelRecordPage from './pages/Channel/ChannelRecordPage';
import VisualApprovals from './pages/approvals/visual/VisualApprovals';
import NotificationPage from './pages/Notification';
import CalendarPage from './pages/Calendar';
import PerformanceRecordPage from './pages/Performance/PerformanceRecordPage';
import PerformanceCreatePage from './pages/Performance/PerformanceCreatePage';
import PayrollPanel from './pages/Performance/PayrollPanel';
import InventoryPage from './pages/Inventory/InventoryWorkspace';
import InventoryRecordPage from './pages/Inventory/InventoryRecordPage';

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
      <AppearanceProvider>
        <BrowserRouter>
          {!inPreviewFrame && <DesktopKnowledgeBridge />}
          <SessionBootstrap />
        </BrowserRouter>
      </AppearanceProvider>
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
          <Route path="/analytics/dashboards" element={<AnalyticsDesigner />} />
          <Route path="/analytics/overview" element={<Dashboard />} />
          <Route path="/admin/sop-templates" element={<PermissionRoute permission="sop.template.read"><SopTemplatesPage /></PermissionRoute>} />
              <Route path="/admin/navigation" element={<NavigationManagement />} />
          <Route path="/admin/archives" element={<RetiredArchives />} />
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
                <RecordAccessBoundary kind="lead">
                  <LeadDetailPage />
                </RecordAccessBoundary>
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
                <RecordAccessBoundary kind="negotiation">
                  <NegotiationRecordPage />
                </RecordAccessBoundary>
              </AuthorizedPage>
            }
          />
          <Route
            path="/customers/:id"
            element={
              <AuthorizedPage permission="menu.customer">
                <RecordAccessBoundary kind="customer">
                  <CustomerDetailPage />
                </RecordAccessBoundary>
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
                <RecordAccessBoundary kind="contract">
                  <ContractDetailPage />
                </RecordAccessBoundary>
              </AuthorizedPage>
            }
          />
          <Route path="/cases" element={<CaseWorkspacePage />} />
          <Route path="/cases/:id/assessments" element={<AssessmentPage/>}/>
          <Route path="/quality/special-analyses" element={<BusinessWorkspacePage source="QUALITY_ANALYSES"/>}/>
          <Route path="/quality/special-analyses/:id" element={<AnalysisPage/>}/>
          <Route path="/analytics/quality" element={<QualityMetricsPage/>}/>
          <Route path="/admin/quality-rules" element={<QualityRulesPage/>}/>
          <Route path="/quality/runs" element={<QualityRunsPage/>}/>
          <Route path="/quality/runs/:id" element={<QualityRunPage/>}/>
          <Route path="/quality/reviews" element={<BusinessWorkspacePage source="QUALITY_REVIEWS"/>}/>
          <Route path="/quality/reviews/:id" element={<QualityInspectionPage/>}/>
          <Route path="/quality/issues" element={<BusinessWorkspacePage source="QUALITY_ISSUES"/>}/>
          <Route path="/quality/issues/:id" element={<QualityIssuePage/>}/>
          <Route path="/sop/tasks" element={<BusinessWorkspacePage source="SOP_TASKS" />} />
          <Route path="/sop/submissions/:id" element={<SopSubmissionPage />} />
          <Route path="/sop/tasks/:id" element={<SopTaskPage />} />
          <Route path="/sop/instances/new" element={<Navigate to="/admin/archives" replace />} />
          <Route path="/sop/instances/:id" element={<SopInstancePage />} />
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
                <GovernanceRoute />
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
          <Route path="/channels" element={<BusinessWorkspacePage source="CHANNELS" />} />
          <Route path="/channels/new" element={<ChannelCreatePage />} />
          <Route path="/channels/:id" element={<ChannelRecordPage />} />
          <Route
            path="/approval-ledger"
            element={
              <AuthorizedPage permission="approval.read">
                <ApprovalRedirect monitor />
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
          <Route path="/inventory/customized-records" element={<LegacyRedirect />} />
          <Route path="/inventory/office-records" element={<LegacyRedirect />} />
          <Route path="/inventory/inbound" element={<LegacyRedirect />} />
          <Route path="/inventory/outbound" element={<LegacyRedirect />} />
          <Route path="/inventory/stocktakes" element={<AuthorizedPage permission="hr.worksheet.read"><InventoryPage /></AuthorizedPage>} />
          <Route
            path="/inventory/*"
            element={
              <AuthorizedPage permission="menu.inventory">
                <InventoryPage />
              </AuthorizedPage>
            }
          />
          <Route path="/inventory/items/new" element={<InventoryRecordPage source="items" creating />} />
          <Route path="/inventory/items/:id" element={<InventoryRecordPage source="items" />} />
          <Route
            path="/inventory/movements/new"
            element={<InventoryRecordPage source="movements" creating />}
          />
          <Route path="/inventory/movements/:id" element={<InventoryRecordPage source="movements" />} />
          <Route
            path="/inventory/stocktakes/new"
            element={<InventoryRecordPage source="stocktakes" creating />}
          />
          <Route path="/inventory/stocktakes/:id" element={<InventoryRecordPage source="stocktakes" />} />
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
                <VisualApprovals />
              </AuthorizedPage>
            }
          />
          <Route path="/approvals/visual" element={<AuthorizedPage permission="approval.read"><ApprovalRedirect /></AuthorizedPage>} />
          <Route path="/notifications" element={<NotificationPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/performances" element={<BusinessWorkspacePage source="PERFORMANCES" />} />
          <Route path="/performances/new" element={<PerformanceCreatePage />} />
          <Route path="/performances/:id" element={<PerformanceRecordPage />} />
          <Route
            path="/payroll"
            element={
              <div className="unified-area-page">
                <h1>工资表与审批</h1>
                <PayrollPanel />
              </div>
            }
          />
          <Route path="*" element={null} />
        </Route>
      </Routes>
    </>
  );
}

export default App;

function GovernanceRoute() {
  const [params] = useSearchParams();
  const operationId = params.get('operationId') || undefined;
  return <AdminGovernancePage key={operationId || 'list'} initialOperationId={operationId} />;
}
