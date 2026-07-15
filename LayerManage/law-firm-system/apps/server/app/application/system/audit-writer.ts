import { Prisma } from '@prisma/client';

export type AuditWriter = (
  tx: Prisma.TransactionClient,
  input: Prisma.OperationLogCreateInput,
) => Promise<void>;

export const writeAuditLog: AuditWriter = async (tx, input) => {
  await tx.operationLog.create({ data: input });
};
