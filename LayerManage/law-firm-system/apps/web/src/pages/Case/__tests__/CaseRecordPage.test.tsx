import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import CaseRecordPage from '../CaseRecordPage';
import { clearCaseDraft } from '../case-draft';
import { useAuthStore } from '@/stores/authStore';
const api = vi.hoisted(() => ({ detail: vi.fn(), listFiles: vi.fn(), update: vi.fn(), transition: vi.fn() }));
vi.mock('@/api/business', () => ({ caseApi: api }));
vi.mock('@/api/customer', () => ({
  customerApi: { list: vi.fn().mockResolvedValue({ data: { list: [{ id: 'customer-1', name: '客户' }] } }) },
}));
vi.mock('@/features/crm/BusinessWorkspacePage', () => ({ BusinessTableLinks: () => null }));
vi.mock('@/features/workspaces/api', () => ({
  get: vi.fn(async (url: string) =>
    url === '/workspaces'
      ? { workspaces: [{ id: 'workspace', name: '工作区' }] }
      : { organizations: [{ id: 'org', name: '本部' }], employees: [{ id: 'lawyer', name: '律师' }] },
  ),
  errorMessage: (e: Error) => e.message,
}));
const row = {
  id: 'case-1',
  caseNo: 'CA-1',
  title: '可见案件',
  customerId: 'customer-1',
  customerName: '客户',
  lawyerId: 'lawyer',
  lawyerName: '律师',
  caseType: '民事',
  status: 'PROCESSING',
  priority: 'NORMAL',
  fee: '123.45',
  intakeData: {},
  files: [],
  tasks: [],
  communications: [],
  version: 4,
  createdAt: '2026-09-15T00:00:00Z',
};
const file = {
  id: 'file',
  caseId: row.id,
  fileName: '授权材料.txt',
  fileType: 'text/plain',
  fileSize: 10,
  createdAt: row.createdAt,
};
beforeEach(() => {
  vi.clearAllMocks();
  clearCaseDraft();
  api.detail.mockResolvedValue({ data: row });
  api.listFiles.mockResolvedValue({ data: { list: [file], total: 1 } });
  useAuthStore.setState({
    authorization: {
      userId: 'u',
      employeeId: null,
      isSystemSuperAdmin: false,
      isSystemAdmin: false,
      permissions: ['case.read', 'case.update', 'case.file.read'],
      menus: [],
      fieldCapabilities: {},
      validUntil: null,
      evaluatedAt: new Date().toISOString(),
    },
    authorizationStatus: 'ready',
  });
});
function open() {
  return render(
    <MemoryRouter initialEntries={['/cases/case-1']}>
      <Routes>
        <Route path="/cases/:id" element={<CaseRecordPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
test('file scope failure clears prior material metadata while the allowed case remains', async () => {
  open();
  await screen.findByText('授权材料.txt');
  api.listFiles.mockRejectedValue(new Error('材料权限已撤回'));
  fireEvent(window, new Event('focus'));
  await screen.findByText('材料权限已撤回');
  expect(screen.queryByText('授权材料.txt')).not.toBeInTheDocument();
  expect(screen.getByText('CA-1 可见案件')).toBeInTheDocument();
});
test('case scope failure clears record and materials without displaying cached data', async () => {
  open();
  await screen.findByText('授权材料.txt');
  api.detail.mockRejectedValue(new Error('案件权限已撤回'));
  fireEvent(window, new Event('focus'));
  await screen.findByText('案件权限已撤回');
  expect(screen.queryByText('CA-1 可见案件')).not.toBeInTheDocument();
  expect(screen.queryByText('授权材料.txt')).not.toBeInTheDocument();
});
test('background refresh preserves the edit draft and its original version', async () => {
  open();
  fireEvent.click(await screen.findByRole('button', { name: /修\s*改/ }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox', { name: '案件标题' }), {
    target: { value: '未保存草稿' },
  });
  api.detail.mockResolvedValue({ data: { ...row, title: '别人修改', version: 5 } });
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(screen.getByText('CA-1 别人修改')).toBeInTheDocument());
  expect(within(dialog).getByRole('textbox', { name: '案件标题' })).toHaveValue('未保存草稿');
  expect(api.update).not.toHaveBeenCalled();
});

test('case edits preserve exact fees and remove a stored attachment only in the confirmed versioned mutation', async () => {
  const current = {
    ...row,
    fee: '9999999999999999.99',
    intakeData: { fixedAgencyFee: '123.45' },
    files: [{ ...file, category: '合同附件' }],
  };
  api.detail.mockResolvedValue({ data: current });
  api.update.mockResolvedValue({ data: { ...current, version: 5 } });
  useAuthStore.setState({
    authorization: {
      ...useAuthStore.getState().authorization!,
      permissions: ['case.read', 'case.update', 'case.file.read', 'case.file.manage', 'customer.read'],
    },
  });
  open();
  fireEvent.click(await screen.findByRole('button', { name: /修\s*改/ }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('spinbutton', { name: '费用' })).toHaveValue('9999999999999999.99');
  fireEvent.change(within(dialog).getByRole('spinbutton', { name: '固定代理费金额' }), {
    target: { value: '' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'delete' }));
  expect(api.update).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: /确\s*定/ }));
  await waitFor(() =>
    expect(api.update).toHaveBeenCalledWith(
      'case-1',
      expect.objectContaining({
        version: 4,
        fee: '9999999999999999.99',
        intakeData: {},
        removeAttachmentIds: ['file'],
      }),
    ),
  );
});
