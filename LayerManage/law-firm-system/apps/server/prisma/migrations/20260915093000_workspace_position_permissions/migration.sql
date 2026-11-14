ALTER TABLE collab_member ADD COLUMN "canManageAccess" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE collab_member ALTER COLUMN "rowScope" SET DEFAULT 'SELF';
UPDATE collab_member SET "rowScope" = 'SELF', version = version + 1 WHERE role IN ('READER','EDITOR') AND "rowScope" = 'ALL';
INSERT INTO collab_event ("baseId", kind, "createdAt") SELECT id, 'access.updated', CURRENT_TIMESTAMP FROM collab_base;
