import { Form } from 'antd';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import EmployeeForm from './EmployeeForm';
import ProfessionalTeamForm from './ProfessionalTeamForm';
import { validateForm } from '../form-rules';

function Harness({ kind, onSubmit }: { kind: 'employee' | 'team'; onSubmit: (value: unknown) => void }) {
  const [form] = Form.useForm();
  return <>
    {kind === 'employee'
      ? <EmployeeForm form={form} organizations={[]} positions={[]} onOrganizationChange={() => undefined} />
      : <ProfessionalTeamForm form={form} organizations={[]} />}
    <button onClick={async () => { const value = await validateForm(form); if (value) onSubmit(value); }}>提交表单</button>
  </>;
}

test.each([
  ['team', '团队编码', '001', '以英文字母开头'],
  ['team', '团队分类', '   ', '团队分类须为'],
  ['employee', '员工工号', '员工001', '工号须为'],
  ['employee', '姓名', '张', '姓名须为 2–100'],
  ['employee', '手机号', '123', '手机号须为 5–30'],
  ['employee', '邮箱', 'bad-address', '请输入有效的邮箱地址'],
] as const)('%s form rejects invalid %s inline and keeps the entered value', async (kind, label, value, explanation) => {
  const onSubmit = vi.fn();
  render(<Harness kind={kind} onSubmit={onSubmit} />);
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: '提交表单' }));
  await waitFor(() => expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true'));
  expect((await screen.findAllByText(new RegExp(explanation))).length).toBeGreaterThan(0);
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByLabelText(label)).toHaveValue(value);
});
