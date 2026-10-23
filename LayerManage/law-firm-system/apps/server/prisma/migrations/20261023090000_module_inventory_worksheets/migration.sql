ALTER TABLE "collab_workspace" ADD COLUMN "moduleGroup" TEXT, ADD COLUMN "moduleParentId" TEXT;
CREATE UNIQUE INDEX "collab_workspace_moduleParentId_moduleGroup_key" ON "collab_workspace"("moduleParentId", "moduleGroup");
ALTER TABLE "collab_table" ADD COLUMN "inventoryKind" TEXT;
