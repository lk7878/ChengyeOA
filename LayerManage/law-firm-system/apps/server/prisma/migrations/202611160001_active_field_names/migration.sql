-- Archived field metadata and historical values retain their original identities.
DROP INDEX IF EXISTS "collab_field_tableId_name_key";
CREATE UNIQUE INDEX "collab_field_active_name_key" ON "collab_field" ("tableId", "name") WHERE "archived" = false;
CREATE INDEX "collab_field_tableId_name_idx" ON "collab_field" ("tableId", "name");
