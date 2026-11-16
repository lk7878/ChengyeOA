import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { menuLabels } from './menu-labels';
import { useMenuStore, type MenuNode } from './menu-store';
import BusinessWorkspacePage from '../crm/BusinessWorkspacePage';
import MoveTable from '../workspaces/MoveTable';
import { get } from '../workspaces/api';
vi.mock('@/pages/Workspaces',()=>({WorkspaceEditor:()=>null}));
vi.mock('../workspaces/api',()=>({get:vi.fn(),post:vi.fn(),errorMessage:(e:Error)=>e.message}));
const nodes:MenuNode[]=[{id:'group',label:'大数据中心',parentId:null,target:null,position:0},
  {id:'follows',label:'网销管理',parentId:'group',target:'/leads/follows',position:0}];
afterEach(()=>{cleanup();useMenuStore.setState({config:null});vi.resetAllMocks();});
test('node IDs resolve all ancestor labels after rename, regrouping and removal',()=>{
  const dict=menuLabels(nodes);
  expect(dict.resolve('/leads/follows')).toEqual({id:'follows',label:'网销管理',path:'大数据中心 / 网销管理',group:'大数据中心'});
  const updated=menuLabels(nodes.map(n=>({...n,label:n.id==='group'?'市场部':'销售业务'})));
  expect(updated.sourcePath('FOLLOWS','旧路径')).toBe('市场部 / 销售业务');
  expect(menuLabels([]).sourcePath('FOLLOWS','独立工作区 / 自定义应用')).toBe('独立工作区 / 自定义应用');
});
test('open directory and move picker react to the same dictionary without reloading business data',async()=>{
  useMenuStore.setState({config:{nodes,version:1,targets:[]}});
  vi.mocked(get).mockImplementation(async url=> url.includes('move-targets')
    ? [{id:'b',name:'跟进表',workspaceName:'客户经营',moduleSource:'FOLLOWS'}] as never
    : {tables:[{id:'t',name:'客户跟进记录表',baseId:'b',baseName:'跟进表',workspaceName:'客户经营',moduleSource:'FOLLOWS'}],targets:[]} as never);
  render(<MemoryRouter><BusinessWorkspacePage source="FOLLOWS"/><MoveTable tableId="t"/></MemoryRouter>);
  expect(await screen.findByRole('heading',{name:'网销管理'})).toBeVisible();
  await screen.findByText('客户跟进记录表');
  fireEvent.click(screen.getByRole('button',{name:'移动工作表'}));
  await waitFor(()=>expect(get).toHaveBeenCalledWith('/tables/t/move-targets'));
  fireEvent.mouseDown(screen.getByRole('combobox',{name:'目标目录'}));
  expect(screen.getAllByText('大数据中心 / 网销管理').length).toBeGreaterThan(1);
  act(()=>useMenuStore.getState().set({nodes:nodes.map(n=>({...n,label:n.id==='group'?'市场部':'销售业务'})),version:2,targets:[]}));
  expect(screen.getByRole('heading',{name:'销售业务'})).toBeVisible();
  expect(screen.getAllByText('市场部 / 销售业务').length).toBeGreaterThan(1);
  expect(screen.queryByText('客户经营 / 跟进表')).not.toBeInTheDocument();
  expect(get).toHaveBeenCalledTimes(2);
});
