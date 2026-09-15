CREATE TABLE drive_shortcut (
  id TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES collab_workspace(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "parentId" TEXT,
  "targetId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  FOREIGN KEY ("workspaceId", "parentId") REFERENCES drive_node("workspaceId", id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("workspaceId", "targetId") REFERENCES drive_node("workspaceId", id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "drive_shortcut_workspaceId_parentId_idx" ON drive_shortcut ("workspaceId", "parentId");
CREATE UNIQUE INDEX drive_shortcut_personal_unique ON drive_shortcut ("ownerId", "targetId") WHERE "parentId" IS NULL AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX drive_shortcut_folder_unique ON drive_shortcut ("parentId", "targetId") WHERE "parentId" IS NOT NULL AND "deletedAt" IS NULL;
CREATE FUNCTION validate_drive_shortcut() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId" OR NEW."parentId" IS DISTINCT FROM OLD."parentId" OR NEW."targetId" IS DISTINCT FROM OLD."targetId" OR NEW."ownerId" IS DISTINCT FROM OLD."ownerId") THEN
    RAISE EXCEPTION 'shortcut identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."parentId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM drive_node n WHERE n.id = NEW."parentId" AND n.kind = 'FOLDER') THEN
    RAISE EXCEPTION 'shortcut parent must be folder' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER drive_shortcut_guard BEFORE INSERT OR UPDATE ON drive_shortcut FOR EACH ROW EXECUTE FUNCTION validate_drive_shortcut();

CREATE TABLE drive_visit (
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "nodeId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "nodeId"),
  FOREIGN KEY ("workspaceId", "nodeId") REFERENCES drive_node("workspaceId", id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "drive_visit_userId_workspaceId_visitedAt_idx" ON drive_visit ("userId", "workspaceId", "visitedAt");
