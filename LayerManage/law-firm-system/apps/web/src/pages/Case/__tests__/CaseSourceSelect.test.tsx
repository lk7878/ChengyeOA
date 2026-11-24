import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import CaseSourceSelect from '../CaseSourceSelect';
import { get, post } from '@/features/workspaces/api';
vi.mock('@/features/workspaces/api', () => ({ get: vi.fn(), post: vi.fn(), errorMessage: (e: Error) => e.message }));
const items = [{ name: '个人', enabled: true, version: 1 }, { name: '侵权中心', enabled: true, version: 1 }, { name: '旧来源', enabled: false, version: 2 }];
beforeEach(() => { vi.clearAllMocks(); vi.mocked(get).mockResolvedValue({ items, canManage: false }); });
test('ordinary user selects across sources, can search, and cannot maintain the dictionary', async () => {
  const onChange = vi.fn();
  render(<CaseSourceSelect onChange={onChange} />);
  await waitFor(() => expect(get).toHaveBeenCalledWith('/case-sources'));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '案件来源' }));
  fireEvent.change(screen.getByRole('combobox', { name: '案件来源' }), { target: { value: '侵权' } });
  fireEvent.click(await screen.findByText('侵权中心', { selector: '.ant-select-item-option-content' }));
  expect(onChange).toHaveBeenCalledWith('侵权中心');
  expect(screen.queryByText('管理来源')).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});
test('admin can add and disable sources with explicit version, refreshing choices afterward', async () => {
  vi.mocked(get).mockResolvedValue({ items, canManage: true });
  vi.mocked(post).mockResolvedValue({});
  render(<CaseSourceSelect />);
  fireEvent.click(await screen.findByRole('button', { name: '管理来源' }));
  fireEvent.change(screen.getByRole('textbox', { name: '新增来源名称' }), { target: { value: '线上咨询' } });
  fireEvent.click(screen.getByRole('button', { name: '新增来源' }));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/case-sources', { name: '线上咨询' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: '新增来源名称' })).toHaveValue(''));
  fireEvent.click(screen.getAllByRole('button', { name: '停 用' })[0]);
  await waitFor(() => expect(post).toHaveBeenCalledWith('/case-sources', { name: '个人', enabled: false, version: 1 }));
});
test('disabled historical source remains visible without being offered as a new choice', async () => {
  const onChange = vi.fn();
  render(<CaseSourceSelect value="旧来源" onChange={onChange} />);
  await waitFor(() => expect(get).toHaveBeenCalled());
  expect(screen.getByText('旧来源')).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '案件来源' }));
  await screen.findByText('个人', { selector: '.ant-select-item-option-content' });
  expect(screen.queryByText('旧来源', { selector: '.ant-select-item-option-content' })).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});
test('directory failure exposes retry and never clears the existing source', async () => {
  vi.mocked(get).mockRejectedValueOnce(new Error('加载失败'));
  const onChange = vi.fn();
  render(<CaseSourceSelect value="个人" onChange={onChange} />);
  await screen.findByText('加载失败');
  fireEvent.click(screen.getByRole('button', { name: '重 试' }));
  await waitFor(() => expect(screen.queryByText('加载失败')).not.toBeInTheDocument());
  expect(onChange).not.toHaveBeenCalled();
});
