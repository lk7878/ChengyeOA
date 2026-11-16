CREATE TABLE "personal_file_purge" (
  "fileId" TEXT PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "storageKeys" JSONB NOT NULL,
  "uploadIds" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3)
);
CREATE INDEX "personal_file_purge_ownerId_completedAt_idx" ON "personal_file_purge"("ownerId", "completedAt");
