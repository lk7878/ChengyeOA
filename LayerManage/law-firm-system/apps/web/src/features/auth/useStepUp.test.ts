import { expect, test, vi } from 'vitest';
import { withStepUp } from './useStepUp';

test('passes a fresh grant only to the immediate protected mutation', async () => {
  const verify = vi.fn().mockResolvedValueOnce('grant-1').mockResolvedValueOnce('grant-2');
  const mutate = vi.fn(async (token: string) => `used:${token}`);
  const input = {
    purpose: 'ADMIN_GOVERNANCE_APPROVE' as const,
    target: { operationId: 'op-1', expectedOperationVersion: 2, decision: 'APPROVE' },
    verify,
    mutate,
  };

  await expect(withStepUp(input)).resolves.toBe('used:grant-1');
  await expect(withStepUp(input)).resolves.toBe('used:grant-2');
  expect(mutate.mock.calls).toEqual([['grant-1'], ['grant-2']]);
});

test('does not reuse a grant when the protected mutation fails', async () => {
  const verify = vi.fn().mockResolvedValue('one-time-grant');
  const mutate = vi.fn().mockRejectedValue(new Error('mutation failed'));
  await expect(withStepUp({
    purpose: 'SESSION_REVOKE', target: { sessionId: 's2' }, verify, mutate,
  })).rejects.toThrow('mutation failed');
  expect(verify).toHaveBeenCalledOnce();
  expect(mutate).toHaveBeenCalledWith('one-time-grant');
});
