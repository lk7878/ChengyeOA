-- CreateTable
CREATE TABLE "drive_node" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "parentId" TEXT,
    "kind" TEXT NOT NULL,
    "folderName" TEXT,
    "baseId" TEXT,
    "ownerId" TEXT NOT NULL,
    "accessPolicy" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3),
    "cataloguedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drive_node_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "drive_node_baseId_key" ON "drive_node"("baseId");

-- CreateIndex
CREATE INDEX "drive_node_workspaceId_ownerId_idx" ON "drive_node"("workspaceId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "drive_node_workspaceId_id_key" ON "drive_node"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "drive_node_workspaceId_baseId_key" ON "drive_node"("workspaceId", "baseId");

-- CreateIndex
CREATE UNIQUE INDEX "drive_node_workspaceId_parentId_folderName_key" ON "drive_node"("workspaceId", "parentId", "folderName");

-- CreateIndex
CREATE UNIQUE INDEX "collab_base_workspaceId_id_key" ON "collab_base"("workspaceId", "id");

-- AddForeignKey
ALTER TABLE "drive_node" ADD CONSTRAINT "drive_node_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "collab_workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drive_node" ADD CONSTRAINT "drive_node_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drive_node" ADD CONSTRAINT "drive_node_workspaceId_baseId_fkey" FOREIGN KEY ("workspaceId", "baseId") REFERENCES "collab_base"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drive_node" ADD CONSTRAINT "drive_node_workspaceId_parentId_fkey" FOREIGN KEY ("workspaceId", "parentId") REFERENCES "drive_node"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Resource types have one title/ACL authority; Base IDs remain stable.
ALTER TABLE drive_node ADD CONSTRAINT drive_node_kind_shape CHECK (
  (kind = 'BASE' AND "baseId" IS NOT NULL AND "baseId" = id AND "folderName" IS NULL AND "accessPolicy" IS NULL)
  OR (kind = 'FOLDER' AND "baseId" IS NULL AND "folderName" IS NOT NULL AND length(btrim("folderName")) BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX drive_node_root_folder_name_key ON drive_node ("workspaceId", "folderName")
  WHERE kind = 'FOLDER' AND "parentId" IS NULL;
CREATE FUNCTION validate_drive_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.kind IS DISTINCT FROM OLD.kind OR NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId") THEN
    RAISE EXCEPTION 'drive identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."parentId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM drive_node p WHERE p.id = NEW."parentId" AND p.kind = 'FOLDER' AND p."workspaceId" = NEW."workspaceId"
  ) THEN
    RAISE EXCEPTION 'drive parent must be a folder in the same workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER drive_parent_guard BEFORE INSERT OR UPDATE ON drive_node FOR EACH ROW EXECUTE FUNCTION validate_drive_parent();

-- Backfill is intentionally repeatable; creation time of legacy Bases is unknown.
INSERT INTO drive_node (id, "workspaceId", kind, "baseId", "ownerId", "updatedAt")
SELECT b.id, b."workspaceId", 'BASE', b.id, w."ownerId", CURRENT_TIMESTAMP
FROM collab_base b JOIN collab_workspace w ON w.id = b."workspaceId"
ON CONFLICT (id) DO NOTHING;
