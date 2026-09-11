import { Prisma } from '@prisma/client';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import { normalizeNonNegativeInteger } from '../../domain/master-data/master-data-validation';

export async function reserveOrganizationSort(tx: Prisma.TransactionClient, value?: number, ownId?: string): Promise<number> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(20260911, 1)::text`;
  if (value === undefined) {
    const maximum = await tx.organization.aggregate({ _max: { sort: true } });
    value = (maximum._max.sort ?? -1) + 1;
  }
  const sort = normalizeNonNegativeInteger(value);
  if (sort > 2147483647) throw new MasterDataError('VALIDATION_FAILED', 400);
  const occupied = await tx.organization.findFirst({ where: { sort, ...(ownId ? { id: { not: ownId } } : {}) }, select: { id: true } });
  if (occupied) throw new MasterDataError('ORGANIZATION_SORT_CONFLICT', 409);
  return sort;
}

export function mapOrganizationUniqueError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = error.meta?.target;
    const sortConflict = Array.isArray(target) ? target.includes('sort') : String(target).includes('sort');
    throw new MasterDataError(sortConflict ? 'ORGANIZATION_SORT_CONFLICT' : 'MASTER_DATA_CODE_CONFLICT', 409);
  }
  throw error;
}
