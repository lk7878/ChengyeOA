import React, { useEffect, useState } from 'react';
import {
  Layout,
  Menu,
  Avatar,
  Badge,
  Dropdown,
  Breadcrumb,
  Drawer,
  Grid,
  theme,
  type MenuProps,
} from 'antd';
import {
  DashboardOutlined,
  UserOutlined,
  TeamOutlined,
  FileSearchOutlined,
  UsergroupAddOutlined,
  FileTextOutlined,
  DollarOutlined,
  ApartmentOutlined,
  SafetyCertificateOutlined,
  ShareAltOutlined,
  AuditOutlined,
  BellOutlined,
  TrophyOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  LogoutOutlined,
  DownOutlined,
  CalendarOutlined,
  AccountBookOutlined,
  RollbackOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useLocation, useNavigate, Link } from 'react-router';
import type { MenuPermissionCode, PermissionCode } from '@/features/authorization/types';
import { useAuthStore } from '@/stores/authStore';
import './sidebar.css';

const { Header: AntHeader, Sider, Content } = Layout;

interface NavigationItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  requiredMenu?: MenuPermissionCode;
  children?: NavigationItem[];
}

const baseMenuItems: NavigationItem[] = [
  { key: '/', icon: <DashboardOutlined />, label: '仪表盘' },
  {
    key: 'lead-crm',
    icon: <FileSearchOutlined />,
    label: '线索销转',
    requiredMenu: 'menu.lead_crm',
    children: [
      { key: '/leads', icon: <FileSearchOutlined />, label: '线索列表', requiredMenu: 'menu.lead_crm' },
      { key: '/leads/pool', icon: <TeamOutlined />, label: '公海池', requiredMenu: 'menu.lead_crm' },
      { key: '/leads/calendar', icon: <CalendarOutlined />, label: '到访日历', requiredMenu: 'menu.lead_crm' },
    ],
  },
  { key: '/customers', icon: <UsergroupAddOutlined />, label: '客户管理', requiredMenu: 'menu.customer' },
  {
    key: 'contract-negotiation',
    icon: <FileTextOutlined />,
    label: '谈案合同',
    requiredMenu: 'menu.contract',
    children: [
      { key: '/negotiations', icon: <FileTextOutlined />, label: '谈案管理', requiredMenu: 'menu.contract' },
      { key: '/contracts', icon: <FileTextOutlined />, label: '合同管理', requiredMenu: 'menu.contract' },
    ],
  },
  { key: '/cases', icon: <FileTextOutlined />, label: '案件管理' },
  { key: 'finance', icon: <DollarOutlined />, label: '财务管理', children: [
  { key: '/payments', icon: <DollarOutlined />, label: '收款管理', requiredMenu: 'menu.payment' },
  // SPEC-011 Task 11：财务运营四页（FIN-02~05），菜单权限码由 Task 2 供给。
  { key: '/invoices', icon: <AccountBookOutlined />, label: '开票管理', requiredMenu: 'menu.invoice' },
  { key: '/refunds', icon: <RollbackOutlined />, label: '退款减免', requiredMenu: 'menu.refund' },
  { key: '/costs', icon: <AccountBookOutlined />, label: '成本管理', requiredMenu: 'menu.cost' },
  ] },
  { key: '/anomalies', icon: <WarningOutlined />, label: '异常数据', requiredMenu: 'menu.anomaly' },
  { key: '/users', icon: <UserOutlined />, label: '用户管理' },
  { key: '/channels', icon: <ShareAltOutlined />, label: '渠道管理' },
  { key: '/approvals', icon: <AuditOutlined />, label: '审批管理' },
  { key: 'inventory', icon: <AccountBookOutlined />, label: '物品管理', requiredMenu: 'menu.inventory', children: [
    { key: '/inventory/items', icon: <AccountBookOutlined />, label: '物品档案与库存', requiredMenu: 'menu.inventory' },
    { key: '/inventory/customized-records', icon: <FileTextOutlined />, label: '定制物品领用登记', requiredMenu: 'menu.inventory' },
    { key: '/inventory/customized-statistics', icon: <AccountBookOutlined />, label: '定制物品领用统计', requiredMenu: 'menu.inventory' },
    { key: '/inventory/office-records', icon: <FileTextOutlined />, label: '办公用品领用明细', requiredMenu: 'menu.inventory' },
    { key: '/inventory/office-statistics', icon: <AccountBookOutlined />, label: '办公用品领用统计', requiredMenu: 'menu.inventory' },
    { key: '/inventory/inbound', icon: <AccountBookOutlined />, label: '入库明细', requiredMenu: 'menu.inventory' },
    { key: '/inventory/outbound', icon: <AccountBookOutlined />, label: '出库明细', requiredMenu: 'menu.inventory' },
    { key: '/inventory/stocktakes', icon: <AccountBookOutlined />, label: '定期盘点记录', requiredMenu: 'menu.inventory' },
    { key: '/inventory/dashboard', icon: <DashboardOutlined />, label: '物品领用仪表盘', requiredMenu: 'menu.inventory' },
  ] },
  { key: '/notifications', icon: <BellOutlined />, label: '通知中心' },
  { key: '/performances', icon: <TrophyOutlined />, label: '绩效管理' },
];

