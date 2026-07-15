import { Prisma } from '@prisma/client';

const PRIMARY_INITIALIZATION_ID = 'PRIMARY';
export const SYSTEM_SUPER_ADMIN_ROLE_CODE = 'SYSTEM_SUPER_ADMIN';

type TrustRootPrisma = Pick<Prisma.TransactionClient, 'systemInitialization' | 'role'>;

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
