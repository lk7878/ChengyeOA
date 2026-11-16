ALTER TABLE "personal_file" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "personal_file_deleted_at" ON "personal_file"("deletedAt");
