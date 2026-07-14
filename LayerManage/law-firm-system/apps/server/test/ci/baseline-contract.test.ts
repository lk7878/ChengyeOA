import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { checkBaselineContract } from '../../scripts/ci/check-baseline-contract';

test('repository exposes one Prisma source and no write bootstrap commands', () => {
  const projectRoot = path.resolve(__dirname, '../../../..');
  assert.deepEqual(checkBaselineContract(projectRoot), []);
});
