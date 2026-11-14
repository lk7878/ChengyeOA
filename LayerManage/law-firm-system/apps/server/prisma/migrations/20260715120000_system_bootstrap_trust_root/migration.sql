ALTER TABLE "login_log" DROP CONSTRAINT "login_log_userId_fkey";

ALTER TABLE "role" ADD COLUMN "code" TEXT NOT NULL;

ALTER TABLE "user"
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "credentialVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "passwordChangedAt" TIMESTAMP(3),
  ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockedUntil" TIMESTAMP(3);

ALTER TABLE "login_log"
  ALTER COLUMN "userId" DROP NOT NULL,
  ADD COLUMN "usernameSnapshot" TEXT NOT NULL,
  ADD COLUMN "outcome" TEXT NOT NULL,
  ADD COLUMN "reasonCode" TEXT;

CREATE TABLE "system_initialization" (
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "rootOrganizationId" TEXT NOT NULL,
  "superAdminUserId" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "system_initialization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "role_code_key" ON "role"("code");
CREATE UNIQUE INDEX "system_initialization_rootOrganizationId_key" ON "system_initialization"("rootOrganizationId");
CREATE UNIQUE INDEX "system_initialization_superAdminUserId_key" ON "system_initialization"("superAdminUserId");

ALTER TABLE "login_log" ADD CONSTRAINT "login_log_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "system_initialization" ADD CONSTRAINT "system_initialization_rootOrganizationId_fkey"
  FOREIGN KEY ("rootOrganizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "system_initialization" ADD CONSTRAINT "system_initialization_superAdminUserId_fkey"
  FOREIGN KEY ("superAdminUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
