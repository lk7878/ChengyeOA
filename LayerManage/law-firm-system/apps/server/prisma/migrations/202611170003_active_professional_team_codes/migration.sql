-- Deleted teams retain their identities, members and historical references.
-- Only undeleted teams (including disabled teams) reserve codes globally.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE UNIQUE INDEX "professional_team_active_code_key" ON "professional_team" ("code") WHERE "deletedAt" IS NULL;
CREATE INDEX "professional_team_code_idx" ON "professional_team" ("code");
DROP INDEX "professional_team_code_key";
COMMIT;
