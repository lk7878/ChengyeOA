CREATE TABLE role_application_policy (
 "roleId" TEXT NOT NULL REFERENCES role(id) ON DELETE CASCADE,
 "workspaceId" TEXT NOT NULL REFERENCES collab_workspace(id) ON DELETE CASCADE,
 "canCreate" BOOLEAN NOT NULL DEFAULT false,
 "defaultLevel" TEXT NOT NULL DEFAULT 'DENY' CHECK ("defaultLevel" IN ('DENY','READER','EDITOR')),
 version INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY ("roleId","workspaceId")
);
