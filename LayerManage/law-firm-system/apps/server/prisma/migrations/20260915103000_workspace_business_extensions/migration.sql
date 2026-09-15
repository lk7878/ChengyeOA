CREATE TABLE "collab_extension" (
  "tableId" TEXT NOT NULL, "recordId" TEXT NOT NULL, "values" JSONB NOT NULL DEFAULT '{}',
  "version" INTEGER NOT NULL DEFAULT 1, "updatedBy" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "collab_extension_pkey" PRIMARY KEY ("tableId", "recordId"),
  CONSTRAINT "collab_extension_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "collab_table"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "collab_extension_values_gin" ON "collab_extension" USING GIN ("values");
CREATE TABLE "collab_extension_revision" (
  "id" TEXT NOT NULL, "tableId" TEXT NOT NULL, "recordId" TEXT NOT NULL, "version" INTEGER NOT NULL,
  "actorId" TEXT NOT NULL, "changes" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "collab_extension_revision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "collab_extension_revision_tableId_recordId_fkey" FOREIGN KEY ("tableId", "recordId") REFERENCES "collab_extension"("tableId", "recordId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "collab_extension_revision_tableId_recordId_version_key" ON "collab_extension_revision"("tableId", "recordId", "version");
