import assert from 'node:assert/strict';
import test from 'node:test';
import { findLeakedFixture } from '../../scripts/ci/check-spec-006-built-leakage';

test('allows protocol names while rejecting standalone fixture credentials', () => {
  assert.equal(findLeakedFixture("ctx.get('x-csrf-token')"), undefined);
  assert.equal(findLeakedFixture("const token = 'csrf-token';"), 'csrf-token');
  assert.equal(findLeakedFixture("const token = 'one-time-grant';"), 'one-time-grant');
});

test('rejects exact recovery-code and encryption-key fixtures', () => {
  assert.equal(findLeakedFixture('AAAA-BBBB-CCCC-DDDD'), 'AAAA-BBBB-CCCC-DDDD');
  assert.equal(
    findLeakedFixture('0123456789abcdef0123456789abcdef'),
    '0123456789abcdef0123456789abcdef',
  );
});
