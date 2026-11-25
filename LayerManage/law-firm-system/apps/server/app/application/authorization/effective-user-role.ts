import type { Prisma } from '@prisma/client';

/** Current role badges and authorization must use the same validity window. */
export function effectiveUserRoleWhere(at = new Date()): Prisma.UserRoleWhereInput {
  return {
    revokedAt: null,
    validFrom: { lte: at },
    OR: [{ validUntil: null }, { validUntil: { gt: at } }],
    role: { status: 'ENABLED' },
  };
}
