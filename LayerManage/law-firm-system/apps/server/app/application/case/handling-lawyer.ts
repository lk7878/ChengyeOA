import { Prisma } from '@prisma/client';
import { MasterDataError } from '../../domain/master-data/master-data-errors';

// Resolve only IDs already present on visible cases. Legacy text is never matched by name.
export async function handlingLawyers(tx: Prisma.TransactionClient, values: unknown[]) {
  const ids = [...new Set(values.filter((id): id is string => typeof id === 'string' && !!id))];
  const employees = ids.length ? await tx.employee.findMany({
    where: { id: { in: ids } }, select: { id: true, name: true, employeeNo: true },
  }) : [];
  return new Map(employees.map(person => [person.id, person]));
}

export async function checkHandlingLawyer(tx: Prisma.TransactionClient, id: string, organizationId?: string | null) {
  const now = new Date();
  const person = await tx.employee.findFirst({
    where: {
      id, deletedAt: null, status: { not: 'LEAVED' },
      assignments: { some: {
        startedAt: { lte: now }, OR: [{ endedAt: null }, { endedAt: { gt: now } }],
        position: { status: 'ENABLED', deletedAt: null },
        organization: {
          status: 'ENABLED',
          ...(organizationId ? { OR: [{ id: organizationId }, { path: { contains: '/' + organizationId + '/' } }] } : {}),
        },
      } },
    },
    select: { id: true },
  });
  if (!person) throw new MasterDataError('CASE_HANDLING_LAWYER_UNAVAILABLE', 422);
}
