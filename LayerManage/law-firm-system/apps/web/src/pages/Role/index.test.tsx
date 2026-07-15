import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import RolePage from './index';

const { createMock, listMock, permissionTreeMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  listMock: vi.fn(),
  permissionTreeMock: vi.fn(),
}));

vi.mock('@/api/user', () => ({
  roleApi: {
    list: listMock,
    create: createMock,
    update: vi.fn(),
    delete: vi.fn(),
    assignPermissions: vi.fn(),
  },
  permissionApi: { tree: permissionTreeMock },
}));

afterEach(() => {
  createMock.mockReset();
  listMock.mockReset();
  permissionTreeMock.mockReset();
});

test('creates a business role with the exact immutable uppercase code', async () => {
  listMock.mockResolvedValue({
    code: 200,
    data: { list: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 } },
  });
  permissionTreeMock.mockResolvedValue({ code: 200, data: [] });
  createMock.mockResolvedValue({ code: 200, data: {} });
  render(<RolePage />);

  await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /新建角色/ }));
  });
  const nameInput = await screen.findByLabelText('角色名称');
  const codeInput = screen.getByLabelText('角色代码');
  await act(async () => {
    fireEvent.change(nameInput, { target: { value: '业务律师' } });
    fireEvent.change(codeInput, { target: { value: 'BUSINESS_LAWYER' } });
  });
  await waitFor(() => {
    expect(nameInput).toHaveValue('业务律师');
    expect(codeInput).toHaveValue('BUSINESS_LAWYER');
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  });

  await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
  expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
    name: '业务律师',
    code: 'BUSINESS_LAWYER',
    type: 'BUSINESS',
  }));
  expect(screen.getByRole('dialog', { name: '角色信息' })).toHaveClass('ant-zoom-leave');
  await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
});
