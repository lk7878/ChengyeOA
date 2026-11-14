CREATE TABLE "worksheet_role_policy" (
  "tableId" TEXT PRIMARY KEY REFERENCES "collab_table"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "rules" JSONB NOT NULL DEFAULT '{}',
  "invitations" JSONB NOT NULL DEFAULT '{}',
  "version" INTEGER NOT NULL DEFAULT 1
);
