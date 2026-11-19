import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { SettlementEditor, SettlementPolicy } from '../SettlementEditor';
import type { PayView, Policy } from '../case-pay-types';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/features/workspaces/api', () => api);
// Render the form directly. Modal drag and transition behavior is tested by its own component.
vi.mock('@/components/DraggableModal', () => ({default: ({children}: {children: ReactNode}) => <div>{children}</div>}));

const person = { id: 'lawyer', employeeNo: '001', name: '个人律师' };
const policy: Policy = {
  scopeId: 'personal',
  teamId: null,
  employeeId: null,
  version: 1,
  basis: 'amount',
  fields: [],
  teamInputFields: [],
  formula: '基数',
  memberRules: [],
  financeIds: [],
  directorId: 'director',
};
const view: PayView = {
  rows: [],
  teams: [],
  leads: [],
  editable: [],
  person,
  policies: [policy],
  members: [],
  costs: [],
  directory: [person, { id: 'helper', employeeNo: '002', name: '协办成员' }],
  finance: [],
  admin: false,
  accounts: [],
  drafts: [],
  batches: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue([]);
});
test.each([true, false])('搜索按当前办案方式请求案件并支持多行分配 team=%s', async (team) => {
  const scope = team
    ? {
        ...view,
        leads: ['t'],
        teams: [{ id: 't', name: '测试团队' }],
        policies: [{ ...policy, scopeId: 't', teamId: 't' }],
      }
    : view;
  render(
    <SettlementEditor
      view={scope}
      period="2026-11"
      saved={vi.fn()}
      close={vi.fn()}
      refresh={vi.fn()}
      openExisting={vi.fn()}
    />,
  );
  await waitFor(() => expect(screen.getByText(team ? '团队办案' : '个人办案')).toBeVisible());
  fireEvent.click(screen.getByRole('button', { name: /查\s*找/ }));
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith('/case-performance/sources?q=' + (team ? '&teamId=t' : '')),
  );
  fireEvent.click(screen.getByRole('button', { name: '添加成员分配' }));
  fireEvent.click(screen.getByRole('button', { name: '添加成员分配' }));
  expect(screen.getAllByRole('combobox', { name: '分配成员' })).toHaveLength(2);
});
test('无团队时可独立配置个人办案规则与财务授权', async () => {
  render(<SettlementPolicy view={{ ...view, admin: true }} close={vi.fn()} saved={vi.fn()} />);
  await waitFor(() => expect(screen.getByText('个人办案默认规则')).toBeVisible());
  expect(screen.getByText('保存结算规则')).toBeVisible();
});
