CREATE INDEX IF NOT EXISTS "collab_record_values_path_gin" ON "collab_record" USING GIN ("values" jsonb_path_ops);
DROP INDEX IF EXISTS "collab_record_values_gin";
