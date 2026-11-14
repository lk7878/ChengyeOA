import { Prisma } from '@prisma/client';

class PublicConflictError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export function rethrowKnownUniqueConflict(
  error: unknown,
  expectedFields: readonly string[],
  publicMessage: string,
): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = error.meta?.target;
    const targetParts = Array.isArray(target)
      ? target.filter((part): part is string => typeof part === 'string')
      : typeof target === 'string'
        ? [target]
        : [];
    const expectedTarget = expectedFields.some(field => (
      targetParts.some(part => part === field || part.includes(field))
    ));
    if (expectedTarget) {
      throw new PublicConflictError(publicMessage);
    }
  }
  throw error;
}
