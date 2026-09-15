import { useState, type ReactNode } from 'react';
import { Alert, Avatar, Breadcrumb, Button, Drawer, Dropdown, Empty, Input, Modal, Result, Spin } from 'antd';
import {
  AppstoreOutlined,
  BellOutlined,
  CloudOutlined,
  DashboardOutlined,
  HomeOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SearchOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Link, useLocation } from 'react-router';
import { PRODUCT_NAME, PRODUCT_TITLE } from '@/product';
import { useAuthStore } from '@/stores/authStore';
import { openCaseAssistant } from '@/features/intelligence/desktop';
import {
  areas,
  canOpen,
  entries,
  findEntry,
  legacyRedirects,
  visibleEntries,
} from '@/features/navigation/catalog';
import { UnifiedShellContext } from '@/features/navigation/shell-context';
import { useNavigationAuthorization } from '@/features/navigation/use-navigation-authorization';
import { isAuthorizationSummaryExpired } from '@/features/authorization/api';
import './sidebar.css';

const icons = {
  home: <HomeOutlined />,
  drive: <CloudOutlined />,
  apps: <AppstoreOutlined />,
  analytics: <DashboardOutlined />,
  admin: <SettingOutlined />,
};

export default function MainLayout({ children }: { children: ReactNode }) {
  const { pathname, search: locationSearch } = useLocation();
  const businessEditor =
    ['/leads', '/leads/follows', '/customers', '/negotiations', '/contracts'].includes(pathname) && !!new URLSearchParams(locationSearch).get('base');
  const [expanded, setExpanded] = useState(false);
  const [contextHidden, setContextHidden] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { userInfo, authorization, authorizationStatus, ensureAuthorization, logout } = useAuthStore();
  useNavigationAuthorization();
  const current = findEntry(legacyRedirects[pathname] || pathname);
  const area = areas.find((item) => item.id === current?.area) || areas[0];
  const available = visibleEntries(authorization, area.id).filter((item) => item.path !== area.path);
  const groups = [...new Set(available.map((item) => item.group))];
  const context = current && current.area !== 'drive' && !current.global && !businessEditor;
  const closeNavigation = () => setDrawer(false);
  const globalNav = (
    <nav aria-label="全局导航" className="unified-global-nav">
      {areas.map((item) => (
        <Link
          key={item.id}
          to={item.path}
          aria-label={item.title}
          aria-current={item.id === current?.area && !current.global ? 'page' : undefined}
          onClick={closeNavigation}
        >
          <span aria-hidden="true">{icons[item.id]}</span>
          <span>{item.title}</span>
        </Link>
      ))}
    </nav>
  );
  const contextNav = (
    <nav aria-label="当前区域目录" className="unified-context-nav">
      <Link className="unified-context-home" to={area.path} onClick={closeNavigation}>
        {area.title}
      </Link>
      {groups.map((group) => (
        <section key={group}>
          <h2>{group}</h2>
          {available
            .filter((item) => item.group === group)
            .map((item) => (
              <Link
                key={item.path}
                to={item.path}
                aria-current={(current?.parent || current?.path) === item.path ? 'page' : undefined}
                onClick={closeNavigation}
              >
                {item.title}
              </Link>
            ))}
        </section>
      ))}
      {!available.length && <p className="unified-muted">暂无可用入口</p>}
    </nav>
  );
  const toolAllowed = (path: string) => canOpen(entries.find((item) => item.path === path)!, authorization);
  const loading = authorizationStatus === 'idle' || authorizationStatus === 'loading';
  const valid = authorizationStatus === 'ready' && !isAuthorizationSummaryExpired(authorization);
  const body = loading ? (
    <div className="unified-state" aria-label="正在加载授权">
      <Spin />
    </div>
  ) : !valid ? (
    <div className="unified-state">
      <Alert
        type="error"
        title="无法确认当前权限"
        description="请重试后继续，当前受保护内容已隐藏。"
        action={
          <Button onClick={() => void ensureAuthorization(true).catch(() => undefined)}>重试授权</Button>
        }
      />
    </div>
  ) : !current ? (
    <Result status="404" title="页面不存在" extra={<Link to="/">返回工作台</Link>} />
  ) : !canOpen(current, authorization) ? (
    <Result
      status="403"
      title="无权访问此页面"
      subTitle="请联系管理员核对岗位与访问权限。"
      extra={<Link to="/">返回工作台</Link>}
    />
  ) : (
    children
  );
  const searchItems = entries.filter(
    (item) =>
      !item.hidden && canOpen(item, authorization) && (item.title + item.group).includes(search.trim()),
  );
  return (
    <UnifiedShellContext.Provider value={true}>
      <div className={'unified-shell' + (expanded ? ' unified-expanded' : '')}>
        <a className="unified-skip" href="#unified-main">
          跳到主要内容
        </a>
        <header className="unified-header">
          <div className="unified-header-left">
            <Button
              className="unified-mobile-toggle"
              aria-label="打开全局导航"
              icon={<MenuUnfoldOutlined />}
              onClick={() => setDrawer(true)}
            />
            <Link className="unified-brand" title={PRODUCT_TITLE} to="/">
              <span className="unified-brand-mark">承</span>
              <span className="unified-brand-name">{PRODUCT_NAME}</span>
            </Link>
            <Breadcrumb
              items={[
                { title: <Link to={area.path}>{area.title}</Link> },
                ...(current && current.path !== area.path ? [{ title: current.title }] : []),
              ]}
            />
          </div>
          <div className="unified-header-actions">
            <Button
              aria-label="查找功能入口"
              icon={<SearchOutlined />}
              onClick={() => {
                setSearch('');
                setSearchOpen(true);
              }}
            />
            {toolAllowed('/knowledge') && (
              <Link className="unified-tool" to="/knowledge">
                知识库
              </Link>
            )}
            {toolAllowed('/smart-case') && (
              <Button
                type="text"
                aria-label="智慧办案"
                data-smart-case-launcher
                onClick={() => void openCaseAssistant()}
              >
                智慧办案
              </Button>
            )}
            <Link aria-label="通知中心" title="通知中心" className="unified-notification" to="/notifications">
              <BellOutlined aria-hidden="true" />
            </Link>
            <Dropdown
              menu={{
                items: [
                  { key: 'account', label: <Link to="/security/account">账号安全</Link> },
                  { key: 'logout', label: '退出登录', onClick: logout },
                ],
              }}
              trigger={['click']}
            >
              <Button className="unified-account" aria-label="账号菜单">
                <Avatar size="small" icon={<UserOutlined />} />
                <span>{userInfo?.name || userInfo?.username || '账号'}</span>
              </Button>
            </Dropdown>
          </div>
        </header>
        <div className="unified-body">
          <aside className="unified-global-rail">
            {globalNav}
            <Button
              aria-label={expanded ? '收起全局导航' : '展开全局导航'}
              icon={expanded ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
              onClick={() => setExpanded((value) => !value)}
            />
          </aside>
          {context && !contextHidden && <aside className="unified-context">{contextNav}</aside>}
          <div className="unified-content">
            {context && (
              <div className="unified-context-toggle">
                <Button
                  size="small"
                  type="text"
                  aria-label={contextHidden ? '展开区域目录' : '收起区域目录'}
                  icon={contextHidden ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                  onClick={() => setContextHidden((value) => !value)}
                >
                  {area.title}
                </Button>
              </div>
            )}
            <main
              id="unified-main"
              tabIndex={-1}
              className={
                (current?.area === 'drive' || businessEditor) && valid
                  ? 'unified-main unified-workspace'
                  : 'unified-main unified-page'
              }
            >
              {body}
            </main>
          </div>
        </div>
        <Drawer
          title="导航"
          placement="left"
          open={drawer}
          onClose={closeNavigation}
          className="unified-navigation-drawer"
          size={300}
        >
          {globalNav}
          {context && contextNav}
        </Drawer>
        <Modal
          title="查找功能入口"
          open={searchOpen}
          onCancel={() => setSearchOpen(false)}
          footer={null}
          destroyOnHidden
        >
          <Input
            aria-label="搜索功能入口"
            placeholder="搜索已授权的应用或页面"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="unified-search-results">
            {searchItems.map((item) => (
              <Link key={item.path} to={item.path} onClick={() => setSearchOpen(false)}>
                {item.title}
                <small>
                  {item.global ? '全局工具' : areas.find((value) => value.id === item.area)?.title} ·{' '}
                  {item.group}
                </small>
              </Link>
            ))}
            {!searchItems.length && <Empty description="没有匹配的可用入口" />}
          </div>
        </Modal>
      </div>
    </UnifiedShellContext.Provider>
  );
}
