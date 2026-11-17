-- Deleted positions retain their identity and assignment history, but no longer
-- reserve their organization's code. Disabled, undeleted positions still do.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE UNIQUE INDEX "position_active_org_code_key" ON "position" ("orgId", "code") WHERE "deletedAt" IS NULL;
CREATE INDEX "position_orgId_code_idx" ON "position" ("orgId", "code");
DROP INDEX "position_orgId_code_key";
COMMIT;
