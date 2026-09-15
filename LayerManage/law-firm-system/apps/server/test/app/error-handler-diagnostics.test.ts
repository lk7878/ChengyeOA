import assert from 'node:assert/strict';
import test from 'node:test';
import { Context } from 'egg';
import errorHandler from '../../app/middleware/errorHandler';

test('database diagnostics expose only allowlisted codes and transaction categories', async () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    for (const [code, detail, expected] of [
      ['P2028', 'Unable to start a transaction in the given time. private-parameter', 'acquisition_timeout'],
      ['P2028', 'Transaction already closed: expired transaction. private-parameter', 'expired'],
      ['private-parameter', 'private-parameter', 'none'],
    ]) {
      const logs: unknown[][] = [];
      const ctx = { logger: { error: (...args: unknown[]) => logs.push(args) } } as unknown as Context;
      const failure = Object.assign(new Error('private-parameter'), { code, meta: { error: detail } });
      await errorHandler()(ctx, async () => {
        throw failure;
      });
      assert.equal(ctx.status, 500);
      assert.equal((ctx.body as { message: string }).message, 'INTERNAL_SERVER_ERROR');
      assert.ok(JSON.stringify(logs).includes(expected));
      assert.ok(!JSON.stringify(logs).includes('private-parameter'));
      assert.ok(!JSON.stringify(ctx.body).includes('private-parameter'));
    }
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
});
