ALTER TABLE "case" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE lead_follow ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE TABLE collab_record_operation (id TEXT PRIMARY KEY, "tableId" TEXT NOT NULL, "recordId" TEXT NOT NULL, "actorId" TEXT NOT NULL, kind TEXT NOT NULL, before JSONB NOT NULL, after JSONB NOT NULL, "expectedVersion" INTEGER NOT NULL, "schemaVersion" INTEGER NOT NULL, undone BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX collab_record_operation_table_actor_created ON collab_record_operation("tableId", "actorId", "createdAt");
