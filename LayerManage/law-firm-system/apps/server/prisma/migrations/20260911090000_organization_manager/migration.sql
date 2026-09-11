ALTER TABLE "organization" ADD COLUMN "managerEmployeeId" TEXT;
CREATE INDEX "organization_managerEmployeeId_idx" ON "organization"("managerEmployeeId");
ALTER TABLE "organization" ADD CONSTRAINT "organization_managerEmployeeId_fkey"
  FOREIGN KEY ("managerEmployeeId") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
