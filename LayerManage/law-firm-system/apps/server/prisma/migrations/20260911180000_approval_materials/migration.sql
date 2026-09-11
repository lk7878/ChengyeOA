ALTER TABLE "approval_definition" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "approval_instance" ADD COLUMN "formSnapshot" JSONB, ADD COLUMN "requestKey" TEXT, ADD COLUMN "requestHash" TEXT;
CREATE UNIQUE INDEX "approval_instance_requestKey_key" ON "approval_instance"("requestKey");
CREATE TABLE "approval_attachment" ("id" TEXT PRIMARY KEY, "ownerUserId" TEXT NOT NULL, "instanceId" TEXT, "fileName" TEXT NOT NULL, "mimeType" TEXT NOT NULL, "fileSize" INTEGER NOT NULL CHECK ("fileSize" > 0 AND "fileSize" <= 10485760), "sha256" TEXT NOT NULL, "bytes" BYTEA NOT NULL, "sourceId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "approval_attachment_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "approval_instance"("id") ON DELETE RESTRICT ON UPDATE CASCADE);
CREATE INDEX "approval_attachment_instanceId_idx" ON "approval_attachment"("instanceId");
CREATE INDEX "approval_attachment_ownerUserId_createdAt_idx" ON "approval_attachment"("ownerUserId", "createdAt");
ALTER TABLE "approval_attachment" ADD CONSTRAINT "approval_attachment_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "approval_attachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
