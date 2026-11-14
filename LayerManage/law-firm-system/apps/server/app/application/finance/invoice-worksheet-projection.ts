import { Prisma } from '@prisma/client';

/** Invoices belong to contracts, not to individual receipts. Share that fact without
 * inventing receipt-to-invoice allocations or counting invoiced amounts as cash. */
export function contractInvoiceProjection(contractId: Prisma.Sql) {
  const completed = Prisma.sql`FROM invoice_request i WHERE i."contractId"=${contractId} AND i.status='COMPLETED'`;
  return {
    status: Prisma.sql`CASE WHEN EXISTS(SELECT 1 ${completed}) THEN 'ISSUED' ELSE 'NOT_ISSUED' END`,
    numbers: Prisma.sql`(SELECT string_agg(DISTINCT i."invoiceNo", '、' ORDER BY i."invoiceNo") ${completed})`,
  };
}
