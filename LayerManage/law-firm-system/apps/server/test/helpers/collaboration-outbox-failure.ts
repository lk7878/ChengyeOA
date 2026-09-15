import { PrismaClient } from '@prisma/client';
import { assertTestDatabaseUrl } from './test-database';

/** Fail the actual database write, for both ORM and batched SQL outbox paths. */
export async function withFailingCollaborationOutbox(db: PrismaClient, run: () => Promise<void>) {
  assertTestDatabaseUrl();
  await db.$executeRawUnsafe(
    `ALTER TABLE event_log ADD CONSTRAINT collab_test_outbox_failure CHECK ("eventType" <> 'collaboration.changed') NOT VALID`,
  );
  try {
    await run();
  } finally {
    await db.$executeRawUnsafe('ALTER TABLE event_log DROP CONSTRAINT collab_test_outbox_failure');
  }
}
