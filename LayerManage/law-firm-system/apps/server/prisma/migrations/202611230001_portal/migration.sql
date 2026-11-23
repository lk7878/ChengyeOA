-- CreateTable
CREATE TABLE "portal_entry" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT,
    "slot" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_revision" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "personName" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "pinned" BOOLEAN NOT NULL,
    "external" BOOLEAN NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "imageId" TEXT,
    "fileId" TEXT,
    "editorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_asset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "portal_asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portal_entry_slot_key" ON "portal_entry"("slot");

-- CreateIndex
CREATE UNIQUE INDEX "portal_entry_publishedId_key" ON "portal_entry"("publishedId");

-- CreateIndex
CREATE UNIQUE INDEX "portal_revision_entryId_number_key" ON "portal_revision"("entryId", "number");

-- AddForeignKey
ALTER TABLE "portal_entry" ADD CONSTRAINT "portal_entry_publishedId_fkey" FOREIGN KEY ("publishedId") REFERENCES "portal_revision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_revision" ADD CONSTRAINT "portal_revision_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "portal_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_revision" ADD CONSTRAINT "portal_revision_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "portal_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_revision" ADD CONSTRAINT "portal_revision_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "portal_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
