BEGIN;
LOCK TABLE "organization" IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE organization_sort_migration ON COMMIT DROP AS
SELECT "id", "sort" AS old_sort, "version" AS old_version,
       (ROW_NUMBER() OVER (ORDER BY "sort", "level", "code", "id") - 1)::INTEGER AS new_sort
FROM "organization";

INSERT INTO "operation_log" ("id", "action", "targetType", "targetId", "oldValues", "newValues", "createdAt")
SELECT gen_random_uuid()::text, 'SORT_UNIQUENESS_MIGRATION', 'ORGANIZATION', "id",
       json_build_object('sort', old_sort, 'version', old_version)::text,
       json_build_object('sort', new_sort, 'version', old_version + 1)::text, CURRENT_TIMESTAMP
FROM organization_sort_migration WHERE old_sort <> new_sort;

UPDATE "organization" o SET "sort" = m.new_sort, "version" = m.old_version + 1, "updatedAt" = CURRENT_TIMESTAMP
FROM organization_sort_migration m WHERE o."id" = m."id" AND m.old_sort <> m.new_sort;

CREATE UNIQUE INDEX "organization_sort_key" ON "organization"("sort");
ALTER TABLE "organization" ADD CONSTRAINT "organization_sort_nonnegative" CHECK ("sort" >= 0);

CREATE FUNCTION next_organization_sort() RETURNS INTEGER LANGUAGE plpgsql VOLATILE AS $$
DECLARE next_sort BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock(20260911, 1);
  SELECT COALESCE(MAX("sort")::BIGINT + 1, 0) INTO next_sort FROM "organization";
  IF next_sort > 2147483647 THEN RAISE EXCEPTION 'Organization sort range exhausted'; END IF;
  RETURN next_sort::INTEGER;
END;
$$;
ALTER TABLE "organization" ALTER COLUMN "sort" SET DEFAULT next_organization_sort();
COMMIT;
