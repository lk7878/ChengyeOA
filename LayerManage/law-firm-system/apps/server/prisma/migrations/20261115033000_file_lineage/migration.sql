ALTER TABLE "personal_file_version" ADD COLUMN "lineage" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "personal_file_upload" ADD COLUMN "lineage" JSONB NOT NULL DEFAULT '[]', ADD COLUMN "source" TEXT NOT NULL DEFAULT 'upload';
