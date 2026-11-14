import { Prisma } from '@prisma/client';

const PRIMARY_INITIALIZATION_ID = 'PRIMARY';
export const SYSTEM_SUPER_ADMIN_ROLE_CODE = 'SYSTEM_SUPER_ADMIN';

type TrustRootPrisma = Pick<Prisma.TransactionClient, 'systemInitialization' | 'role'>;
type AdministratorGuardPrisma = Pick<Prisma.TransactionClient, 'userRole'>;

export class TrustRootProtectedError extends Error {
  readonly status = 409;

  constructor() {
    super('TRUST_ROOT_PROTECTED');
    this.name = 'TrustRootProtectedError';
  }
}

export async function assertMutableUser(prisma: TrustRootPrisma, userId: string): Promise<void> {
  const initialization = await prisma.systemInitialization.findUnique({
    where: { id: PRIMARY_INITIALIZATION_ID },
    select: { superAdminUserId: true },
  });
  if (initialization?.superAdminUserId === userId) {
    throw new TrustRootProtectedError();
  }
}

export async function assertNonAdministratorUserMutable(
  prisma: AdministratorGuardPrisma,
  userId: string,
  evaluatedAt = new Date(),
): Promise<void> {
  const administratorGrant = await prisma.userRole.findFirst({
    where: {
      userId,
      revokedAt: null,
      validFrom: { lte: evaluatedAt },
      OR: [{ validUntil: null }, { validUntil: { gt: evaluatedAt } }],
      role: {
        type: 'SYSTEM',
        status: 'ENABLED',
        code: { in: ['SYSTEM_ADMIN', 'SYSTEM_SUPER_ADMIN'] },
      },
    },
    select: { id: true },
  });
  if (administratorGrant) {
    throw new TrustRootProtectedError();
  }
}

// Root identity remains immutable. Other administrator accounts can be retired by a super administrator.
export async function assertAccountLifecycleMutable(
  prisma: TrustRootPrisma & AdministratorGuardPrisma,
  userId: string,
  isSystemSuperAdmin: boolean,
): Promise<void> {
  await assertMutableUser(prisma, userId);
  if (!isSystemSuperAdmin) await assertNonAdministratorUserMutable(prisma, userId);
}

export async function assertMutableRole(prisma: TrustRootPrisma, roleId: string): Promise<void> {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    select: { code: true },
  });
  if (role?.code === SYSTEM_SUPER_ADMIN_ROLE_CODE) {
    throw new TrustRootProtectedError();
  }
}

export async function assertDeletableOrganization(
  prisma: TrustRootPrisma,
  organizationId: string,
): Promise<void> {
  const initialization = await prisma.systemInitialization.findUnique({
    where: { id: PRIMARY_INITIALIZATION_ID },
    select: { rootOrganizationId: true },
  });
  if (initialization?.rootOrganizationId === organizationId) {
    throw new TrustRootProtectedError();
  }
}
