import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ResourceAccess } from './ResourceAccess';
import { get, post } from './api';

vi.mock('./api', () => ({ get: vi.fn(), post: vi.fn(), errorMessage: () => '失败' }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
test.each([false, true])(
  'sharing defaults to all permitted records, preserving explicit SELF: %s',
  async (existing) => {
    const member = {
      id: 'm',
      principalType: 'USER',
      principalId: 'u',
      role: 'READER',
      rowScope: 'SELF',
      hiddenFields: [],
      readonlyFields: [],
      canCreate: false,
      version: 1,
    };
    vi.mocked(get).mockResolvedValue({
      version: 1,
      policy: { restricted: true, grants: existing ? [member] : [] },
      members: [member],
    });
    vi.mocked(post).mockResolvedValue({});
    render(
      <ResourceAccess
        baseId="b"
        fields={[]}
        directory={{ users: [{ id: 'u', name: 'LMJ' }], organizations: [], teams: [], employees: [] }}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '应用权限' }));
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'LMJ权限' }));
    fireEvent.click(await screen.findByText('编辑', { selector: '.ant-select-item-option-content' }));
    expect(screen.getByRole('checkbox', { name: '仅本人创建的记录' })).toHaveProperty('checked', existing);
    fireEvent.click(screen.getByRole('button', { name: '保存权限' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/bases/b/access',
        expect.objectContaining({
          policy: expect.objectContaining({
            grants: [expect.objectContaining({ role: 'EDITOR', rowScope: existing ? 'SELF' : 'ALL' })],
          }),
        }),
        expect.any(String),
      ),
    );
  },
);
