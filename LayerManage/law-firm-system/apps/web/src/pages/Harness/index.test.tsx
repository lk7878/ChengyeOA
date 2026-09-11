import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import HarnessPage from './index';
import { connectHarness } from '@/api/harness';
vi.mock('@/api/harness',()=>({connectHarness:vi.fn()}));
beforeEach(()=>{vi.mocked(connectHarness).mockReset();});
afterEach(()=>{vi.unstubAllGlobals();});
test('keeps local setup instructions visible on connection failure',async()=>{
  vi.mocked(connectHarness).mockRejectedValue(new Error('无法连接本机助手，请启动连接器。'));
  render(<HarnessPage feature="knowledge" />);fireEvent.click(screen.getByRole('button',{name:'连接本机助手'}));
  expect(await screen.findByText('无法连接本机助手，请启动连接器。')).toBeInTheDocument();expect(screen.getByText('node connector.mjs config.local.json')).toBeInTheDocument();
});
test('shows a native window link and personal data location after a successful connection',async()=>{
  const url='http://localhost:45000/?token=fixture#oa-view=smart-case';vi.mocked(connectHarness).mockResolvedValue({protocol:1,url,feature:'smart-case',version:'fixture',dataDirectory:'personal/workspace'});
  render(<HarnessPage feature="smart-case" />);fireEvent.click(screen.getByRole('button',{name:'连接本机助手'}));
  expect(await screen.findByRole('link',{name:'在新窗口打开'})).toHaveAttribute('href',url);
  expect(screen.getByText('本机数据目录：personal/workspace')).toBeInTheDocument();expect(screen.getByRole('button',{name:'停止本机助手'})).toBeInTheDocument();
});


test('remote OA uses the native window instead of a cross-site iframe',async()=>{
  vi.stubGlobal('location',{hostname:'oa.example',protocol:'https:'});
  vi.mocked(connectHarness).mockResolvedValue({protocol:1,url:'http://127.0.0.1:45000/',feature:'knowledge',version:'fixture',dataDirectory:'personal'});
  const {container}=render(<HarnessPage feature="knowledge" />);fireEvent.click(screen.getByRole('button',{name:'连接本机助手'}));
  expect(await screen.findByText('请点击“在新窗口打开”使用本机助手')).toBeInTheDocument();expect(container.querySelector('iframe')).toBeNull();
});
