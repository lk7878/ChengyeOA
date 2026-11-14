-- Keep newly imported/edited values immediately searchable without a growing GIN
-- pending list making the planner prefer repeatedly decoding every JSONB record.
-- This trades write maintenance for predictable collaborative reads; load tests
-- cover both paths. Roll back with ALTER INDEX ... SET (fastupdate = on).
ALTER INDEX "collab_record_values_path_gin" SET (fastupdate = off);
SELECT gin_clean_pending_list('collab_record_values_path_gin'::regclass);