const permissionMenuItems: NavigationItem[] = [
  {
    key: 'master-data',
    icon: <ApartmentOutlined />,
    label: '组织与人员',
    requiredMenu: 'menu.organization_personnel',
    children: [
      { key: '/org/tree', icon: <ApartmentOutlined />, label: '组织架构', requiredMenu: 'menu.organization' },
      { key: '/org/positions', icon: <SafetyCertificateOutlined />, label: '岗位管理', requiredMenu: 'menu.position' },
      { key: '/org/employees', icon: <TeamOutlined />, label: '员工管理', requiredMenu: 'menu.employee' },
      { key: '/org/professional-teams', icon: <UsergroupAddOutlined />, label: '专业团队', requiredMenu: 'menu.professional_team' },
    ],
  },
  {
    key: 'security',
    icon: <SafetyCertificateOutlined />,
    label: '权限中心',
    children: [
      { key: '/security/roles', icon: <SafetyCertificateOutlined />, label: '角色权限', requiredMenu: 'menu.security_roles' },
      { key: '/security/users', icon: <UserOutlined />, label: '用户授权', requiredMenu: 'menu.security_users' },
      { key: '/security/trace', icon: <AuditOutlined />, label: '权限追踪', requiredMenu: 'menu.security_trace' },
      { key: '/security/my-access', icon: <UserOutlined />, label: '我的权限', requiredMenu: 'menu.security_my_access' },
      { key: '/security/admin-governance', icon: <SafetyCertificateOutlined />, label: '管理员治理', requiredMenu: 'menu.admin_governance' },
      { key: '/security/event-operations', icon: <AuditOutlined />, label: '事件运维', requiredMenu: 'menu.event_operations' },
    ],
  },
];

// eslint-disable-next-line react-refresh/only-export-components
export function buildMenuItems(menus: readonly PermissionCode[], isSuperAdmin = false): Required<MenuProps>['items'] {
  const menuSet = new Set(menus.filter(code => isSuperAdmin || code !== 'menu.organization'));
  return [...baseMenuItems, ...permissionMenuItems]
    .map(item => filterNavigationItem(item, menuSet))
    .filter((item): item is NavigationItem => item !== null) as Required<MenuProps>['items'];
}

function filterNavigationItem(item: NavigationItem, menus: Set<PermissionCode>): NavigationItem | null {
  if (item.requiredMenu && !menus.has(item.requiredMenu)) return null;
  if (!item.children) return item;
  const children = item.children
    .map(child => filterNavigationItem(child, menus))
    .filter((child): child is NavigationItem => child !== null);
  return children.length > 0 ? { ...item, children } : null;
}

const routeNameMap: Record<string, string> = {
  '/': '仪表盘',
  '/leads': '线索列表',
  '/leads/pool': '公海池',
  '/leads/calendar': '到访日历',
  '/customers': '客户管理',
  '/negotiations': '谈案管理',
  '/contracts': '合同管理',
  '/contracts/new': '新建合同',
  '/cases': '案件管理',
  '/payments': '收款管理',
  '/invoices': '开票管理',
  '/refunds': '退款减免',
  '/costs': '成本管理',
  '/anomalies': '异常数据',
  '/users': '用户管理',
  '/channels': '渠道管理',
  '/approvals': '审批管理',
  '/notifications': '通知中心',
  '/performances': '绩效管理',
  '/inventory': '物品管理',
  '/inventory/items': '物品档案与库存',
  '/inventory/customized-records': '定制物品领用登记',
  '/inventory/customized-statistics': '定制物品领用统计',
  '/inventory/office-records': '办公用品领用明细',
  '/inventory/office-statistics': '办公用品领用统计',
  '/inventory/inbound': '入库明细',
  '/inventory/outbound': '出库明细',
  '/inventory/stocktakes': '定期盘点记录',
  '/inventory/dashboard': '物品领用仪表盘',
  '/org/tree': '组织架构',
  '/org/positions': '岗位管理',
  '/org/employees': '员工管理',
  '/org/professional-teams': '专业团队',
  '/security/roles': '角色权限',
  '/security/users': '用户授权',
  '/security/trace': '权限追踪',
  '/security/my-access': '我的权限',
  '/security/admin-governance': '管理员治理',
  '/security/event-operations': '事件运维',
  '/security/account': '账号安全',
};

