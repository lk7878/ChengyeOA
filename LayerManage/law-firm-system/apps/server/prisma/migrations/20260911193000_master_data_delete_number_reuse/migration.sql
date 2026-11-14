BEGIN;
ALTER TABLE "employee" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "employee_active_employeeNo_key" ON "employee" ("employeeNo") WHERE "status" <> 'LEAVED';
DROP INDEX "employee_employeeNo_key";
CREATE INDEX "employee_employeeNo_idx" ON "employee" ("employeeNo");
ALTER TABLE "employee" ADD CONSTRAINT "employee_deleted_requires_leave" CHECK ("deletedAt" IS NULL OR "status" = 'LEAVED');
COMMIT;
