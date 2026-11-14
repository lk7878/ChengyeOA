import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { MasterDataError } from '../../domain/master-data/master-data-errors';

/** Callers authorize the action and canonical target before entering this function, including replays. */
export function createOnce<T extends { id: string }>(
  db: PrismaClient,
  input: { actorId: string; key: string | null; operation: string; normalized: unknown },
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  replay: (tx: Prisma.TransactionClient, targetId: string) => Promise<T>,
): Promise<T> {
  if (!input.key) return db.$transaction(work);
  const key = input.key;
  const hash = createHash('sha256')
    .update(JSON.stringify(canonical(input.normalized)))
    .digest('hex');
  return db.$transaction(
    async (tx) => {
      // One global actor/key namespace. Mutation lock precedes any contract/case/domain row locks.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.actorId + ':' + key}, 0))`;
      const existing = await tx.domainMutation.findUnique({
        where: { actorId_key: { actorId: input.actorId, key } },
      });
      if (existing) {
        if (existing.operation !== input.operation || existing.requestHash !== hash)
          throw new MasterDataError('IDEMPOTENCY_CONFLICT', 409);
        return replay(tx, existing.targetId);
      }
      const result = await work(tx);
      await tx.domainMutation.create({
        data: {
          actorId: input.actorId,
          key,
          operation: input.operation,
          requestHash: hash,
          targetId: result.id,
        },
      });
      return result;
    },
    { timeout: 15000 },
  );
}
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