function resolveSelectedKey(pathname: string): string {
  if (/^\/leads\/[^/]+$/.test(pathname)) return '/leads';
  if (/^\/customers\/[^/]+$/.test(pathname)) return '/customers';
  if (/^\/contracts\/[^/]+$/.test(pathname)) return '/contracts';
  return pathname;
}

interface MainLayoutProps {
  children: React.ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const location = useLocation();
  const navigate = useNavigate();
  const { userInfo, logout, authorization, ensureAuthorization } = useAuthStore();
  const menuItems = buildMenuItems(authorization?.menus ?? [], authorization?.isSystemSuperAdmin);
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  useEffect(() => {
    void ensureAuthorization().catch(() => undefined);
  }, [ensureAuthorization]);

  const breadcrumbItems = [
    { title: <Link to="/">首页</Link> },
    ...(location.pathname !== '/' ? [{ title: routeNameMap[location.pathname] || location.pathname }] : []),
  ];
  const userMenuItems = [
    { key: 'security-account', icon: <SafetyCertificateOutlined />, label: '账号安全', onClick: () => navigate('/security/account') },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: logout },
  ];
  const menu = (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={[resolveSelectedKey(location.pathname)]}
      items={menuItems}
      onClick={({ key }) => { setMobileMenuOpen(false); navigate(key); }}
      style={{ borderRight: 0 }}
    />
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {!isMobile && (
        <Sider
          className="main-sidebar"
          trigger={null}
          collapsible
          collapsed={collapsed}
          theme="dark"
          width={220}
          style={{ position: 'fixed', height: '100vh', left: 0, top: 0, zIndex: 100 }}
        >
          <div className="main-sidebar-title" style={{ fontSize: collapsed ? 16 : 18 }}>
            {collapsed ? '律所' : '律所管理系统'}
          </div>
          <nav className="main-sidebar-menu" aria-label="主导航">{menu}</nav>
          <div className="main-sidebar-credit">百佑智业出品</div>
        </Sider>
      )}
      <Drawer
        open={isMobile && mobileMenuOpen}
        placement="left"
        closable={false}
        onClose={() => setMobileMenuOpen(false)}
        size="default"
        styles={{ body: { padding: 0, background: '#001529', display: 'flex', flexDirection: 'column', overflow: 'hidden' } }}
      >
        <div className="main-sidebar-title">律所管理系统</div>
        <nav className="main-sidebar-menu" aria-label="主导航">{menu}</nav>
        <div className="main-sidebar-credit">百佑智业出品</div>
      </Drawer>
      <Layout style={{ marginLeft: isMobile ? 0 : collapsed ? 80 : 220, transition: 'all 0.2s', minWidth: 0 }}>
        <AntHeader style={{ padding: '0 24px', background: colorBgContainer, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 99, boxShadow: '0 1px 4px rgba(0,21,41,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {React.createElement(isMobile || collapsed ? MenuUnfoldOutlined : MenuFoldOutlined, {
              style: { fontSize: 18, cursor: 'pointer' },
              onClick: () => isMobile ? setMobileMenuOpen(true) : setCollapsed(!collapsed),
            })}
            <Breadcrumb items={breadcrumbItems} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <Badge count={0} size="small"><BellOutlined style={{ fontSize: 18, cursor: 'pointer' }} /></Badge>
            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <Avatar icon={<UserOutlined />} size="small" />
                {!isMobile && <><span>{userInfo?.name || userInfo?.username || '用户'}</span><DownOutlined style={{ fontSize: 12 }} /></>}
              </div>
            </Dropdown>
          </div>
        </AntHeader>
        <Content style={{ margin: isMobile ? 12 : 24, padding: isMobile ? 16 : 24, background: colorBgContainer, borderRadius: borderRadiusLG, minHeight: 280 }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
};

export default MainLayout;
