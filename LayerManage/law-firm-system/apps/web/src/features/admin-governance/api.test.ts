import { beforeEach, expect, test, vi } from 'vitest';
import { governanceApi, governanceErrorMessage } from './api';

const requestMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock('@/api/request', () => ({ default: requestMock }));

beforeEach(() => {
  requestMock.get.mockReset();
  requestMock.post.mockReset();
});

test('calls governance endpoints including the safe user-target contract with typed payloads', async () => {
  requestMock.get.mockResolvedValue({ code: 200, message: 'success', data: [] });
  requestMock.post.mockResolvedValue({ code: 200, message: 'success', data: {} });
  await governanceApi.catalog();
  await governanceApi.userTargets('alice');
  await governanceApi.list({ scope: 'mine', page: 2 });
  await governanceApi.detail('operation-1');
  await governanceApi.create({
    operationType: 'MASTER_DATA_METADATA_CORRECTION', targetType: 'ORGANIZATION', targetId: 'org-1',
    reason: 'Correct verified organization display ordering', expectedTargetVersion: 1,
    payload: { sort: 4 }, idempotencyKey: 'request-1',
  });
  await governanceApi.review('operation-1', { decision: 'CONFIRM', expectedOperationVersion: 3 });
  await governanceApi.cancel('operation-1', { expectedOperationVersion: 1 });
  await governanceApi.retry('operation-1', { expectedOperationVersion: 4 });

  expect(requestMock.get).toHaveBeenNthCalledWith(1, '/v1/admin-governance/catalog');
  expect(requestMock.get).toHaveBeenNthCalledWith(2, '/v1/admin-governance/targets/users', { params: { keyword: 'alice' } });
  expect(requestMock.get).toHaveBeenNthCalledWith(3, '/v1/admin-governance/operations', { params: { scope: 'mine', page: 2 } });
  expect(requestMock.get).toHaveBeenNthCalledWith(4, '/v1/admin-governance/operations/operation-1');
  expect(requestMock.post).toHaveBeenCalledTimes(4);
});

test('maps every stable governance error and keeps unknown codes visible', () => {
  for (const code of [
    'GOVERNANCE_OPERATION_NOT_ALLOWED', 'GOVERNANCE_SELF_REVIEW_FORBIDDEN',
    'GOVERNANCE_REVIEW_TARGET_CONFLICT', 'OPERATION_ALREADY_PROCESSED', 'IDEMPOTENCY_KEY_REUSED',
    'STALE_TARGET_VERSION', 'PAYLOAD_HASH_MISMATCH', 'LAST_SUPER_ADMIN_PROTECTED',
    'RECOVERY_WINDOW_NOT_AVAILABLE', 'OPERATION_NOT_RETRYABLE', 'TARGET_NOT_ELIGIBLE',
    'RESOURCE_NOT_FOUND_OR_FORBIDDEN',
  ]) {
    expect(governanceErrorMessage(code)).not.toBe(code);
  }
  expect(governanceErrorMessage('SUPPORT_DIAGNOSTIC_CODE')).toContain('SUPPORT_DIAGNOSTIC_CODE');
});
