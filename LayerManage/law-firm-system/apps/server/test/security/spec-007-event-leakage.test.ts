import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  findLeakedFixture,
} from '../../scripts/ci/check-spec-006-built-leakage';

test('shared built-artifact scanner preserves SPEC-006 signatures and rejects SPEC-007 event fixtures', () => {
  for (const fixture of [
    'change-token',
    'mfa-token',
    'access-token',
    'csrf-token',
    'one-time-grant',
    'AAAA-BBBB-CCCC-DDDD',
    'EEEE-FFFF-GGGG-HHHH',
    '0123456789abcdef0123456789abcdef',
    'event-private-governance-reason',
    'event-private-review-comment',
    'event-private-business-payload',
    'spec008-private-governance-reason',
    'spec008-private-review-comment',
    'spec008-private-business-payload',
    'spec008-private-availability-detail',
  ]) {
    assert.equal(findLeakedFixture(`prefix:${fixture}:suffix`), fixture);
  }
});

test('shared built-artifact scanner does not flag safe event operations evidence', () => {
  assert.equal(findLeakedFixture(JSON.stringify({
    eventType: 'admin.operation.reviewed',
    handlerCode: 'ADMIN_OPERATION_REVIEWED_NOTIFICATION',
    status: 'MANUAL',
    errorCode: 'EVENT_HANDLER_UNKNOWN',
  })), undefined);
});

test('shared scanner detects the actual SPEC-008 random suffix shape without matching ordinary identifiers', () => {
  for (const fixture of [
    'spec008-private-governance-reason',
    'spec008-private-review-comment',
    'spec008-private-business-payload',
    'spec008-private-availability-detail',
  ]) {
    assert.equal(findLeakedFixture(`prefix:${fixture}-${randomUUID()}:suffix`), fixture);
    assert.equal(findLeakedFixture(`prefix:${fixture}-ordinary-business-identifier:suffix`), undefined);
  }
  assert.equal(findLeakedFixture(`prefix:ordinary-${randomUUID()}-business-identifier:suffix`), undefined);
});
