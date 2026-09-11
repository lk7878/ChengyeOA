import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import StepUpDialog from './StepUpDialog';

test('accepts only a six-digit TOTP and clears it whenever the dialog closes', () => {
  const verify = vi.fn();
  const view = render(
    <StepUpDialog open purpose="ADMIN_GOVERNANCE_CREATE" impact="提交高风险治理申请" loading={false} onCancel={vi.fn()} onVerify={verify} />,
  );
  fireEvent.change(screen.getByLabelText('当前六位验证码'), { target: { value: '12345' } });
  expect(screen.getByRole('button', { name: '验证并继续' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('当前六位验证码'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: '验证并继续' }));
  expect(verify).toHaveBeenCalledWith('123456');

  view.rerender(
    <StepUpDialog open={false} purpose="ADMIN_GOVERNANCE_CREATE" impact="提交高风险治理申请" loading={false} onCancel={vi.fn()} onVerify={verify} />,
  );
  view.rerender(
    <StepUpDialog open purpose="ADMIN_GOVERNANCE_CREATE" impact="提交高风险治理申请" loading={false} onCancel={vi.fn()} onVerify={verify} />,
  );
  expect(screen.getByLabelText('当前六位验证码')).toHaveValue('');
  expect(screen.getByRole('dialog')).toHaveTextContent('提交高风险治理申请');
});
