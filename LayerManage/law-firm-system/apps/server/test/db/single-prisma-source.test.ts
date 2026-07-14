import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('only apps/server contains a runtime Prisma schema', () => {
  const projectRoot = path.resolve(__dirname, '../../../..');
  assert.equal(fs.existsSync(path.join(projectRoot, 'prisma/schema.prisma')), false);
  assert.equal(fs.existsSync(path.join(projectRoot, 'apps/server/prisma/schema.prisma')), true);
});
