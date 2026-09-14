import type { Prisma, PrismaClient } from '@prisma/client';

/** Compose CRM commands with an application transaction without nested commits. */
export function crmTransaction<T>(
  db: PrismaClient,
  tx: Prisma.TransactionClient | undefined,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return tx ? work(tx) : db.$transaction(work);
}
