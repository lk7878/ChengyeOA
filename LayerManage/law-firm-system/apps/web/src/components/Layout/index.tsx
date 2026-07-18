import React, { useState } from 'react';
import { Layout, Menu, Avatar, Badge, Dropdown, Breadcrumb, theme, type MenuProps } from 'antd';
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
} from '@ant-design/icons';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

const { Header: AntHeader, Sider, Content } = Layout;

const baseMenuItems: Required<MenuProps>['items'] = [
  { key: '/', icon: <DashboardOutlined />, label: '仪表盘' },
  { key: '/leads', icon: <FileSearchOutlined />, label: '线索管理' },
  { key: '/customers', icon: <UsergroupAddOutlined />, label: '客户管理' },
  { key: '/contracts', icon: <FileTextOutlined />, label: '合同管理' },
  { key: '/cases', icon: <FileTextOutlined />, label: '案件管理' },
  { key: '/payments', icon: <DollarOutlined />, label: '收款管理' },
  { key: '/employees', icon: <TeamOutlined />, label: '员工管理' },
  { key: '/organizations', icon: <ApartmentOutlined />, label: '组织架构' },
  { key: '/users', icon: <UserOutlined />, label: '用户管理' },
  { key: '/roles', icon: <SafetyCertificateOutlined />, label: '角色权限' },
  { key: '/channels', icon: <ShareAltOutlined />, label: '渠道管理' },
  { key: '/approvals', icon: <AuditOutlined />, label: '审批管理' },
  { key: '/notifications', icon: <BellOutlined />, label: '通知中心' },
  { key: '/performances', icon: <TrophyOutlined />, label: '绩效管理' },
];

// Exported for deterministic role-gated navigation tests.
// eslint-disable-next-line react-refresh/only-export-components
export function buildMenuItems(roles: string[]): Required<MenuProps>['items'] {
  const items = baseMenuItems.filter(item => item?.key !== '/employees' && item?.key !== '/organizations');
  if (!roles.includes('SYSTEM_SUPER_ADMIN')) return items;
  return [...items, {
    key: 'master-data',
    icon: <ApartmentOutlined />,
    label: '组织与人员',
    children: [
      { key: '/org/tree', icon: <ApartmentOutlined />, label: '组织架构' },
      { key: '/org/positions', icon: <SafetyCertificateOutlined />, label: '岗位管理' },
      { key: '/org/employees', icon: <TeamOutlined />, label: '员工管理' },
      { key: '/org/professional-teams', icon: <UsergroupAddOutlined />, label: '专业团队' },
    ],
  }];
}

const routeNameMap: Record<string, string> = {
  '/': '仪表盘',
  '/leads': '线索管理',
  '/customers': '客户管理',
  '/contracts': '合同管理',
  '/cases': '案件管理',
  '/payments': '收款管理',
  '/employees': '员工管理',
  '/organizations': '组织架构',
  '/users': '用户管理',
  '/roles': '角色权限',
  '/channels': '渠道管理',
  '/approvals': '审批管理',
  '/notifications': '通知中心',
  '/performances': '绩效管理',
  '/org/tree': '组织架构',
  '/org/positions': '岗位管理',
  '/org/employees': '员工管理',
  '/org/professional-teams': '专业团队',
};

interface MainLayoutProps {
  children: React.ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { userInfo, logout } = useAuthStore();
  const menuItems = buildMenuItems(userInfo?.roles ?? []);
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  const breadcrumbItems = [
    { title: <Link to="/">首页</Link> },
    ...(location.pathname !== '/' ? [{ title: routeNameMap[location.pathname] || location.pathname }] : []),
  ];

  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: '个人信息',
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: logout,
    },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        theme="dark"
        width={220}
        style={{ position: 'fixed', height: '100vh', left: 0, top: 0, zIndex: 100 }}
      >
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: collapsed ? 16 : 18,
            fontWeight: 'bold',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          {collapsed ? '律所' : '律所管理系统'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderRight: 0 }}
        />
      </Sider>
      <Layout style={{ marginLeft: collapsed ? 80 : 220, transition: 'all 0.2s' }}>
        <AntHeader
          style={{
            padding: '0 24px',
            background: colorBgContainer,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'sticky',
            top: 0,
            zIndex: 99,
            boxShadow: '0 1px 4px rgba(0,21,41,0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {React.createElement(collapsed ? MenuUnfoldOutlined : MenuFoldOutlined, {
              style: { fontSize: 18, cursor: 'pointer' },
              onClick: () => setCollapsed(!collapsed),
            })}
            <Breadcrumb items={breadcrumbItems} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <Badge count={0} size="small">
              <BellOutlined style={{ fontSize: 18, cursor: 'pointer' }} />
            </Badge>
            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <Avatar icon={<UserOutlined />} size="small" />
                <span>{userInfo?.name || userInfo?.username || '用户'}</span>
                <DownOutlined style={{ fontSize: 12 }} />
              </div>
            </Dropdown>
          </div>
        </AntHeader>
        <Content
          style={{
            margin: 24,
            padding: 24,
            background: colorBgContainer,
            borderRadius: borderRadiusLG,
            minHeight: 280,
          }}
        >
          {children}
        </Content>
      </Layout>
    </Layout>
  );
};

export default MainLayout;
