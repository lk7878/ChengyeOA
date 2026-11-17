-- Keep deleted role identities and historical grants without reserving names.
-- Disabled roles still reserve their names; role codes remain globally unique.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE UNIQUE INDEX "role_active_name_key" ON "role" ("name") WHERE "status" <> 'DELETED';
DROP INDEX "role_name_key";
COMMIT;
