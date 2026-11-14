import assert from 'node:assert/strict';
import test from 'node:test';
import { databaseAvailability, databaseHealthResponse } from '../../app/lib/database-health';

test('reports PostgreSQL as available after a successful probe', async () => {
  assert.equal(await databaseAvailability({ async $queryRaw() { return [{ '?column?': 1 }]; } }), 'available');
});

test('reports PostgreSQL as unavailable without exposing the error', async () => {
  assert.equal(await databaseAvailability({ async $queryRaw() { throw new Error('private connection details'); } }), 'unavailable');
});

test('maps an unavailable database to a sanitized 503 response', () => {
  assert.deepEqual(databaseHealthResponse('unavailable'), {
    statusCode: 503,
    body: {
      code: 503,
      message: 'service unavailable',
      data: { status: 'degraded', database: 'unavailable' },
    },
  });
});
