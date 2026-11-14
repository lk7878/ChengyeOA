import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import LinkedContractCase from './LinkedContractCase';
import { caseApi } from '@/api/business';
const auth = vi.hoisted(() => ({ allowed: true }));
vi.mock('@/api/business', () => ({ caseApi: { list: vi.fn() } }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ hasPermission: () => auth.allowed }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  auth.allowed = true;
});
test('linked contract opens its existing case and never retains a previous contract result', async () => {
  vi.mocked(caseApi.list).mockResolvedValue({ data: { list: [{ id: 'c1', caseNo: 'CA-001' }] } } as never);
  const view = render(
    <MemoryRouter>
      <LinkedContractCase contractId="contract1" />
    </MemoryRouter>,
  );
  expect(await screen.findByRole('link', { name: '打开已有案件' })).toHaveAttribute('href', '/cases/c1');
  expect(caseApi.list).toHaveBeenCalledWith({ contractId: 'contract1', page: 1, pageSize: 1 });
  vi.mocked(caseApi.list).mockResolvedValue({ data: { list: [] } } as never);
  view.rerender(
    <MemoryRouter>
      <LinkedContractCase contractId="contract2" />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.queryByRole('link')).not.toBeInTheDocument());
});
test('no case permission means no lookup or existing-case disclosure', () => {
  auth.allowed = false;
  render(
    <MemoryRouter>
      <LinkedContractCase contractId="contract1" />
    </MemoryRouter>,
  );
  expect(caseApi.list).not.toHaveBeenCalled();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
