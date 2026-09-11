import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import SensitiveEmployeeFields from './SensitiveEmployeeFields';
import { masterDataApi } from '@/features/master-data/api';

vi.mock('@/features/master-data/api', () => ({ masterDataApi: { employees: { viewSensitive: vi.fn() } } }));

test('requires an access purpose and clears the L4 value whenever the drawer closes', async () => {
  vi.mocked(masterDataApi.employees.viewSensitive).mockResolvedValue({ code: 200, message: 'success', data: { 'employee.idCard': '500000199001010000' } });
  render(<SensitiveEmployeeFields employeeId="employee-1" allowed />);
  fireEvent.click(screen.getByRole('button', { name: '查看完整身份证号' }));
  expect(screen.getByRole('button', { name: '确认查看' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('查看用途'), { target: { value: '用于法院立案身份核验' } });
  fireEvent.click(screen.getByRole('button', { name: '确认查看' }));
  await waitFor(() => expect(masterDataApi.employees.viewSensitive).toHaveBeenCalledWith('employee-1', ['employee.idCard'], '用于法院立案身份核验'));
  expect(await screen.findByText('500000199001010000')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '关闭敏感信息' }));
  await waitFor(() => expect(screen.queryByText('500000199001010000')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: '查看完整身份证号' }));
  expect(screen.queryByText('500000199001010000')).not.toBeInTheDocument();
  expect(screen.getByLabelText('查看用途')).toHaveValue('');
});

test('does not expose the L4 action without formal permission', () => {
  render(<SensitiveEmployeeFields employeeId="employee-1" allowed={false} />);
  expect(screen.queryByRole('button', { name: '查看完整身份证号' })).not.toBeInTheDocument();
});
