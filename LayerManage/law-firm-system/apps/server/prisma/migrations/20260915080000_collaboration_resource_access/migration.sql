ALTER TABLE "collab_base" ADD COLUMN "accessPolicy" JSONB, ADD COLUMN "accessVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "collab_table" ADD COLUMN "accessPolicy" JSONB, ADD COLUMN "accessVersion" INTEGER NOT NULL DEFAULT 1;
