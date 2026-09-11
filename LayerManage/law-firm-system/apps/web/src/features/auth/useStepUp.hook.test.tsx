import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { authApi } from '@/api/auth';
import StepUpDialog from './components/StepUpDialog';
import { useStepUp } from './useStepUp';

vi.mock('@/api/auth', () => ({ authApi: { stepUp: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.stepUp).mockResolvedValue({
    code: 200, message: 'OK', data: { stepUpToken: 'fresh-one-time-token', expiresIn: 300 },
  });
});

function HookHarness({ mutate }: { mutate: (token: string) => Promise<string> }) {
  const stepUp = useStepUp();
  const [outcome, setOutcome] = useState('idle');
  return <>
    <button onClick={() => {
      void stepUp.run({
        purpose: 'EVENT_DELIVERY_RETRY',
        target: { deliveryId: 'd1', expectedVersion: 7 },
        impact: '重新执行投递 d1',
        mutate,
      }).then(value => setOutcome(`resolved:${value}`), error => {
        const status = (error as { response?: { status?: number } })?.response?.status;
        setOutcome(status ? `rejected:${status}` : `rejected:${(error as Error).message}`);
      });
    }}>开始 Step-Up</button>
    <output>{outcome}</output>
    <StepUpDialog {...stepUp.dialogProps} />
  </>;
}

test('rejects the outer run and clears the dialog when mutation fails after a grant is issued', async () => {
  const conflict = { response: { status: 409, data: { message: 'AUTHORIZATION_VERSION_CONFLICT' } } };
  const mutate = vi.fn().mockRejectedValue(conflict);
  render(<HookHarness mutate={mutate} />);

  fireEvent.click(screen.getByRole('button', { name: '开始 Step-Up' }));
  fireEvent.change(await screen.findByLabelText('当前六位验证码'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: '验证并继续' }));

  expect(await screen.findByText('rejected:409')).toBeInTheDocument();
  expect(authApi.stepUp).toHaveBeenCalledOnce();
  expect(mutate).toHaveBeenCalledOnce();
  expect(mutate).toHaveBeenCalledWith('fresh-one-time-token');
  expect(screen.queryByLabelText('当前六位验证码')).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain('AUTHORIZATION_VERSION_CONFLICT');
  expect(localStorage.length).toBe(0);
});

test('settles successful runs and supports cancellation before issuing a grant', async () => {
  const mutate = vi.fn().mockResolvedValue('done');
  render(<HookHarness mutate={mutate} />);
  fireEvent.click(screen.getByRole('button', { name: '开始 Step-Up' }));
  fireEvent.change(await screen.findByLabelText('当前六位验证码'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: '验证并继续' }));
  expect(await screen.findByText('resolved:done')).toBeInTheDocument();
  expect(screen.queryByLabelText('当前六位验证码')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '开始 Step-Up' }));
  fireEvent.click(await screen.findByRole('button', { name: /取\s*消/ }));
  expect(await screen.findByText('rejected:STEP_UP_CANCELLED')).toBeInTheDocument();
  expect(authApi.stepUp).toHaveBeenCalledOnce();
  expect(mutate).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByLabelText('当前六位验证码')).not.toBeInTheDocument());
});
