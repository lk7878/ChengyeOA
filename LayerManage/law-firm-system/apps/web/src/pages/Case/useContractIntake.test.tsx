import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Form } from 'antd';
import { contractApi } from '@/api/contract';
import { customerApi } from '@/api/customer';
import { useContractIntake } from './useContractIntake';
import IntakeFields from './IntakeFields';
vi.mock('@/api/contract', () => ({ contractApi: { detail: vi.fn() } }));
vi.mock('@/api/customer', () => ({ customerApi: { detail: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function Harness({ id }: { id?: string }) {
  const [form] = Form.useForm();
  const state = useContractIntake(form, id, true, true);
  return (
    <Form form={form}>
      <span>{state.loading ? '加载中' : state.error || '就绪'}</span>
      <IntakeFields contractLinked={!!id} departments={[]} employees={[]} />
    </Form>
  );
}
function replies() {
  vi.mocked(contractApi.detail).mockResolvedValue({
    data: { id: 'ct', customerId: 'cu', amount: '100', contractNo: 'CT1', signDate: '2026-02-13T00:00:00Z' },
  } as never);
  vi.mocked(customerApi.detail).mockResolvedValue({
    data: { address: '重庆市永川区', phone: '13800000001' },
  } as never);
}
test('linked intake fills and locks fields; clearing retains editable values and removes obsolete inputs', async () => {
  replies();
  const view = render(<Harness id="ct" />);
  await waitFor(() => expect(screen.getByLabelText('地区')).toHaveValue('重庆市永川区'));
  expect(screen.getByLabelText('地区')).toBeDisabled();
  expect(screen.getByLabelText('客户电话')).toHaveValue('13800000001');
  expect(screen.getByLabelText('客户电话')).toBeDisabled();
  expect(screen.getByLabelText('签约日期')).toBeDisabled();
  expect(screen.queryByText('首次代理费')).not.toBeInTheDocument();
  expect(screen.queryByText('自定义代理程序')).not.toBeInTheDocument();
  view.rerender(<Harness />);
  expect(screen.getByLabelText('地区')).not.toBeDisabled();
  expect(screen.getByLabelText('地区')).toHaveValue('重庆市永川区');
  expect(screen.getByLabelText('签约日期')).not.toBeDisabled();
  fireEvent.change(screen.getByLabelText('地区'), { target: { value: '手工地区' } });
  expect(screen.getByLabelText('地区')).toHaveValue('手工地区');
});
test('late source responses cannot overwrite manual input after unlinking, and failures are visible', async () => {
  replies();
  let resolve!: (value: unknown) => void;
  vi.mocked(customerApi.detail).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r as typeof resolve;
      }) as never,
  );
  const view = render(<Harness id="ct" />);
  await waitFor(() => expect(customerApi.detail).toHaveBeenCalled());
  view.rerender(<Harness />);
  fireEvent.change(screen.getByLabelText('地区'), { target: { value: '保留输入' } });
  await act(async () => resolve({ data: { address: '过期请求', phone: '13800000001' } }));
  expect(screen.getByLabelText('地区')).toHaveValue('保留输入');
  vi.mocked(contractApi.detail).mockRejectedValueOnce(new Error('unavailable'));
  view.rerender(<Harness id="other" />);
  expect(await screen.findByText('合同或客户资料加载失败，请重新选择合同后重试。')).toBeInTheDocument();
});
