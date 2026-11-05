import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import AnalyticsDesigner from './index';
import WidgetView from './WidgetView';
import { chartOptions, newWidget, type QueryResult, type Source } from './types';
import { get, post } from '@/features/workspaces/api';
import { useAuthStore } from '@/stores/authStore';

vi.mock('@/features/workspaces/api', () => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  errorMessage: (e: Error) => e.message,
}));
vi.mock('@/features/workspaces/AttachmentItem', () => ({ default: () => null }));
const source: Source = {
  id: 't',
  name: '领用表',
  baseId: 'b',
  baseName: '物品',
  fields: [
    { id: 'person', name: '领用人', type: 'TEXT', options: {} },
    { id: 'qty', name: '数量', type: 'NUMBER', options: {} },
    { id: 'day', name: '日期', type: 'DATETIME', options: {} },
    { id: 'end', name: '结束日期', type: 'DATETIME', options: {} },
  ],
};
const data: QueryResult = {
  fields: source.fields,
  metric: '3',
  total: 1,
  baseId: 'b',
  tableId: 't',
  updatedAt: new Date().toISOString(),
  series: [{ key: '甲', target: '乙', value: '3', count: 1 }],
  records: [
    {
      id: 'r',
      values: { person: '甲', qty: 3, day: '2026-11-05', end: '2026-11-07' },
      labels: { person: '甲', qty: '3', day: '2026-11-05', end: '2026-11-07' },
    },
  ],
};
beforeEach(() => {
  useAuthStore.setState({ userInfo: { id: 'a', username: 'a', name: '甲' } });
  vi.mocked(get).mockImplementation(async (url) => (url.endsWith('sources') ? [source] : ([] as never)));
  vi.mocked(post).mockImplementation(async (url, body) =>
    url.endsWith('/query') ? data : ({ ...(body as object), id: 'board', ownerId: 'a', version: 1 } as never),
  );
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const show = () =>
  render(
    <MemoryRouter>
      <AnalyticsDesigner />
    </MemoryRouter>,
  );
test('drag-add, configuration, save failure and retry preserve the draft and persist selected source', async () => {
  show();
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: '新建仪表盘' }));
  fireEvent.drop(screen.getByLabelText('仪表盘画布'), {
    dataTransfer: { getData: (kind: string) => (kind === 'application/oa-widget-type' ? 'metric' : '') },
  });
  fireEvent.change(screen.getByLabelText('组件标题'), { target: { value: '我的领用总数' } });
  fireEvent.click(screen.getByRole('button', { name: /刷新数据/ }));
  await screen.findByText('1 条明细 · 点击查看');
  vi.mocked(post).mockRejectedValueOnce(new Error('保存失败，稍后重试'));
  fireEvent.click(screen.getByRole('button', { name: /保存仪表盘/ }));
  await screen.findByText('保存失败，稍后重试');
  expect(screen.getByLabelText('组件标题')).toHaveValue('我的领用总数');
  fireEvent.click(screen.getByRole('button', { name: /保存仪表盘/ }));
  await screen.findByRole('button', { name: '编辑仪表盘' });
  const calls = vi.mocked(post).mock.calls.filter(([url]) => url === '/analytics/dashboards');
  expect(calls.at(-1)?.[1]).toMatchObject({
    widgets: [{ title: '我的领用总数', tableId: 't', type: 'metric' }],
  });
});
test('metric drill shows source links and refresh revocation removes stale data', async () => {
  show();
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: '新建仪表盘' }));
  fireEvent.click(screen.getByRole('button', { name: '指标卡' }));
  fireEvent.click(screen.getByRole('button', { name: /刷新数据/ }));
  fireEvent.click((await screen.findByText('1 条明细 · 点击查看')).closest('button')!);
  const drawer = within(screen.getByRole('dialog'));
  expect(drawer.getByRole('link', { name: '打开记录' })).toHaveAttribute(
    'href',
    '/workspaces?base=b&table=t&record=r',
  );
  fireEvent.click(drawer.getByRole('button', { name: 'Close' }));
  vi.mocked(post).mockRejectedValueOnce(new Error('没有查看权限'));
  fireEvent.click(screen.getByRole('button', { name: /刷新数据/ }));
  await screen.findByText('没有查看权限');
  expect(screen.queryByText('1 条明细 · 点击查看')).not.toBeInTheDocument();
});
test('all advertised components render actual bound data and calendar dates', () => {
  for (const [type] of chartOptions) {
    const widget = {
      ...newWidget(type, 't'),
      dimension: type === 'scatter' ? 'qty' : 'person',
      secondary: 'qty',
      measure: 'qty',
      dateField: 'day',
      endDateField: 'end',
    };
    const d =
      type === 'scatter' ? { ...data, series: [{ key: '3', target: '', value: '3', count: 1 }] } : data;
    const view = render(
      <MemoryRouter>
        <WidgetView widget={widget} data={d} onSelect={vi.fn()} />
      </MemoryRouter>,
    );
    expect(view.container.textContent?.length).toBeGreaterThan(0);
    if (type === 'calendar') {
      fireEvent.change(screen.getByLabelText('显示月份'), { target: { value: '2026-11' } });
      expect(screen.getByRole('link', { name: '甲' })).toHaveAttribute(
        'href',
        '/workspaces?base=b&table=t&record=r',
      );
    }
    view.unmount();
  }
});
test('account switch unmounts another account’s unsaved configuration', async () => {
  show();
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: '新建仪表盘' }));
  fireEvent.change(screen.getByLabelText('仪表盘名称'), { target: { value: '甲的私有草稿' } });
  await act(async () => useAuthStore.setState({ userInfo: { id: 'b', username: 'b', name: '乙' } }));
  expect(screen.queryByDisplayValue('甲的私有草稿')).not.toBeInTheDocument();
});
