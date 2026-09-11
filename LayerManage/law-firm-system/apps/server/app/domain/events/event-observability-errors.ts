import { Prisma } from '@prisma/client';

export class EventObservabilityUnavailableError extends Error {
  readonly code = 'EVENT_OBSERVABILITY_UNAVAILABLE' as const;
  readonly httpStatus = 503 as const;

  constructor() {
    super('EVENT_OBSERVABILITY_UNAVAILABLE');
    this.name = 'EventObservabilityUnavailableError';
  }
}

export function isEventObservabilityDatabaseError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientInitializationError
    || error instanceof Prisma.PrismaClientKnownRequestError
    || error instanceof Prisma.PrismaClientUnknownRequestError
    || error instanceof Prisma.PrismaClientRustPanicError
    || error instanceof Prisma.PrismaClientValidationError;
}
