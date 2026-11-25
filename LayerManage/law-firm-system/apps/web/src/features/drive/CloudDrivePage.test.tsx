import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import CloudDrivePage from './CloudDrivePage';
import { get } from '../workspaces/api';
vi.mock('../workspaces/api', () => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), errorMessage: () => '加载失败', errorStatus: (error: {response?: {status: number}}) => error.response?.status }));
vi.mock('../navigation/shell-context', () => ({ useUnifiedShell: () => true }));
vi.mock('./StorageManager', () => ({ default: ({workspace}: {workspace: string}) => <div>存储范围：{workspace}</div> }));
vi.mock('./PersonalFiles', () => ({ default: () => <div>个人文件</div> }));
const listing = { items: [{id:'f',kind:'FOLDER',name:'跨区目录',workspaceId:'w1',workspaceName:'工作区一',ownerName:'本人',path:[],updatedAt:'2026-11-18'}], path:[], total:1,page:1,pageSize:50,workspace:{id:'__all__',name:'全部工作区'},canManageAccess:false,canCreateFolder:false,canCreateBase:false };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(get).mockImplementation(async url => {
    if(url==='/workspaces?driveLinks=1')return {workspaces:[{id:'w1',name:'工作区一'}],canCreate:false};
    if(url.includes('/collaboration/options'))return {organizations:[],employees:[],users:[],teams:[]};
    if(url.endsWith('/folders'))return {folders:[],userId:'me'};
    return listing;
  });
});
test('all-workspace option displays origin and folder navigation returns to its real workspace', async () => {
  render(<MemoryRouter initialEntries={['/workspaces?workspace=__all__']}><CloudDrivePage /></MemoryRouter>);
  expect(await screen.findByText('跨区目录')).toBeInTheDocument();
  expect(screen.getByText(/所属工作区：工作区一/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:/跨区目录.*本人/}));
  await waitFor(()=>expect(vi.mocked(get).mock.calls.some(([url])=>url.includes('/workspaces/w1/drive?')&&url.includes('parentId=f'))).toBe(true));
});
test('all-workspace creation asks for a concrete destination instead of submitting an all identifier', async () => {
  render(<MemoryRouter initialEntries={['/workspaces?workspace=__all__']}><CloudDrivePage /></MemoryRouter>);
  await screen.findByText('跨区目录');
  fireEvent.click(screen.getByRole('button',{name:'选择工作区后新建'}));
  expect(await screen.findByText('选择目标工作区')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'进入工作区'})).toBeDisabled();
});
test('storage navigation preserves aggregate scope and does not query a synthetic workspace resource', async () => {
  render(<MemoryRouter initialEntries={['/workspaces?workspace=__all__&scope=storage']}><CloudDrivePage /></MemoryRouter>);
  expect(await screen.findByText('存储范围：__all__')).toBeInTheDocument();
  expect(screen.queryByRole('combobox', {name:'工作区'})).not.toBeInTheDocument();
  expect(vi.mocked(get).mock.calls.some(([url])=>url.includes('/drive?'))).toBe(false);
});

test('aggregate browsing explains its scope and links personal uploads to my resources', async () => {
  render(<MemoryRouter initialEntries={['/workspaces?workspace=__all__&scope=all']}><CloudDrivePage /></MemoryRouter>);
  await screen.findByText('跨区目录');
  expect(screen.getByRole('button', {name:'跨工作区可访问资源'})).toBeInTheDocument();
  const hint = screen.getByRole('alert');
  expect(hint).toHaveTextContent('个人上传文件与已同步的智慧办案成果');
  fireEvent.click(hint.querySelector('button')!);
  expect(await screen.findByText('个人文件')).toBeInTheDocument();
  await waitFor(()=>expect(vi.mocked(get).mock.calls.some(([url])=>url.includes('/workspaces/__all__/drive?')&&url.includes('scope=mine'))).toBe(true));
});

test('table-only members can open their authorized worksheet and personal files independently', async () => {
  vi.mocked(get).mockImplementation(async url => {
    if (url === '/workspaces?driveLinks=1') return {
      workspaces: [{ id: 'restricted', name: '案件管理', tableLinks: [
        { id: 'table1', baseId: 'base1', baseName: '售后管理表', name: '案件管理表' },
      ] }], canCreate: false,
    };
    return { organizations: [], employees: [], users: [], teams: [] };
  });
  render(<MemoryRouter initialEntries={['/workspaces']}><CloudDrivePage /></MemoryRouter>);
  expect(await screen.findByRole('button', {name:/售后管理表.*案件管理表/})).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', {name:'我的资源'})[0]);
  expect(await screen.findByText('个人文件')).toBeInTheDocument();
  expect(screen.queryByRole('button', {name:'重试'})).not.toBeInTheDocument();
  expect(vi.mocked(get).mock.calls.some(([url]) => url.includes('/restricted/drive'))).toBe(false);
});

test('a temporary directory failure keeps the list through retry; explicit denial clears it', async () => {
  let failure: unknown;
  vi.mocked(get).mockImplementation(async url => {
    if (url.startsWith('/workspaces?')) return {workspaces:[{id:'w1',name:'工作区一'}],canCreate:false};
    if (url.includes('/collaboration/options')) return {organizations:[],employees:[],users:[],teams:[]};
    if (url.endsWith('/folders')) return {folders:[],userId:'me'};
    if (failure) throw failure;
    return {...listing,workspace:{id:'w1',name:'工作区一'}};
  });
  render(<MemoryRouter initialEntries={['/workspaces']}><CloudDrivePage /></MemoryRouter>);
  await screen.findByText('跨区目录');
  failure = {isAxiosError:true,code:'ERR_NETWORK'};
  fireEvent.focus(window);
  await screen.findByText(/目录刷新暂时失败/);
  expect(screen.getByText('跨区目录')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'重试'}));
  expect(screen.getByText('跨区目录')).toBeVisible();
  failure = {isAxiosError:true,response:{status:403}};
  await waitFor(() => {
    window.dispatchEvent(new Event('online'));
    expect(screen.queryByText('跨区目录')).toBeNull();
  });
});

test.each([['w1', 15000], ['__all__', 30000]] as const)('directory %s refreshes after %d ms', async (id, interval) => {
  vi.useFakeTimers();
  try {
    render(<MemoryRouter initialEntries={['/workspaces?workspace=' + id]}><CloudDrivePage /></MemoryRouter>);
    await act(async () => { await Promise.resolve(); });
    const calls = () => vi.mocked(get).mock.calls.filter(([url]) => url.includes('/drive?')).length;
    expect(calls()).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(interval - 1); });
    expect(calls()).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(calls()).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});
