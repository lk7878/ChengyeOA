ALTER TABLE drive_node ADD COLUMN "deletedAt" TIMESTAMP(3), ADD COLUMN "deletedBy" TEXT;
ALTER TABLE drive_node ADD CONSTRAINT drive_node_deletion_pair CHECK (("deletedAt" IS NULL) = ("deletedBy" IS NULL));
DROP INDEX "drive_node_workspaceId_parentId_folderName_key";
DROP INDEX drive_node_root_folder_name_key;
CREATE UNIQUE INDEX drive_node_active_folder_name_key ON drive_node ("workspaceId", "parentId", "folderName") WHERE kind = 'FOLDER' AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX drive_node_root_folder_name_key ON drive_node ("workspaceId", "folderName") WHERE kind = 'FOLDER' AND "parentId" IS NULL AND "deletedAt" IS NULL;
